import { describe, expect, it } from 'vitest';
import { parseQuickAdd, groupCompletedByDay } from './logic';
import type { Task } from './types';

describe('parseQuickAdd', () => {
  it('extracts tags and cleans the title', () => {
    expect(parseQuickAdd('Water plants #home #daily')).toEqual({ title: 'Water plants', tags: ['home', 'daily'] });
  });
  it('normalizes case and dash-separated words', () => {
    expect(parseQuickAdd('File taxes #Life-Admin')).toEqual({ title: 'File taxes', tags: ['life-admin'] });
  });
  it('ignores a bare # and mid-word hashes', () => {
    expect(parseQuickAdd('C# notes # dev')).toEqual({ title: 'C# notes # dev', tags: [] });
  });
});

describe('groupCompletedByDay', () => {
  const mk = (id: string, completedAt: number | null): Task => ({
    id, title: id, note: '', noteDoc: null, projectId: 'inbox', parentId: null,
    goalId: null, noteId: null, status: 'done', pinned: false, priority: 0,
    dueDate: null, dueTime: null, recurrence: null, blockedBy: [], tags: [],
    order: 0, seriesId: null, createdAt: 0, updatedAt: 0, completedAt,
  });
  const at = (day: string, h = 10) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00`).getTime();

  it('groups consecutive same-day tasks and labels Today/Yesterday', () => {
    const today = '2026-10-20';
    const list = [mk('a', at('2026-10-20', 12)), mk('b', at('2026-10-20', 9)), mk('c', at('2026-10-19'))];
    const groups = groupCompletedByDay(list, today);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday']);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['a', 'b']);
    expect(groups[1].tasks.map((t) => t.id)).toEqual(['c']);
  });

  it('uses weekday names within the last week', () => {
    const today = '2026-10-20'; // a Tuesday
    const groups = groupCompletedByDay([mk('a', at('2026-10-18'))], today);
    expect(groups[0].label).toBe('Sunday');
  });

  it('uses short dates beyond a week and adds year across years', () => {
    expect(groupCompletedByDay([mk('a', at('2026-10-01'))], '2026-10-20')[0].label).toBe('Oct 1');
    expect(groupCompletedByDay([mk('a', at('2025-12-30'))], '2026-01-05')[0].label).toBe('Dec 30, 2025');
  });

  it('puts missing completedAt in an Unknown date bucket', () => {
    const groups = groupCompletedByDay([mk('a', null)], '2026-10-20');
    expect(groups[0].label).toBe('Unknown date');
    expect(groups[0].day).toBe('');
  });

  it('returns no groups for an empty list', () => {
    expect(groupCompletedByDay([], '2026-10-20')).toEqual([]);
  });
});
