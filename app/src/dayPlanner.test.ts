import { describe, it, expect } from 'vitest';
import {
  DAY_MINUTES,
  fmt,
  fmtD,
  parseTime,
  snap,
  computeTimelineLayout,
  DEFAULT_RECURRING_PLANS,
  isRecurringOnDate,
  combineDayBlocks,
  type ScheduledBlock,
  type RecurringPlan,
} from './dayPlanner';
import type { Task } from './types';

describe('dayPlanner pure functions', () => {
  it('formats minutes into HH:MM and handles wrap-around', () => {
    expect(fmt(0)).toBe('00:00');
    expect(fmt(90)).toBe('01:30');
    expect(fmt(870)).toBe('14:30');
    expect(fmt(1439)).toBe('23:59');
    expect(fmt(1440)).toBe('00:00');
  });

  it('formats duration into friendly Xh Ym', () => {
    expect(fmtD(0)).toBe('0m');
    expect(fmtD(45)).toBe('45m');
    expect(fmtD(60)).toBe('1h');
    expect(fmtD(90)).toBe('1h 30m');
    expect(fmtD(540)).toBe('9h');
  });

  it('parses time strings to day minutes', () => {
    expect(parseTime('00:00')).toBe(0);
    expect(parseTime('09:15')).toBe(555);
    expect(parseTime('23:59')).toBe(1439);
    expect(parseTime('invalid')).toBe(0);
  });

  it('snaps minutes to specified intervals', () => {
    expect(snap(14, 15)).toBe(15);
    expect(snap(7, 15)).toBe(0);
    expect(snap(8, 15)).toBe(15);
    expect(snap(22, 5)).toBe(20);
    expect(snap(23, 5)).toBe(25);
    expect(snap(40, 30)).toBe(30);
    expect(snap(50, 30)).toBe(60);
  });

  it('computes timeline layout with non-overlapping blocks', () => {
    const blocks: ScheduledBlock[] = [
      { id: '1', title: 'Morning', color: '#fff', start: 540, dur: 60 },
      { id: '2', title: 'Lunch', color: '#fff', start: 720, dur: 45 },
    ];
    const layout = computeTimelineLayout(blocks);
    expect(layout.totalPlannedMinutes).toBe(105);
    expect(layout.freeMinutes).toBe(DAY_MINUTES - 105);
    expect(layout.hasOverlap).toBe(false);
    expect(layout.segments).toHaveLength(2);
    expect(layout.segments[0].i).toBe(0);
    expect(layout.segments[0].n).toBe(1);
  });

  it('detects overlaps and assigns separate lanes', () => {
    const blocks: ScheduledBlock[] = [
      { id: '1', title: 'Task A', color: '#fff', start: 600, dur: 60 },
      { id: '2', title: 'Task B', color: '#fff', start: 630, dur: 60 },
    ];
    const layout = computeTimelineLayout(blocks);
    expect(layout.hasOverlap).toBe(true);
    expect(layout.totalPlannedMinutes).toBe(90);
    expect(layout.segments).toHaveLength(2);
    expect(layout.segments.some((s) => s.i === 1)).toBe(true);
    expect(layout.segments.every((s) => s.n === 2)).toBe(true);
  });

  it('splits blocks spanning midnight into evening and morning continuation', () => {
    const blocks: ScheduledBlock[] = [
      { id: '1', title: 'Overnight Sleep', color: '#fff', start: 1380, dur: 120 },
    ];
    const layout = computeTimelineLayout(blocks);
    expect(layout.segments).toHaveLength(2);
    const evening = layout.segments.find((s) => !s.cont);
    const morning = layout.segments.find((s) => s.cont);
    expect(evening).toBeDefined();
    expect(evening?.s).toBe(1380);
    expect(evening?.e).toBe(1440);
    expect(evening?.last).toBe(false);

    expect(morning).toBeDefined();
    expect(morning?.s).toBe(0);
    expect(morning?.e).toBe(60);
    expect(morning?.last).toBe(true);
  });


  it('evaluates recurring plan patterns correctly (daily, weekdays, weekends, weekly)', () => {
    // 2026-11-05 is a Thursday (weekday)
    // 2026-11-07 is a Saturday (weekend)
    // 2026-11-08 is a Sunday (weekend)
    const dailyPlan = { recurrence: 'daily' as const, active: true };
    const weekdayPlan = { recurrence: 'weekdays' as const, active: true };
    const weekendPlan = { recurrence: 'weekends' as const, active: true };
    const mwfPlan = { recurrence: 'weekly' as const, weekdays: [1, 3, 5], active: true }; // Mon, Wed, Fri
    const sundayPlan = { recurrence: 'weekly' as const, weekdays: [0], active: true }; // Sun

    expect(isRecurringOnDate(dailyPlan, '2026-11-05')).toBe(true);
    expect(isRecurringOnDate(dailyPlan, '2026-11-07')).toBe(true);

    expect(isRecurringOnDate(weekdayPlan, '2026-11-05')).toBe(true);
    expect(isRecurringOnDate(weekdayPlan, '2026-11-07')).toBe(false);

    expect(isRecurringOnDate(weekendPlan, '2026-11-05')).toBe(false);
    expect(isRecurringOnDate(weekendPlan, '2026-11-07')).toBe(true);
    expect(isRecurringOnDate(weekendPlan, '2026-11-08')).toBe(true);

    // Thursday is weekday 4, so not in [1, 3, 5]
    expect(isRecurringOnDate(mwfPlan, '2026-11-05')).toBe(false);
    // Friday (2026-11-06) is weekday 5
    expect(isRecurringOnDate(mwfPlan, '2026-11-06')).toBe(true);

    expect(isRecurringOnDate(sundayPlan, '2026-11-08')).toBe(true);
    expect(isRecurringOnDate(sundayPlan, '2026-11-05')).toBe(false);
  });

  it('combines Lifedash tasks and matching recurring plans for a date', () => {
    const tasks: Task[] = [
      {
        id: 't1',
        title: 'Project Review',
        status: 'active',
        parentId: null,
        projectId: 'p1',
        dueDate: '2026-11-05',
        plannedDate: '2026-11-05',
        plannedTime: '10:00',
        durationMinutes: 60,
        blockedBy: [],
        tags: [],
      } as unknown as Task,
    ];
    const recurring: RecurringPlan[] = [
      {
        id: 'r1',
        title: 'Deep Work',
        color: '#0f766e',
        startTime: '08:00',
        durationMinutes: 90,
        recurrence: 'weekdays',
        active: true,
      },
      {
        id: 'r2',
        title: 'Weekend Hike',
        color: '#16a34a',
        startTime: '09:00',
        durationMinutes: 120,
        recurrence: 'weekends',
        active: true,
      },
    ];
    const doneKeys = new Set(['r1:2026-11-05']);
    const blocks = combineDayBlocks(tasks, recurring, doneKeys, '2026-11-05');

    // On Thursday 2026-11-05: Deep Work + Project Review (Weekend Hike excluded)
    expect(blocks).toHaveLength(2);
    const r1Block = blocks.find((b) => b.recurringPlanId === 'r1');
    const t1Block = blocks.find((b) => b.taskId === 't1');

    expect(r1Block).toBeDefined();
    expect(r1Block?.isRecurring).toBe(true);
    expect(r1Block?.done).toBe(true); // marked done in doneKeys
    expect(r1Block?.start).toBe(480); // 08:00

    expect(t1Block).toBeDefined();
    expect(t1Block?.start).toBe(600); // 10:00
  });

  it('provides default recurring plans', () => {
    expect(DEFAULT_RECURRING_PLANS.length).toBeGreaterThanOrEqual(5);
    expect(DEFAULT_RECURRING_PLANS.some((r) => r.title === 'Sleep')).toBe(true);
    expect(DEFAULT_RECURRING_PLANS.some((r) => r.recurrence === 'weekdays')).toBe(true);
  });
});
