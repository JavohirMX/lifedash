import { describe, expect, it } from 'vitest';
import { sessionSeconds, focusTotals, formatClock, formatDuration, runningSession, reconcileRunningSessions } from './focus';
import type { FocusSession } from './types';

const mk = (id: string, over: Partial<FocusSession> = {}): FocusSession => ({
  id, taskId: 't1', startedAt: 0, endedAt: null, seconds: 0, ...over,
});

describe('sessionSeconds', () => {
  it('uses the stored final value once stopped, live elapsed while running', () => {
    expect(sessionSeconds(mk('a', { startedAt: 1000, endedAt: 3601000, seconds: 3600 }), 9999999)).toBe(3600);
    expect(sessionSeconds(mk('b', { startedAt: 10_000 }), 70_000)).toBe(60);
  });
});

describe('formatClock / formatDuration', () => {
  it('formats m:ss for the live clock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(3599)).toBe('59:59');
  });
  it('formats compact durations', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(2700)).toBe('45m');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(7500)).toBe('2h 5m');
  });
});

describe('focusTotals', () => {
  // Local day 2026-10-20 in the test machine's timezone.
  const today = '2026-10-20';
  const dayStart = new Date('2026-10-20T00:00:00').getTime();
  const now = new Date('2026-10-20T12:00:00').getTime();

  it('splits a cross-midnight session: only the after-midnight part counts today', () => {
    const s = mk('x', { startedAt: dayStart - 3600_000, endedAt: dayStart + 3600_000, seconds: 7200 });
    const { perTask, todayTotal } = focusTotals([s], today, now);
    expect(todayTotal).toBe(3600);
    expect(perTask.get('t1')).toBe(7200);
  });

  it('counts the running part of an overnight session up to now', () => {
    const s = mk('x', { startedAt: dayStart - 7200_000 }); // started 22:00 yesterday
    const { todayTotal } = focusTotals([s], today, now);
    expect(todayTotal).toBe(12 * 3600); // 00:00 -> 12:00
  });

  it('sums per-task totals across sessions', () => {
    const a = mk('a', { taskId: 't1', startedAt: dayStart, endedAt: dayStart + 600_000, seconds: 600 });
    const b = mk('b', { taskId: 't2', startedAt: dayStart, endedAt: dayStart + 300_000, seconds: 300 });
    const { perTask, todayTotal } = focusTotals([a, b], today, now);
    expect(perTask.get('t1')).toBe(600);
    expect(perTask.get('t2')).toBe(300);
    expect(todayTotal).toBe(900);
  });
});

describe('runningSession / reconcileRunningSessions', () => {
  it('returns the running session, latest-started on conflicts', () => {
    expect(runningSession([mk('a', { endedAt: 5, seconds: 5 })])).toBeNull();
    const latest = runningSession([mk('a', { startedAt: 1 }), mk('b', { startedAt: 2 })]);
    expect(latest?.id).toBe('b');
  });

  it('finalizes every other running row at the keeper start, clamped to zero on ties', () => {
    const keeper = mk('keep', { startedAt: 10_000 });
    const older = mk('old', { startedAt: 4_000 });
    const tied = mk('tie', { startedAt: 10_000 });
    const out = reconcileRunningSessions([older, keeper, tied]);
    const byId = new Map(out.map((s) => [s.id, s]));
    expect(byId.get('keep')!.endedAt).toBeNull();
    expect(byId.get('old')!).toMatchObject({ endedAt: 10_000, seconds: 6 });
    expect(byId.get('tie')!).toMatchObject({ endedAt: 10_000, seconds: 0 });
  });

  it('leaves a single running session untouched', () => {
    const only = mk('only', { startedAt: 1 });
    const out = reconcileRunningSessions([only]);
    expect(out[0].endedAt).toBeNull();
  });
});

describe('local day boundary', () => {
  it('excludes the next local day and keeps only the pre-midnight half hour', () => {
    const day = '2026-11-01';
    const end = new Date(2026, 10, 2).getTime();
    const next = mk('next', { startedAt: end, endedAt: end + 3600000, seconds: 3600 });
    const crossing = mk('cross', { startedAt: end - 1800000, endedAt: end + 1800000, seconds: 3600 });
    expect(focusTotals([next], day, end + 3600000).todayTotal).toBe(0);
    expect(focusTotals([crossing], day, end + 1800000).todayTotal).toBe(1800);
  });
});
