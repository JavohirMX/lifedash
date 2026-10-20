import { describe, it, expect } from 'vitest';
import { isScheduledOn, currentStreak, weekGrid } from '../src/habits';
import type { Habit, HabitLog } from '../src/types';

function habit(weekdays: number[] | null = null): Habit {
  return { id: 'h1', name: 'Read', color: '#6366f1', weekdays, order: 0, archived: false, createdAt: 0 };
}

function log(habitId: string, date: string): HabitLog {
  return { id: `${habitId}:${date}`, habitId, date, doneAt: 0 };
}

// 2026-10-20 is a Tuesday
describe('habits', () => {
  it('scheduled every day when weekdays is null; else only listed weekdays', () => {
    expect(isScheduledOn(habit(null), '2026-10-20')).toBe(true);
    expect(isScheduledOn(habit([2]), '2026-10-20')).toBe(true); // Tue
    expect(isScheduledOn(habit([1, 3]), '2026-10-20')).toBe(false);
    expect(isScheduledOn(habit([0, 6]), '2026-10-18')).toBe(true); // Sun
  });

  it('streak counts consecutive scheduled days ending today', () => {
    const logs = [log('h1', '2026-10-20'), log('h1', '2026-10-19'), log('h1', '2026-10-18'), log('h1', '2026-10-16')];
    expect(currentStreak(habit(null), logs, '2026-10-20')).toBe(3); // 17th missed
  });

  it('an unfinished today does not break the streak', () => {
    const logs = [log('h1', '2026-10-19'), log('h1', '2026-10-18')];
    expect(currentStreak(habit(null), logs, '2026-10-20')).toBe(2);
  });

  it('a missed scheduled day breaks the streak', () => {
    const logs = [log('h1', '2026-10-20'), log('h1', '2026-10-18')];
    expect(currentStreak(habit(null), logs, '2026-10-20')).toBe(1);
  });

  it('unscheduled days are skipped without breaking', () => {
    // habit on Mon+Wed only; 10-19 Mon, 10-21 Wed
    const logs = [log('h1', '2026-10-21'), log('h1', '2026-10-19'), log('h1', '2026-10-14')];
    expect(currentStreak(habit([1, 3]), logs, '2026-10-21')).toBe(3); // Wed, Mon, prev Wed; Tue skipped
  });

  it('weekGrid returns 7 cells ending today with scheduled/done flags', () => {
    const logs = [log('h1', '2026-10-20')];
    const grid = weekGrid(habit([2, 3]), logs, '2026-10-20'); // Tue+Wed; 10-14 is a Wed
    expect(grid).toHaveLength(7);
    expect(grid[6]).toEqual({ date: '2026-10-20', scheduled: true, done: true, isToday: true });
    expect(grid[5]).toMatchObject({ date: '2026-10-19', scheduled: false, done: false });
    expect(grid[0]).toMatchObject({ date: '2026-10-14', scheduled: true, done: false });
  });
});
