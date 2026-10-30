import { addDays, parseLocalDate } from './dates';
import { INBOX_ID } from './db';
import { isScheduledOn } from './habits';
import type { Goal, Habit, HabitLog, Task } from './types';

export function reviewTasks(tasks: Task[], today: string) {
  const active = tasks.filter(t => t.status === 'active');
  return {
    inbox: active.filter(t => t.projectId === INBOX_ID),
    overdue: active.filter(t => t.dueDate && t.dueDate < today),
    // Shown explicitly as unchanged for 14 days, not a judgment of importance.
    unchanged: active.filter(t => t.updatedAt < parseLocalDate(addDays(today, -14)).getTime()),
  };
}
export function goalsWithoutNextAction(goals: Goal[], tasks: Task[]) {
  return goals.filter(g => g.status === 'active' && !tasks.some(t => t.goalId === g.id && t.status === 'active'));
}
export function reviewHabit(habit: Habit, logs: HabitLog[], today: string) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).filter(d => isScheduledOn(habit, d));
  const done = new Set(logs.filter(l => l.habitId === habit.id).map(l => l.date));
  return { scheduled: dates.length, done: dates.filter(d => done.has(d)).length };
}
