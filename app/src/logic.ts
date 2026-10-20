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
