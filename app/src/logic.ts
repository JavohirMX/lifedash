import { RRule, Frequency } from 'rrule';
import type { Task } from './types';
import { utcNoon, fromUtcNoon, parseLocalDate } from './dates';

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

export function describeRecurrence(rule: string | null): string {
  if (!rule) return '';
  const o = RRule.fromString(rule).origOptions;
  const n = o.interval ?? 1;
  switch (o.freq) {
    case Frequency.DAILY:
      return n === 1 ? 'Daily' : `Every ${n} days`;
    case Frequency.WEEKLY:
      return n === 1 ? 'Weekly' : `Every ${n} weeks`;
    case Frequency.MONTHLY:
      return n === 1 ? 'Monthly' : `Every ${n} months`;
    default:
      return 'Repeats';
  }
}

// Next occurrence strictly after max(dueDate, today), as a local date string.
// Skipping missed occurrences is intentional: completing an overdue daily task
// today schedules it for tomorrow, not for a pile of past days.
export function nextOccurrenceDate(rule: string, dueDate: string, today: string): string | null {
  const rr = RRule.fromString(rule);
  const base = dueDate > today ? dueDate : today;
  const next = rr.after(utcNoon(base), false);
  return next ? fromUtcNoon(next) : null;
}

export interface CompletionResult {
  updates: Partial<Task>;
  spawned: Omit<Task, 'id' | 'createdAt' | 'updatedAt'> | null;
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
      projectId: task.projectId,
      parentId: task.parentId,
      status: 'active',
      pinned: task.pinned,
      dueDate: nextDate,
      recurrence: task.recurrence,
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
  return groups;
}

export function backlogTasks(tasks: Task[]): Task[] {
  return sortTasks(tasks.filter((t) => active(t) && topLevel(t) && t.dueDate === null));
}

export function projectTasks(tasks: Task[], projectId: string): Task[] {
  return sortTasks(tasks.filter((t) => active(t) && topLevel(t) && t.projectId === projectId));
}

export function completedTasks(tasks: Task[]): Task[] {
  return [...tasks]
    .filter((t) => t.status === 'done')
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
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
  return { ...t, blockedBy: t.blockedBy ?? [], tags: t.tags ?? [] };
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

// --- Tags + search ---

export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-');
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
