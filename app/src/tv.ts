import type { FocusSession, Goal, Habit, HabitLog, JournalEntry, Project, Task } from './types';
import { addDays, parseLocalDate, todayStr, toLocalDateStr } from './dates';
import { isScheduledOn } from './habits';
import { focusTotals, runningSession, sessionSeconds } from './focus';
import { SAMPLE_MODE } from './dev/sampleMode';

// Pure derivations for the read-only TV kiosk surface (#/tv).
// Everything the dashboard shows is computed here so it can be tested
// without a browser.

export const TV_ENABLED_KEY = 'lifedash-tv-enabled';
export const TV_PREFERENCE_CHANGED_EVENT = 'lifedash-tv-preference-changed';

export function isTvEnabled(): boolean {
  if (SAMPLE_MODE) return true;
  try {
    return localStorage.getItem(TV_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setTvEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(TV_ENABLED_KEY, '1');
    } else {
      localStorage.removeItem(TV_ENABLED_KEY);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(TV_PREFERENCE_CHANGED_EVENT));
    }
  } catch {
    /* storage blocked */
  }
}

export function deriveGreeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 22) return 'Good evening';
  return 'Good night';
}

export interface TvHabitRow {
  habit: Habit;
  done: boolean;
}

export interface TvTaskItem {
  task: Task;
  project: { id: string; name: string; color: string } | null;
  overdueDays: number;
}

export interface TvGoalItem {
  id: string;
  title: string;
  targetDate: string | null;
}

export interface TvFocusData {
  runningTaskId: string | null;
  runningTaskTitle: string | null;
  runningStartedAt: number | null;
  runningSeconds: number;
  todaySeconds: number;
}

export interface TvData {
  greeting: string;
  topTask: Task | null;
  topTaskProject: { id: string; name: string; color: string } | null;
  topTaskOverdueSince: string | null;
  dueToday: Task[];
  dueTaskItems: TvTaskItem[];
  dueTodayTotal: number;
  completedTodayCount: number;
  habitsToday: TvHabitRow[];
  habitsDone: number;
  habitsTotal: number;
  habitPct: number | null;
  weekScheduled: number;
  weekDone: number;
  weekPct: number | null;
  highlight: string | null;
  focus: TvFocusData;
  activeGoals: TvGoalItem[];
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
  options?: {
    projects?: Project[];
    focusSessions?: FocusSession[];
    goals?: Goal[];
    now?: Date;
  },
): TvData {
  const now = options?.now ?? new Date();
  const nowMs = now.getTime();
  const projects = options?.projects ?? [];
  const focusSessions = options?.focusSessions ?? [];
  const goals = options?.goals ?? [];

  const projectMap = new Map(projects.map((p) => [p.id, { id: p.id, name: p.name, color: p.color }]));

  const due = tasks
    .filter((t) => t.status === 'active' && t.parentId === null && t.dueDate !== null && t.dueDate <= today)
    .sort(compareDue);
  const top = due.length > 0 ? [...due].sort(compareTop)[0] : null;

  const dueTaskItems: TvTaskItem[] = due.map((t) => {
    let overdueDays = 0;
    if (t.dueDate && t.dueDate < today) {
      overdueDays = Math.max(0, Math.round((parseLocalDate(today).getTime() - parseLocalDate(t.dueDate).getTime()) / 86400000));
    }
    return {
      task: t,
      project: projectMap.get(t.projectId) ?? null,
      overdueDays,
    };
  });

  const completedTodayCount = tasks.filter(
    (t) => t.status === 'done' && t.completedAt && toLocalDateStr(new Date(t.completedAt)) === today,
  ).length;

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

  // Focus
  const running = runningSession(focusSessions);
  const runningTask = running ? tasks.find((t) => t.id === running.taskId) : null;
  const runningSeconds = running ? sessionSeconds(running, nowMs) : 0;
  const totals = focusTotals(focusSessions, today, nowMs);

  // Active Goals
  const activeGoals: TvGoalItem[] = goals
    .filter((g) => g.status === 'active')
    .sort((a, b) => a.order - b.order)
    .slice(0, 4)
    .map((g) => ({
      id: g.id,
      title: g.title,
      targetDate: g.targetDate,
    }));

  return {
    greeting: deriveGreeting(now),
    topTask: top,
    topTaskProject: top ? projectMap.get(top.projectId) ?? null : null,
    topTaskOverdueSince: top && top.dueDate! < today ? top.dueDate! : null,
    dueToday: due,
    dueTaskItems,
    dueTodayTotal: due.length,
    completedTodayCount,
    habitsToday: todayRows,
    habitsDone,
    habitsTotal: todayRows.length,
    habitPct: todayRows.length > 0 ? Math.round((habitsDone / todayRows.length) * 100) : null,
    weekScheduled,
    weekDone,
    weekPct: weekScheduled > 0 ? Math.round((weekDone / weekScheduled) * 100) : null,
    highlight: deriveHighlight(journal.find((j) => j.date === today)),
    focus: {
      runningTaskId: running?.taskId ?? null,
      runningTaskTitle: runningTask?.title ?? null,
      runningStartedAt: running?.startedAt ?? null,
      runningSeconds,
      todaySeconds: totals.todayTotal,
    },
    activeGoals,
  };
}
