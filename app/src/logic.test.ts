import { describe, expect, it } from 'vitest';
import { parseQuickAdd, groupCompletedByDay, renamedTags, completeTask, describeRecurrence } from './logic';
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

describe('renamedTags', () => {
  it('swaps the tag and keeps order', () => {
    expect(renamedTags(['home', 'work'], 'home', 'house')).toEqual(['house', 'work']);
  });
  it('merges into an existing tag without duplicating', () => {
    expect(renamedTags(['home', 'house'], 'home', 'house')).toEqual(['house']);
  });
  it('leaves other tags alone', () => {
    expect(renamedTags(['a', 'b'], 'x', 'y')).toEqual(['a', 'b']);
  });
});

describe('completeTask recurrence spawning', () => {
  const base: Parameters<typeof completeTask>[0] = {
    id: 't1',
    title: 'Water plants',
    note: '',
    noteDoc: null,
    projectId: 'inbox',
    parentId: null,
    goalId: null,
    noteId: null,
    status: 'active',
    pinned: false,
    priority: 1,
    dueDate: '2026-10-22',
    dueTime: null,
    recurrence: 'DTSTART:20261022T120000Z\nRRULE:FREQ=DAILY;INTERVAL=1',
    blockedBy: [],
    tags: ['home'],
    order: 3,
    seriesId: null,
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
  };

  it('marks a non-recurring task done without spawning', () => {
    const { updates, spawned } = completeTask({ ...base, recurrence: null }, '2026-10-21', 99);
    expect(updates.status).toBe('done');
    expect(updates.completedAt).toBe(99);
    expect(spawned).toBeNull();
  });

  it('does not spawn when the task has no due date', () => {
    const { spawned } = completeTask({ ...base, dueDate: null }, '2026-10-21', 99);
    expect(spawned).toBeNull();
  });

  it('spawns the next daily occurrence with the original id as seriesId', () => {
    const { spawned } = completeTask(base, '2026-10-22', 99);
    expect(spawned).not.toBeNull();
    expect(spawned!.dueDate).toBe('2026-10-23');
    expect(spawned!.seriesId).toBe('t1');
    expect(spawned!.recurrence).toBe(base.recurrence);
    expect(spawned!.tags).toEqual(['home']);
    expect(spawned!.projectId).toBe('inbox');
    expect(spawned!.status).toBe('active');
    expect(spawned!.completedAt).toBeNull();
  });

  it('keeps an existing seriesId through the chain', () => {
    const { spawned } = completeTask({ ...base, seriesId: 'root' }, '2026-10-22', 99);
    expect(spawned!.seriesId).toBe('root');
  });

  it('completing early advances from the scheduled date, not from today', () => {
    const { spawned } = completeTask(base, '2026-10-21', 99);
    expect(spawned!.dueDate).toBe('2026-10-23');
  });

  it('completing late jumps to the first occurrence after today', () => {
    const { spawned } = completeTask(base, '2026-10-25', 99);
    expect(spawned!.dueDate).toBe('2026-10-26');
  });

  it('a malformed rule completes without spawning instead of throwing', () => {
    // Restored/synced rows can carry a rule string RRule cannot parse.
    const { updates, spawned } = completeTask({ ...base, recurrence: 'GARBAGE-NOT-A-RULE' }, '2026-10-22', 99);
    expect(updates.status).toBe('done');
    expect(spawned).toBeNull();
  });
});

describe('describeRecurrence', () => {
  it('labels the standard rules', () => {
    expect(describeRecurrence('DTSTART:20261022T120000Z\nRRULE:FREQ=DAILY;INTERVAL=1')).toBe('Daily');
    expect(describeRecurrence('DTSTART:20261022T120000Z\nRRULE:FREQ=DAILY;INTERVAL=3')).toBe('Every 3 days');
    expect(describeRecurrence('DTSTART:20261022T120000Z\nRRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TH')).toBe('Weekly');
  });

  it('returns empty for no rule and a fallback for a malformed one', () => {
    expect(describeRecurrence(null)).toBe('');
    expect(describeRecurrence('GARBAGE-NOT-A-RULE')).toBe('Repeats');
  });
});
