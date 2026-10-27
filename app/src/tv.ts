import type { Habit, HabitLog, JournalEntry, Task } from './types';
import { addDays, todayStr } from './dates';
import { isScheduledOn } from './habits';

// Pure derivations for the read-only TV kiosk surface (#/tv).
// Everything the dashboard shows is computed here so it can be tested
// without a browser.

export interface TvHabitRow {
  habit: Habit;
  done: boolean;
}

export interface TvData {
  topTask: Task | null;
  topTaskOverdueSince: string | null;
  dueToday: Task[];
  dueTodayTotal: number;
  habitsToday: TvHabitRow[];
  habitsDone: number;
  habitsTotal: number;
  habitPct: number | null;
  weekScheduled: number;
  weekDone: number;
  weekPct: number | null;
  highlight: string | null;
}

const prio = (t: Task) => (t.priority === 0 ? 4 : t.priority);
const time = (t: Task) => t.dueTime ?? '99';

// The one task worth showing biggest: highest priority first, then the
// earliest due date, then earliest time, then oldest.
function compareTop(a: Task, b: Task): number {
  if (prio(a) !== prio(b)) return prio(a) - prio(b);
  if (a.dueDate !== b.dueDate) return (a.dueDate ?? '9999') < (b.dueDate ?? '9999') ? -1 : 1;
  if (time(a) !== time(b)) return time(a).localeCompare(time(b));
  return a.createdAt - b.createdAt;
}

// The due-today list reads chronologically: date, then priority, then time.
function compareDue(a: Task, b: Task): number {
  if (a.dueDate !== b.dueDate) return (a.dueDate ?? '9999') < (b.dueDate ?? '9999') ? -1 : 1;
  if (prio(a) !== prio(b)) return prio(a) - prio(b);
  if (time(a) !== time(b)) return time(a).localeCompare(time(b));
  return a.createdAt - b.createdAt;
}

export function deriveHighlight(entry: JournalEntry | null | undefined): string | null {
  const h = entry?.highlight?.trim();
  return h ? h : null;
}

export function deriveTv(
  tasks: Task[],
  habits: Habit[],
  logs: HabitLog[],
  journal: JournalEntry[],
  today: string = todayStr(),
): TvData {
  const due = tasks
    .filter((t) => t.status === 'active' && t.parentId === null && t.dueDate !== null && t.dueDate <= today)
    .sort(compareDue);
  const top = due.length > 0 ? [...due].sort(compareTop)[0] : null;

  const liveHabits = habits.filter((h) => !h.archived).sort((a, b) => a.order - b.order);
  const doneSet = new Set(logs.map((l) => `${l.habitId}:${l.date}`));
  const todayRows = liveHabits
    .filter((h) => isScheduledOn(h, today))
    .map((h) => ({ habit: h, done: doneSet.has(`${h.id}:${today}`) }));
  const habitsDone = todayRows.filter((r) => r.done).length;

  let weekScheduled = 0;
  let weekDone = 0;
  for (let i = 6; i >= 0; i--) {
    const date = addDays(today, -i);
    for (const h of liveHabits) {
      if (!isScheduledOn(h, date)) continue;
      weekScheduled++;
      if (doneSet.has(`${h.id}:${date}`)) weekDone++;
    }
  }

  return {
    topTask: top,
    topTaskOverdueSince: top && top.dueDate! < today ? top.dueDate! : null,
    dueToday: due,
    dueTodayTotal: due.length,
    habitsToday: todayRows,
    habitsDone,
    habitsTotal: todayRows.length,
    habitPct: todayRows.length > 0 ? Math.round((habitsDone / todayRows.length) * 100) : null,
    weekScheduled,
    weekDone,
    weekPct: weekScheduled > 0 ? Math.round((weekDone / weekScheduled) * 100) : null,
    highlight: deriveHighlight(journal.find((j) => j.date === today)),
  };
}
