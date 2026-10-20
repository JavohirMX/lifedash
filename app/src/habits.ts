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

// Consecutive scheduled days completed, ending at the most recent scheduled
// day. A not-yet-done today does not break the streak; a missed scheduled
// day does.
export function currentStreak(habit: Habit, logs: HabitLog[], today: string): number {
  const done = logsByDate(logs, habit.id);
  let day = today;
  if (isScheduledOn(habit, day) && !done.has(day)) day = addDays(day, -1);
  let streak = 0;
  // safety bound: a habit can't have a longer history than the app exists
  for (let i = 0; i < 3700; i++) {
    if (!isScheduledOn(habit, day)) {
      day = addDays(day, -1);
      continue;
    }
    if (!done.has(day)) break;
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
  const done = logsByDate(logs, habit.id);
  const cells: DayCell[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    cells.push({
      date,
      scheduled: isScheduledOn(habit, date),
      done: done.has(date),
      isToday: date === today,
    });
  }
  return cells;
}

// Longest run of consecutive scheduled-and-done days in the habit's history.
export function bestStreak(habit: Habit, logs: HabitLog[]): number {
  const dates = logs.filter((l) => l.habitId === habit.id).map((l) => l.date).sort();
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
  const done = logsByDate(logs, habit.id);
  let scheduled = 0;
  let hit = 0;
  for (let i = 0; i < days; i++) {
    const d = addDays(today, -i);
    if (!isScheduledOn(habit, d)) continue;
    scheduled++;
    if (done.has(d)) hit++;
  }
  return scheduled === 0 ? null : hit / scheduled;
}
