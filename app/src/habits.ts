import type { Habit, HabitLog } from './types';
import { addDays, parseLocalDate } from './dates';

export function isScheduledOn(habit: Habit, dateStr: string): boolean {
  if (habit.weekdays === null) return true;
  return habit.weekdays.includes(parseLocalDate(dateStr).getDay());
}

export function logsByDate(logs: HabitLog[], habitId: string): Map<string, HabitLog> {
  const m = new Map<string, HabitLog>();
  for (const l of logs) if (l.habitId === habitId) m.set(l.date, l);
  return m;
}

/** Determines whether a habit is considered completed for a given log row. */
export function isHabitDone(habit: Habit, log?: HabitLog | null): boolean {
  if (!log) return false;
  if (habit.targetType === 'numeric' && habit.targetValue && habit.targetValue > 0) {
    return (log.value ?? 0) >= habit.targetValue;
  }
  return true;
}

/** Percentage (0-100) toward target for a given habit log. */
export function habitProgressPct(habit: Habit, log?: HabitLog | null): number {
  if (!log) return 0;
  if (habit.targetType === 'numeric' && habit.targetValue && habit.targetValue > 0) {
    return Math.min(100, Math.round(((log.value ?? 0) / habit.targetValue) * 100));
  }
  return 100;
}

// Consecutive scheduled days completed, ending at the most recent scheduled
// day. A not-yet-done today does not break the streak; a missed scheduled
// day does.
export function currentStreak(habit: Habit, logs: HabitLog[], today: string): number {
  const m = logsByDate(logs, habit.id);
  const isDone = (d: string) => isHabitDone(habit, m.get(d));
  let day = today;
  if (isScheduledOn(habit, day) && !isDone(day)) day = addDays(day, -1);
  let streak = 0;
  // safety bound: a habit can't have a longer history than the app exists
  for (let i = 0; i < 3700; i++) {
    if (!isScheduledOn(habit, day)) {
      day = addDays(day, -1);
      continue;
    }
    if (!isDone(day)) break;
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

export interface DayCell {
  date: string;
  scheduled: boolean;
  done: boolean;
  isToday: boolean;
}

export function weekGrid(habit: Habit, logs: HabitLog[], today: string, days = 7): DayCell[] {
  const m = logsByDate(logs, habit.id);
  const cells: DayCell[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    cells.push({
      date,
      scheduled: isScheduledOn(habit, date),
      done: isHabitDone(habit, m.get(date)),
      isToday: date === today,
    });
  }
  return cells;
}

// Longest run of consecutive scheduled-and-done days in the habit's history.
export function bestStreak(habit: Habit, logs: HabitLog[]): number {
  const m = logsByDate(logs, habit.id);
  const dates = [...m.keys()].filter((d) => isHabitDone(habit, m.get(d))).sort();
  if (dates.length === 0) return 0;
  const done = new Set(dates);
  let best = 0;
  let cur = 0;
  let day = dates[0];
  const last = dates[dates.length - 1];
  for (let i = 0; i < 3700 && day <= last; i++) {
    if (!isScheduledOn(habit, day)) {
      day = addDays(day, 1);
      continue;
    }
    if (done.has(day)) {
      cur++;
      best = Math.max(best, cur);
    } else {
      cur = 0;
    }
    day = addDays(day, 1);
  }
  return best;
}

// Completion rate over the last `days` days: done / scheduled (0 when unscheduled).
export function completionRate(habit: Habit, logs: HabitLog[], today: string, days = 30): number | null {
  const m = logsByDate(logs, habit.id);
  let scheduled = 0;
  let hit = 0;
  for (let i = 0; i < days; i++) {
    const d = addDays(today, -i);
    if (!isScheduledOn(habit, d)) continue;
    scheduled++;
    if (isHabitDone(habit, m.get(d))) hit++;
  }
  return scheduled === 0 ? null : hit / scheduled;
}

export interface MonthGridCell {
  date: string;
  scheduled: boolean;
  done: boolean;
  isToday: boolean;
  isFuture: boolean;
  progressPct: number;
  value?: number;
}

/**
 * 4-week grid aligned to standard ISO weeks (Monday to Sunday).
 * Each row represents one week, ending with the current week.
 * Column 0 is always Monday, Column 6 is always Sunday.
 */
export function isoMonthGrid(habit: Habit, logs: HabitLog[], today: string, weeks = 4): MonthGridCell[] {
  const m = logsByDate(logs, habit.id);
  const todayDate = parseLocalDate(today);
  // ISO day: 0=Mon, 1=Tue, ..., 6=Sun
  const todayIso = (todayDate.getDay() + 6) % 7;
  // Start Monday is (weeks - 1) full weeks ago plus days back to Monday of this week
  const startOffset = (weeks - 1) * 7 + todayIso;
  const totalDays = weeks * 7;
  const cells: MonthGridCell[] = [];

  for (let i = 0; i < totalDays; i++) {
    const offset = i - startOffset;
    const date = addDays(today, offset);
    const isFuture = date > today;
    const isToday = date === today;
    const log = m.get(date);
    const scheduled = isScheduledOn(habit, date);
    const done = isFuture ? false : isHabitDone(habit, log);
    const progressPct = isFuture ? 0 : habitProgressPct(habit, log);

    cells.push({
      date,
      scheduled,
      done,
      isToday,
      isFuture,
      progressPct,
      value: log?.value,
    });
  }

  return cells;
}

export interface HabitsDailySummary {
  scheduledCount: number;
  completedCount: number;
  progressPct: number;
  allDone: boolean;
  bestActiveStreak: { habitName: string; streak: number } | null;
}

export function calculateHabitsSummary(habits: Habit[], logs: HabitLog[], today: string): HabitsDailySummary {
  const active = habits.filter((h) => !h.archived);
  const scheduled = active.filter((h) => isScheduledOn(h, today));
  const logsMap = new Map<string, HabitLog>();
  for (const l of logs) if (l.date === today) logsMap.set(l.habitId, l);

  let completed = 0;
  for (const h of scheduled) {
    if (isHabitDone(h, logsMap.get(h.id))) completed++;
  }

  let bestStreakHabit: { habitName: string; streak: number } | null = null;
  for (const h of active) {
    const streak = currentStreak(h, logs, today);
    if (streak > 0 && (!bestStreakHabit || streak > bestStreakHabit.streak)) {
      bestStreakHabit = { habitName: h.name, streak };
    }
  }

  const scheduledCount = scheduled.length;
  const progressPct = scheduledCount > 0 ? Math.round((completed / scheduledCount) * 100) : 0;
  const allDone = scheduledCount > 0 && completed === scheduledCount;

  return {
    scheduledCount,
    completedCount: completed,
    progressPct,
    allDone,
    bestActiveStreak: bestStreakHabit,
  };
}
