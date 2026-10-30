import { normalizePlan } from './planning';
import { RRule, Frequency } from 'rrule';
import { projectWithDescendants } from './projects';
import type { Project, Task, Note, JournalEntry, Goal } from './types';
import { utcNoon, fromUtcNoon, parseLocalDate, toLocalDateStr, addDays } from './dates';

export type RecurrenceKind = 'daily' | 'weekly' | 'monthly' | 'ndays';

// Build an RRULE string anchored at the given local due date.
export function makeRecurrence(kind: RecurrenceKind, dueDate: string, intervalDays = 3): string {
  const dtstart = utcNoon(dueDate);
  let rule: RRule;
  switch (kind) {
    case 'daily':
      rule = new RRule({ freq: Frequency.DAILY, interval: 1, dtstart });
      break;
    case 'weekly': {
      const wd = parseLocalDate(dueDate).getDay(); // 0=Sun
      const map = [RRule.SU, RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA];
      rule = new RRule({ freq: Frequency.WEEKLY, interval: 1, byweekday: [map[wd]], dtstart });
      break;
    }
    case 'monthly': {
      const day = parseLocalDate(dueDate).getDate();
      rule = new RRule({ freq: Frequency.MONTHLY, interval: 1, bymonthday: [day], dtstart });
      break;
    }
    case 'ndays':
      rule = new RRule({ freq: Frequency.DAILY, interval: Math.max(1, intervalDays), dtstart });
      break;
  }
  return rule.toString();
}

export function isRecurrenceValid(rule: string | null): boolean {
  if (!rule) return true;
  try {
    RRule.fromString(rule);
    return true;
  } catch {
    return false;
  }
}

// Display classification only. Additional constraints must not look like a basic
// editor-generated schedule. Never normalizes or rewrites the stored rule.
export function recurrenceChoice(rule: string | null): 'none' | 'daily' | 'weekly' | 'monthly' | 'ndays' | 'invalid' | 'custom' {
  if (!rule) return 'none';
  let o: ReturnType<typeof RRule.fromString>['origOptions'];
  try { o = RRule.fromString(rule).origOptions; } catch { return 'invalid'; }
  if (!o.dtstart || Object.keys(o).some(key => !['freq', 'interval', 'dtstart', 'byweekday', 'bymonthday'].includes(key))) return 'custom';
  const n = o.interval ?? 1;
  if (!Number.isInteger(n) || n < 1) return 'custom';
  if (o.freq === Frequency.DAILY) {
    return o.byweekday || o.bymonthday ? 'custom' : n === 1 ? 'daily' : 'ndays';
  }
  if (o.freq === Frequency.WEEKLY) {
    const days = Array.isArray(o.byweekday) ? o.byweekday : o.byweekday != null ? [o.byweekday] : [];
    const day = days[0];
    const weekday = typeof day === 'number' ? day : typeof day === 'object' ? day.weekday : undefined;
    return n !== 1 || o.bymonthday || days.length !== 1 || (typeof day === 'object' && day.n != null) || weekday !== (o.dtstart.getUTCDay() + 6) % 7 ? 'custom' : 'weekly';
  }
  if (o.freq === Frequency.MONTHLY) {
    const days = Array.isArray(o.bymonthday) ? o.bymonthday : o.bymonthday != null ? [o.bymonthday] : [];
    return n !== 1 || o.byweekday || days.length !== 1 || days[0] !== o.dtstart.getUTCDate() ? 'custom' : 'monthly';
  }
  return 'custom';
}

export function describeRecurrence(rule: string | null): string {
  switch (recurrenceChoice(rule)) {
    case 'none': return '';
    case 'invalid': return 'Invalid repeat rule';
    case 'custom': return 'Custom repeat';
    case 'daily': return 'Daily';
    case 'weekly': return 'Weekly';
    case 'monthly': return 'Monthly';
    case 'ndays': return `Every ${RRule.fromString(rule!).origOptions.interval} days`;
  }
}

// First date strictly after `base` (local YYYY-MM-DD) on which a monthly rule
// anchored at `day` fires, clamping to the month's last day when the month is
// shorter. Without this, a monthly task on the 29th-31st silently skips
// February (RRule omits months without the day).
function nextMonthlyClamped(day: number, base: string): string {
  let [year, month] = base.split('-').map(Number);
  for (let i = 0; i < 2400; i++) {
    const dim = new Date(year, month, 0).getDate(); // last day of `month` (local)
    const cand = `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, dim)).padStart(2, '0')}`;
    if (cand > base) return cand;
    month += 1;
    if (month === 13) { month = 1; year += 1; }
  }
  return base;
}

// Next occurrence strictly after max(dueDate, today), as a local date string.
// Skipping missed occurrences is intentional: completing an overdue daily task
// today schedules it for tomorrow, not for a pile of past days.
export function nextOccurrenceDate(rule: string, dueDate: string, today: string): string | null {
  let rr: RRule;
  try {
    rr = RRule.fromString(rule);
  } catch {
    // A malformed rule (restored backup, synced row) must not block completion.
    return null;
  }
  const base = dueDate > today ? dueDate : today;
  const o = rr.origOptions;
  // bymonthday comes back as a scalar when the rule names a single day.
  const mdays = Array.isArray(o.bymonthday) ? o.bymonthday : o.bymonthday != null ? [o.bymonthday] : [];
  if (
    o.freq === Frequency.MONTHLY &&
    (o.interval ?? 1) === 1 &&
    mdays.length === 1 &&
    !o.byweekday && !o.bysetpos
  ) {
    return nextMonthlyClamped(Number(mdays[0]), base);
  }
  const next = rr.after(utcNoon(base), false);
  return next ? fromUtcNoon(next) : null;
}

export interface CompletionResult {
  updates: Partial<Task>;
  spawned: Omit<Task, 'id' | 'createdAt' | 'updatedAt'> | null;
}

/** Explicitly skip the current occurrence of a recurring task: the skipped
 * date is recorded and the task advances to the next occurrence after today,
 * mirroring how completion advances. Returns null when skipping is a no-op
 * (no recurrence, no due date, or the rule yields no next occurrence). */
export function skipOccurrence(task: Task, today: string, now: number): { updates: Partial<Task> } | null {
  if (!task.recurrence || !task.dueDate) return null;
  const nextDate = nextOccurrenceDate(task.recurrence, task.dueDate, today);
  if (!nextDate) return null;
  return {
    updates: {
      dueDate: nextDate,
      plannedDate: null, plannedTime: null,
      skippedDates: [...(task.skippedDates ?? []), task.dueDate],
      updatedAt: now,
    },
  };
}

export function completeTask(task: Task, today: string, now: number): CompletionResult {
  const updates: Partial<Task> = { status: 'done', completedAt: now, updatedAt: now };
  if (!task.recurrence || !task.dueDate) return { updates, spawned: null };
  const nextDate = nextOccurrenceDate(task.recurrence, task.dueDate, today);
  if (!nextDate) return { updates, spawned: null };
  return {
    updates,
    spawned: {
      title: task.title,
      note: task.note,
      noteDoc: task.noteDoc ?? null,
      projectId: task.projectId,
      parentId: task.parentId,
      goalId: task.goalId,
      noteId: task.noteId,
      status: 'active',
      pinned: task.pinned,
      priority: task.priority,
      dueDate: nextDate,
      dueTime: task.dueTime ?? null,
      plannedDate: null, plannedTime: null, durationMinutes: task.durationMinutes ?? null,
      recurrence: task.recurrence,
      skippedDates: [...(task.skippedDates ?? [])],
      blockedBy: [...(task.blockedBy ?? [])],
      tags: [...(task.tags ?? [])],
      order: task.order,
      seriesId: task.seriesId ?? task.id,
      completedAt: null,
    },
  };
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.priority !== b.priority) return (a.priority || 4) - (b.priority || 4);
    if (a.order !== b.order) return a.order - b.order;
    return a.createdAt - b.createdAt;
  });
}

const topLevel = (t: Task) => t.parentId === null;
const active = (t: Task) => t.status === 'active';

export function todayTasks(tasks: Task[], today: string): Task[] {
  return sortTasks(tasks.filter((t) => active(t) && topLevel(t) && t.dueDate !== null && t.dueDate <= today));
}

export function upcomingTasks(tasks: Task[], today: string, days = 14): Map<string, Task[]> {
  const limit = (() => {
    const d = parseLocalDate(today);
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  })();
  const groups = new Map<string, Task[]>();
  for (const t of sortTasks(tasks.filter((t) => active(t) && topLevel(t) && t.dueDate && t.dueDate > today && t.dueDate <= limit))) {
    const key = t.dueDate as string;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  return new Map([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

// --- "Up next" suggestions (SPEC Phase 5) ---
// Plain date/threshold heuristics only - no invented smarts.

export const UPNEXT_STALE_DAYS = 14;
export const UPNEXT_DUE_SOON_DAYS = 2;

export interface UpNextGroups {
  overdue: Task[];
  dueSoon: Task[];
  staleBacklog: Task[];
  brokenRules: Task[];
}

export function upNextGroups(tasks: Task[], today: string, now: number): UpNextGroups {
  const act = tasks.filter((t) => active(t) && topLevel(t));
  const staleMs = UPNEXT_STALE_DAYS * 86400000;
  const soonLimit = addDays(today, UPNEXT_DUE_SOON_DAYS);
  return {
    overdue: sortTasks(act.filter((t) => t.dueDate !== null && t.dueDate < today)),
    dueSoon: sortTasks(act.filter((t) => t.dueDate !== null && t.dueDate > today && t.dueDate <= soonLimit)),
    staleBacklog: sortTasks(act.filter((t) => t.dueDate === null && now - t.updatedAt >= staleMs)),
    brokenRules: sortTasks(act.filter((t) => t.recurrence !== null && !isRecurrenceValid(t.recurrence))),
  };
}

export function backlogTasks(tasks: Task[]): Task[] {
  return sortTasks(tasks.filter((t) => active(t) && topLevel(t) && t.dueDate === null));
}

export function projectTasks(tasks: Task[], projectId: string): Task[] {
  return sortTasks(tasks.filter((t) => active(t) && topLevel(t) && t.projectId === projectId));
}

// A project's aggregate view: its own tasks plus every descendant
// project's tasks, in the same order (product decision, Oct 27).
export function projectTreeTasks(tasks: Task[], projects: Project[], projectId: string): Task[] {
  const ids = projectWithDescendants(projects, projectId);
  return sortTasks(tasks.filter((t) => active(t) && topLevel(t) && ids.has(t.projectId)));
}

export function completedTasks(tasks: Task[]): Task[] {
  return [...tasks]
    .filter((t) => t.status === 'done')
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
}

export type CompletedGroup = { day: string; label: string; tasks: Task[] };

// Group a completedAt-desc list of done tasks into calendar-day buckets with
// friendly labels (Today / Yesterday / weekday within the last week / date).
export function groupCompletedByDay(tasks: Task[], today: string): CompletedGroup[] {
  const groups: CompletedGroup[] = [];
  for (const t of tasks) {
    const day = t.completedAt ? toLocalDateStr(new Date(t.completedAt)) : '';
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.tasks.push(t);
    else groups.push({ day, label: completedDayLabel(day, today), tasks: [t] });
  }
  return groups;
}

function completedDayLabel(day: string, today: string): string {
  if (!day) return 'Unknown date';
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  const ageDays = Math.round((parseLocalDate(today).getTime() - parseLocalDate(day).getTime()) / 86400000);
  if (ageDays > 0 && ageDays < 7 && sameYear) {
    return parseLocalDate(day).toLocaleDateString('en-US', { weekday: 'long' });
  }
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (!sameYear) opts.year = 'numeric';
  return parseLocalDate(day).toLocaleDateString('en-US', opts);
}

export function subtasksOf(tasks: Task[], parentId: string): Task[] {
  return sortTasks(tasks.filter((t) => t.parentId === parentId && t.status !== 'archived'));
}

export function subtaskProgress(tasks: Task[], parentId: string): { done: number; total: number } {
  const subs = tasks.filter((t) => t.parentId === parentId && t.status !== 'archived');
  return { done: subs.filter((t) => t.status === 'done').length, total: subs.length };
}

// --- Dependencies ---

export function normalizeTask(t: Task): Task {
  return { ...t, ...normalizePlan(t), blockedBy: t.blockedBy ?? [], tags: t.tags ?? [], noteDoc: t.noteDoc ?? null };
}

export function blockersOf(tasks: Task[], t: Task): Task[] {
  const ids = new Set(t.blockedBy ?? []);
  return tasks.filter((x) => ids.has(x.id));
}

export function activeBlockers(tasks: Task[], t: Task): Task[] {
  return blockersOf(tasks, t).filter((x) => x.status === 'active');
}

export function isBlocked(tasks: Task[], t: Task): boolean {
  return t.status === 'active' && activeBlockers(tasks, t).length > 0;
}

// True if making `blockerId` a blocker of `taskId` would create a cycle
// (or is a self-block). Walks the existing blockedBy graph from blockerId.
export function wouldCreateCycle(tasks: Task[], taskId: string, blockerId: string): boolean {
  if (taskId === blockerId) return true;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const queue = [blockerId];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    if (cur === taskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const t = byId.get(cur);
    for (const next of t?.blockedBy ?? []) queue.push(next);
  }
  return false;
}

/** Offers only dependency choices that can actually be added. */
export function blockerCandidates(tasks: Task[], task: Task): Task[] {
  return tasks.filter(t => t.status === 'active' && t.id !== task.id
    && !(task.blockedBy ?? []).includes(t.id)
    && !wouldCreateCycle(tasks, task.id, t.id));
}

// --- Tags + search ---

export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-');
}

/** Pull "#tag" tokens out of quick-add text; returns the cleaned title and tags. */
export function parseQuickAdd(raw: string): { title: string; tags: string[] } {
  const tags: string[] = [];
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => {
    if (w.startsWith('#') && w.length > 1) {
      tags.push(normalizeTag(w));
      return false;
    }
    return true;
  });
  return { title: kept.join(' '), tags };
}

// Tokens: "#tag" filters by tag, other tokens substring-match title/note.
// All tokens must match (AND). Matches active and done tasks.
export function searchTasks(tasks: Task[], query: string): Task[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const tagTokens = tokens.filter((t) => t.startsWith('#')).map((t) => normalizeTag(t));
  const textTokens = tokens.filter((t) => !t.startsWith('#'));
  return sortTasks(
    tasks.filter((t) => {
      const norm = normalizeTask(t);
      if (t.status === 'archived') return false;
      const hay = `${t.title}\n${t.note}`.toLowerCase();
      if (!textTokens.every((tok) => hay.includes(tok))) return false;
      if (!tagTokens.every((tag) => norm.tags.includes(tag))) return false;
      return true;
    }),
  );
}

// --- Ordering ---

// Fractional ordering: midpoint between neighbors, no reindex needed.
export function orderBetween(prev: number | undefined, next: number | undefined): number {
  if (prev === undefined && next === undefined) return 1;
  if (prev === undefined) return (next as number) - 1;
  if (next === undefined) return prev + 1;
  return (prev + next) / 2;
}

// Compute the new order for `taskId` dropped before/after `targetId`
// within `list` (the currently displayed, sorted list).
export function reorderedPosition(list: Task[], taskId: string, targetId: string, after: boolean): number | null {
  if (taskId === targetId) return null;
  const without = list.filter((t) => t.id !== taskId);
  const tIdx = without.findIndex((t) => t.id === targetId);
  if (tIdx < 0) return null;
  const insertIdx = tIdx + (after ? 1 : 0);
  return orderBetween(without[insertIdx - 1]?.order, without[insertIdx]?.order);
}

function textMatch(haystack: string, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter((t) => !t.startsWith('#'));
  if (tokens.length === 0) return false;
  const hay = haystack.toLowerCase();
  return tokens.every((tok) => hay.includes(tok));
}

export function searchNotes(notes: Note[], query: string): Note[] {
  return notes
    .filter((n) => textMatch(`${n.title}\n${n.note}`, query))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function searchJournal(entries: JournalEntry[], query: string): JournalEntry[] {
  return entries
    .filter((e) => textMatch(e.note, query) || textMatch(e.highlight ?? '', query))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function searchGoals(goals: Goal[], query: string): Goal[] {
  return goals.filter((g) => g.status !== 'archived' && textMatch(`${g.title}\n${g.note}`, query));
}

// The one task most worth doing right now: overdue first, then priority,
// then anything due today with a time, then earliest due. Blocked and
// subtasks don't qualify.
export function suggestedTask(tasks: Task[], today: string): { task: Task; reason: string } | null {
  const candidates = tasks.filter(
    (t) => t.status === 'active' && t.parentId === null && activeBlockers(tasks, t).length === 0 && t.dueDate !== null && t.dueDate <= today,
  );
  if (candidates.length === 0) return null;
  const overdue = candidates.filter((t) => t.dueDate! < today);
  const pool = overdue.length > 0 ? overdue : candidates;
  pool.sort((a, b) => {
    if (a.priority !== b.priority) return (a.priority || 4) - (b.priority || 4);
    if ((a.dueTime ?? '99') !== (b.dueTime ?? '99')) return (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99');
    return a.createdAt - b.createdAt;
  });
  const top = pool[0];
  const reason = overdue.length > 0 ? 'Overdue' : top.priority === 1 ? 'Top priority' : top.dueTime ? `Due ${top.dueTime}` : 'Due today';
  return { task: top, reason };
}

// Drop checklist items that would duplicate existing tasks: titles already
// linked from this note (trimmed, case-insensitive) and repeats within the
// list itself. Order preserved.
export function filterNewChecklistItems(items: string[], existingTitles: string[]): string[] {
  const seen = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
  const out: string[] = [];
  for (const raw of items) {
    const key = raw.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(raw.trim());
  }
  return out;
}

// Unchecked checklist items in a ProseMirror doc, as plain-text titles.
export function extractChecklistItems(doc: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    const n = node as { type?: string; attrs?: { checked?: boolean }; content?: unknown[]; text?: string };
    if (n.type === 'taskItem' && n.attrs?.checked !== true) {
      const text = (n.content ?? [])
        .map((c) => {
          const cn = c as { content?: { text?: string }[]; text?: string };
          return cn.content ? cn.content.map((x) => x.text ?? '').join('') : (cn.text ?? '');
        })
        .join('')
        .trim();
      if (text) out.push(text);
      return; // don't double-walk children of a task item
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return out;
}

/** Rename/merge a tag inside one tag list: swaps `from` for `to`, dedupes. */
export function renamedTags(tags: string[], from: string, to: string): string[] {
  return [...new Set(tags.map((t) => (t === from ? to : t)))];
}
