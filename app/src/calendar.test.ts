import { describe, expect, it } from 'vitest';
import { monthCells, shiftMonth } from './views/CalendarView';

describe('monthCells', () => {
  it('builds a Monday-first grid covering the whole month', () => {
    const cells = monthCells('2026-10');
    // Oct 1 2026 is a Thursday: grid starts Mon Sep 28, 5 weeks, ends Sun Nov 1.
    expect(cells).toHaveLength(35);
    expect(cells[0]).toBe('2026-09-28');
    expect(cells[34]).toBe('2026-11-01');
  });

  it('handles a month starting on Monday with no leading padding', () => {
    const cells = monthCells('2026-06');
    // Jun 1 2026 is a Monday.
    expect(cells[0]).toBe('2026-06-01');
    expect(cells).toContain('2026-06-30');
    expect(cells.length % 7).toBe(0);
  });

  it('covers leap-day February', () => {
    const cells = monthCells('2024-02');
    expect(cells).toContain('2024-02-29');
  });

  it('covers non-leap February', () => {
    const cells = monthCells('2026-02');
    expect(cells).toContain('2026-02-28');
    expect(cells).not.toContain('2026-02-29');
  });
});

describe('shiftMonth', () => {
  it('crosses year boundaries both ways', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
  });
});
