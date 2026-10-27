import { describe, expect, it } from 'vitest';
import { parseQuickAdd, groupCompletedByDay, renamedTags, completeTask, skipOccurrence, extractChecklistItems, filterNewChecklistItems, describeRecurrence, isRecurrenceValid, nextOccurrenceDate, makeRecurrence, upNextGroups } from './logic';
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
    expect(describeRecurrence('GARBAGE-NOT-A-RULE')).toBe('Invalid repeat rule');
  });
});

describe('isRecurrenceValid', () => {
  it('accepts null and parseable rules, rejects garbage', () => {
    expect(isRecurrenceValid(null)).toBe(true);
    expect(isRecurrenceValid('DTSTART:20261022T120000Z\nRRULE:FREQ=DAILY;INTERVAL=1')).toBe(true);
    expect(isRecurrenceValid('GARBAGE-NOT-A-RULE')).toBe(false);
  });
});

describe('nextOccurrenceDate monthly clamping', () => {
  it("clamps a monthly rule on the 31st to February's last day instead of skipping it", () => {
    const rule = makeRecurrence('monthly', '2025-01-31');
    expect(nextOccurrenceDate(rule, '2025-01-31', '2025-01-31')).toBe('2025-02-28');
    // Anchored day is preserved after the clamped month.
    expect(nextOccurrenceDate(rule, '2025-02-28', '2025-02-28')).toBe('2025-03-31');
  });

  it('clamps the 29th in non-leap years and keeps it in leap years', () => {
    const rule = makeRecurrence('monthly', '2025-01-29');
    expect(nextOccurrenceDate(rule, '2025-01-29', '2025-01-29')).toBe('2025-02-28');
    expect(nextOccurrenceDate(rule, '2026-01-29', '2026-01-29')).toBe('2026-02-28');
    const leap = makeRecurrence('monthly', '2024-01-29');
    expect(nextOccurrenceDate(leap, '2024-01-29', '2024-01-29')).toBe('2024-02-29');
  });

  it('does not clamp short months when the day fits, and skips missed occurrences', () => {
    const rule = makeRecurrence('monthly', '2025-01-15');
    expect(nextOccurrenceDate(rule, '2025-01-15', '2025-01-15')).toBe('2025-02-15');
    // Overdue by two months: schedules the next month, not a pile of past days.
    expect(nextOccurrenceDate(rule, '2025-01-15', '2025-03-20')).toBe('2025-04-15');
  });

  it('leaves daily and weekly rules untouched', () => {
    const daily = makeRecurrence('daily', '2025-01-31');
    expect(nextOccurrenceDate(daily, '2025-01-31', '2025-01-31')).toBe('2025-02-01');
    const weekly = makeRecurrence('weekly', '2025-01-31');
    expect(nextOccurrenceDate(weekly, '2025-01-31', '2025-01-31')).toBe('2025-02-07');
  });
});

describe('upNextGroups', () => {
  const mk = (id: string, over: Partial<Task>): Task => ({
    id, title: id, note: '', noteDoc: null, projectId: 'inbox', parentId: null,
    goalId: null, noteId: null, status: 'active', pinned: false, priority: 0,
    dueDate: null, dueTime: null, recurrence: null, blockedBy: [], tags: [],
    order: 0, seriesId: null, createdAt: 0, updatedAt: 0, completedAt: null,
    ...over,
  });
  const today = '2026-10-20';
  const now = new Date('2026-10-20T12:00:00').getTime();
  const day = 86400000;

  it('groups overdue and due soon, excluding today and including the +2 edge', () => {
    const g = upNextGroups([
      mk('over', { dueDate: '2026-10-19' }),
      mk('today', { dueDate: '2026-10-20' }),
      mk('soon1', { dueDate: '2026-10-21' }),
      mk('soon2', { dueDate: '2026-10-22' }),
      mk('later', { dueDate: '2026-10-23' }),
    ], today, now);
    expect(g.overdue.map((t) => t.id)).toEqual(['over']);
    expect(g.dueSoon.map((t) => t.id)).toEqual(['soon1', 'soon2']);
  });

  it('flags backlog tasks untouched for 14+ days, not fresher or dated ones', () => {
    const g = upNextGroups([
      mk('stale', { updatedAt: now - 14 * day }),
      mk('fresh', { updatedAt: now - 13 * day }),
      mk('dated', { dueDate: '2026-10-25', updatedAt: now - 30 * day }),
    ], today, now);
    expect(g.staleBacklog.map((t) => t.id)).toEqual(['stale']);
  });

  it('detects stored repeat rules that fail to parse', () => {
    const g = upNextGroups([
      mk('broken', { recurrence: 'BOGUS' }),
      mk('fine', { recurrence: null }),
    ], today, now);
    expect(g.brokenRules.map((t) => t.id)).toEqual(['broken']);
  });

  it('excludes done, archived and subtasks from every group', () => {
    const g = upNextGroups([
      mk('done', { status: 'done', dueDate: '2026-10-19', updatedAt: now - 30 * day, recurrence: 'BOGUS' }),
      mk('arch', { status: 'archived', dueDate: '2026-10-19', updatedAt: now - 30 * day }),
      mk('sub', { parentId: 'p', dueDate: '2026-10-19', updatedAt: now - 30 * day }),
    ], today, now);
    expect(g.overdue).toEqual([]);
    expect(g.dueSoon).toEqual([]);
    expect(g.staleBacklog).toEqual([]);
    expect(g.brokenRules).toEqual([]);
  });
});

describe('skipOccurrence', () => {
  const base = {
    id: 't1', title: 'Daily standup', note: '', noteDoc: null, projectId: 'inbox',
    parentId: null, goalId: null, noteId: null, status: 'active' as const,
    pinned: false, priority: 0, dueDate: '2026-10-27', dueTime: null,
    recurrence: 'DTSTART:20261027T000000\nRRULE:FREQ=DAILY', blockedBy: [], tags: [],
    order: 0, seriesId: null, createdAt: 1, updatedAt: 1, completedAt: null,
  };

  it('advances to the next occurrence after today and records the skipped date', () => {
    const r = skipOccurrence(base, '2026-10-27', 1000);
    expect(r).not.toBeNull();
    expect(r!.updates.dueDate).toBe('2026-10-28');
    expect(r!.updates.skippedDates).toEqual(['2026-10-27']);
  });

  it('returns null without a recurrence rule', () => {
    expect(skipOccurrence({ ...base, recurrence: null }, '2026-10-27', 1000)).toBeNull();
  });

  it('accumulates skipped dates across skips', () => {
    const once = { ...base, skippedDates: ['2026-10-26'] };
    const r = skipOccurrence(once, '2026-10-27', 1000);
    expect(r!.updates.skippedDates).toEqual(['2026-10-26', '2026-10-27']);
  });

  it('skippedDates survives the JSON roundtrip used by export and sync', () => {
    const t = { ...base, skippedDates: ['2026-10-25', '2026-10-26'] };
    const round = JSON.parse(JSON.stringify(t));
    expect(round.skippedDates).toEqual(['2026-10-25', '2026-10-26']);
  });

  it('carries skipped dates into the spawned occurrence on completion', () => {
    const t = { ...base, skippedDates: ['2026-10-25', '2026-10-26'] };
    const { spawned } = completeTask(t, '2026-10-27', 1000);
    expect(spawned).not.toBeNull();
    expect((spawned as { skippedDates?: string[] }).skippedDates).toEqual(['2026-10-25', '2026-10-26']);
  });
});

describe('extractChecklistItems', () => {
  const doc = (items: { text: string; checked: boolean }[]) => ({
    type: 'doc',
    content: [{
      type: 'taskList',
      content: items.map((i) => ({
        type: 'taskItem',
        attrs: { checked: i.checked },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: i.text }] }],
      })),
    }],
  });

  it('returns unchecked items only, trimmed', () => {
    const d = doc([{ text: '  Buy milk ', checked: false }, { text: 'Done thing', checked: true }]);
    expect(extractChecklistItems(d)).toEqual(['Buy milk']);
  });

  it('tolerates garbage docs', () => {
    expect(extractChecklistItems(null)).toEqual([]);
    expect(extractChecklistItems({ type: 'doc', content: 'junk' })).toEqual([]);
    expect(extractChecklistItems(42)).toEqual([]);
  });
});

describe('filterNewChecklistItems', () => {
  it('skips items already present as existing titles, case-insensitive and trimmed', () => {
    expect(filterNewChecklistItems(['Buy milk', '  buy MILK  ', 'Call mom'], ['buy milk'])).toEqual(['Call mom']);
  });

  it('dedups within the list, preserving order', () => {
    expect(filterNewChecklistItems(['A', 'b', 'A', 'B', 'c'], [])).toEqual(['A', 'b', 'c']);
  });

  it('returns empty when everything already exists', () => {
    expect(filterNewChecklistItems(['A', 'B'], ['a', 'b'])).toEqual([]);
  });
});
