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
