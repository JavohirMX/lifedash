import { describe, it, expect } from 'vitest';
import { isScheduledOn, currentStreak, weekGrid, bestStreak, completionRate, isHabitDone, habitProgressPct, isoMonthGrid, calculateHabitsSummary } from '../src/habits';
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

describe('bestStreak', () => {
  it('finds the longest run, not the current one', () => {
    // done 1-5, missed 6, done 7-8
    const logs = ['2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05','2026-10-07','2026-10-08'].map((d) => log('h1', d));
    expect(bestStreak(habit(null), logs)).toBe(5);
  });
  it('skips unscheduled days without breaking the run', () => {
    // Mon/Wed/Fri habit: 2026-10-05 Mon, 07 Wed, 09 Fri all done
    const logs = ['2026-10-05','2026-10-07','2026-10-09'].map((d) => log('h1', d));
    expect(bestStreak(habit([1,3,5]), logs)).toBe(3);
  });
  it('empty history is 0', () => {
    expect(bestStreak(habit(null), [])).toBe(0);
  });
});

describe('completionRate', () => {
  it('done over scheduled in the window', () => {
    // last 4 days, 3 done
    const logs = ['2026-10-17','2026-10-18','2026-10-20'].map((d) => log('h1', d));
    expect(completionRate(habit(null), logs, '2026-10-20', 4)).toBeCloseTo(0.75);
  });
  it('null when nothing scheduled in the window', () => {
    expect(completionRate(habit([1]), [], '2026-10-18', 2)).toBeNull(); // Sun+Mon, habit on Mon only... 2026-10-18 is Sunday, window Sun+Mon
  });
});

describe('numeric habits', () => {
  const waterHabit: Habit = {
    id: 'h-water',
    name: 'Drink Water',
    color: '#0284c7',
    weekdays: null,
    targetType: 'numeric',
    targetValue: 2000,
    unit: 'ml',
    order: 0,
    archived: false,
    createdAt: 0,
  };

  it('determines completion based on target value', () => {
    expect(isHabitDone(waterHabit, null)).toBe(false);
    expect(isHabitDone(waterHabit, { id: '1', habitId: 'h-water', date: '2026-10-20', value: 1500, doneAt: 0 })).toBe(false);
    expect(isHabitDone(waterHabit, { id: '1', habitId: 'h-water', date: '2026-10-20', value: 2000, doneAt: 0 })).toBe(true);
    expect(isHabitDone(waterHabit, { id: '1', habitId: 'h-water', date: '2026-10-20', value: 2500, doneAt: 0 })).toBe(true);
  });

  it('calculates progress percentage toward target', () => {
    expect(habitProgressPct(waterHabit, null)).toBe(0);
    expect(habitProgressPct(waterHabit, { id: '1', habitId: 'h-water', date: '2026-10-20', value: 1000, doneAt: 0 })).toBe(50);
    expect(habitProgressPct(waterHabit, { id: '1', habitId: 'h-water', date: '2026-10-20', value: 2500, doneAt: 0 })).toBe(100);
  });

  it('only counts days meeting target toward streaks', () => {
    const logs: HabitLog[] = [
      { id: '1', habitId: 'h-water', date: '2026-10-20', value: 2000, doneAt: 0 },
      { id: '2', habitId: 'h-water', date: '2026-10-19', value: 1500, doneAt: 0 }, // Under target!
      { id: '3', habitId: 'h-water', date: '2026-10-18', value: 2000, doneAt: 0 },
    ];
    // 10-19 missed the target, so current streak ending on 10-20 is 1
    expect(currentStreak(waterHabit, logs, '2026-10-20')).toBe(1);
  });
});

describe('isoMonthGrid', () => {
  it('returns 28 cells aligned from Monday 3 weeks ago to Sunday this week', () => {
    // 2026-10-20 is a Tuesday (ISO day 1)
    const h = habit(null);
    const logs = [log('h1', '2026-10-20')];
    const grid = isoMonthGrid(h, logs, '2026-10-20', 4);
    expect(grid).toHaveLength(28);
    // Row 0, Col 0 should be Monday 2026-09-28 (22 days before Tuesday 10-20)
    expect(grid[0].date).toBe('2026-09-28');
    // Today is at index 22 (Tuesday of 4th week)
    expect(grid[22].date).toBe('2026-10-20');
    expect(grid[22].isToday).toBe(true);
    expect(grid[22].done).toBe(true);
    // Future days in current week: Wednesday 10-21 through Sunday 10-25
    expect(grid[23].date).toBe('2026-10-21');
    expect(grid[23].isFuture).toBe(true);
    expect(grid[27].date).toBe('2026-10-25');
    expect(grid[27].isFuture).toBe(true);
  });
});

describe('calculateHabitsSummary', () => {
  it('computes daily completion statistics and best active streak', () => {
    const h1: Habit = { id: 'h1', name: 'Walk', color: '#000', weekdays: null, order: 0, archived: false, createdAt: 0 };
    const h2: Habit = { id: 'h2', name: 'Read', color: '#000', weekdays: [2], order: 1, archived: false, createdAt: 0 }; // Tue
    const h3: Habit = { id: 'h3', name: 'Rest', color: '#000', weekdays: [0], order: 2, archived: false, createdAt: 0 }; // Sun only
    const logs = [
      log('h1', '2026-10-20'),
      log('h1', '2026-10-19'),
      log('h2', '2026-10-20'),
    ];
    // On 2026-10-20 (Tuesday): h1 (everyday) and h2 (Tue) are scheduled; h3 is not
    const summary = calculateHabitsSummary([h1, h2, h3], logs, '2026-10-20');
    expect(summary.scheduledCount).toBe(2);
    expect(summary.completedCount).toBe(2);
    expect(summary.progressPct).toBe(100);
    expect(summary.allDone).toBe(true);
    expect(summary.bestActiveStreak).toEqual({ habitName: 'Walk', streak: 2 });
  });
});

