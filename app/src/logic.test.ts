import { describe, expect, it } from 'vitest';
import { upcomingTasks, suggestedTask, parseQuickAdd, matchProject, groupCompletedByDay, renamedTags, completeTask, skipOccurrence, searchJournal, blockerCandidates, extractChecklistItems, filterNewChecklistItems, describeRecurrence, recurrenceChoice, isRecurrenceValid, nextOccurrenceDate, makeRecurrence, upNextGroups } from './logic';
import type { Task, Project } from './types';

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

  const proj = (id: string, name: string, archived = false): Project => ({
    id, name, color: '#000', order: 0, archived,
  });

  it('extracts +project and matches case-insensitively', () => {
    const projects = [proj('p1', 'Work'), proj('p2', 'Personal')];
    const res = parseQuickAdd('Submit quarterly report +work #finance', projects);
    expect(res.title).toBe('Submit quarterly report');
    expect(res.tags).toEqual(['finance']);
    expect(res.project).toEqual(projects[0]);
  });

  it('extracts @project syntax', () => {
    const projects = [proj('p1', 'Home')];
    const res = parseQuickAdd('Fix the leaky faucet @home', projects);
    expect(res.title).toBe('Fix the leaky faucet');
    expect(res.project).toEqual(projects[0]);
  });

  it('matches multi-word projects via slug or quotes', () => {
    const projects = [proj('p1', 'Life Admin'), proj('p2', 'CS 101')];
    const res1 = parseQuickAdd('Call insurance +life-admin', projects);
    expect(res1.title).toBe('Call insurance');
    expect(res1.project).toEqual(projects[0]);

    const res2 = parseQuickAdd('Pay bill +"Life Admin"', projects);
    expect(res2.title).toBe('Pay bill');
    expect(res2.project).toEqual(projects[0]);

    const res3 = parseQuickAdd('Finish homework +cs-101', projects);
    expect(res3.title).toBe('Finish homework');
    expect(res3.project).toEqual(projects[1]);
  });

  it('leaves unmatched project tokens in title and ignores archived projects', () => {
    const projects = [proj('arch', 'Old Work', true)];
    const res1 = parseQuickAdd('Archived chore +old-work', projects);
    expect(res1.title).toBe('Archived chore +old-work');
    expect(res1.project).toBeUndefined();

    const res2 = parseQuickAdd('Solve 1 + 2 = 3 +unknown', [proj('p1', 'Work')]);
    expect(res2.title).toBe('Solve 1 + 2 = 3 +unknown');
    expect(res2.project).toBeUndefined();
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
  it('preserves invalid and absent classification used by the editor', () => {
    expect(recurrenceChoice(null)).toBe('none');
    expect(recurrenceChoice('GARBAGE-NOT-A-RULE')).toBe('invalid');
    expect(isRecurrenceValid('GARBAGE-NOT-A-RULE')).toBe(false);
  });

  it('labels extra constraints and non-editor shapes honestly without rewriting them', () => {
    for (const rule of [
      'DTSTART:20261028T120000Z\nRRULE:FREQ=DAILY;COUNT=5',
      'DTSTART:20261028T120000Z\nRRULE:FREQ=DAILY;INTERVAL=3;BYDAY=MO,WE',
      'DTSTART:20261028T120000Z\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE',
      'DTSTART:20261028T120000Z\nRRULE:FREQ=MONTHLY;BYMONTHDAY=28;UNTIL=20261228T120000Z',
      'RRULE:FREQ=DAILY',
    ]) expect(describeRecurrence(rule)).toBe('Custom repeat');
  });
  it('keeps every editor-generated basic label across anchor weekdays and month ends', () => {
    for (const date of ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-02-28', '2028-02-29']) {
      for (const [kind, label] of [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['ndays', 'Every 7 days']] as const) {
        expect(describeRecurrence(makeRecurrence(kind, date, 7))).toBe(label);
      }
    }
  });

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


describe('journal search highlights', () => {
  it('finds highlights independently of body text and tolerates older entries', () => {
    const entries = [
      { id: 'a', date: '2026-10-27', note: 'Ordinary day', highlight: 'First trail run' },
      { id: 'b', date: '2026-10-26', note: 'Trail maps' },
    ] as Parameters<typeof searchJournal>[0];
    expect(searchJournal(entries, 'trail').map(e => e.id)).toEqual(['a', 'b']);
    expect(searchJournal(entries, 'first').map(e => e.id)).toEqual(['a']);
  });
});


describe('blockerCandidates', () => {
  const task = (id: string, blockedBy: string[] = [], status = 'active') => ({ id, blockedBy, status }) as Task;
  it('omits self, existing blockers and inactive tasks', () => {
    const a = task('a', ['b']);
    expect(blockerCandidates([a, task('b'), task('c'), task('d', [], 'done')], a).map(t=>t.id)).toEqual(['c']);
  });
  it('omits a task that already depends on the target', () => {
    const a = task('a');
    expect(blockerCandidates([a, task('b', ['a']), task('c')], a).map(t=>t.id)).toEqual(['c']);
  });
  it('follows three-link chains when checking loops', () => {
    const a = task('a');
    expect(blockerCandidates([a, task('b',['a']), task('c',['b']), task('d',['c']), task('e')], a).map(t=>t.id)).toEqual(['e']);
  });
});


describe('upcoming day order', () => {
  it('orders days chronologically even when task priority puts a later day first', () => {
    const task = (id: string, dueDate: string, priority: number) => ({id, title:id, status:'active', parentId:null, dueDate, priority, pinned:false, order:0} as Task);
    const groups = upcomingTasks([task('later','2026-10-30',1),task('sooner','2026-10-29',0)],'2026-10-27');
    expect([...groups.keys()]).toEqual(['2026-10-29','2026-10-30']);
  });
});

describe('suggestedTask tomorrow fallback (Home, approved 2026-11-03)', () => {
  // Home suggests tomorrow's task only when nothing is due today; the
  // default (no opt-in) keeps today-only behavior for other callers.
  const task = (id: string, dueDate: string | null, extra: Partial<Task> = {}) =>
    ({ id, title: id, status: 'active', parentId: null, dueDate, priority: 0, pinned: false, order: 0, blockedBy: [], ...extra } as Task);

  it('suggests tomorrow when nothing is due today, labelled honestly', () => {
    const t = task('tmr', '2026-10-28');
    expect(suggestedTask([t], '2026-10-27', { tomorrowFallback: true })).toMatchObject({ task: { id: 'tmr' }, reason: 'Due tomorrow' });
  });

  it('still prefers a due-today task over tomorrow', () => {
    const today = task('tdy', '2026-10-27');
    const tmr = task('tmr', '2026-10-28');
    expect(suggestedTask([tmr, today], '2026-10-27', { tomorrowFallback: true })?.task.id).toBe('tdy');
  });

  it('does not reach past tomorrow', () => {
    const later = task('later', '2026-10-29');
    expect(suggestedTask([later], '2026-10-27', { tomorrowFallback: true })).toBeNull();
  });

  it('excludes blocked and subtasks from the tomorrow fallback', () => {
    const blocker = task('blocker', null);
    const blocked = task('blocked', '2026-10-28', { blockedBy: ['blocker'] });
    const child = task('child', '2026-10-28', { parentId: 'blocker' });
    expect(suggestedTask([blocker, blocked, child], '2026-10-27', { tomorrowFallback: true })).toBeNull();
  });

  it('picks among tomorrow tasks by priority, then time, then age', () => {
    const low = task('low', '2026-10-28', { priority: 3, createdAt: 1 });
    const high = task('high', '2026-10-28', { priority: 1, createdAt: 2 });
    expect(suggestedTask([low, high], '2026-10-27', { tomorrowFallback: true })?.task.id).toBe('high');
  });

  it('without the opt-in, tomorrow stays invisible (baseline pinned)', () => {
    const t = task('tmr', '2026-10-28');
    expect(suggestedTask([t], '2026-10-27')).toBeNull();
  });
});

describe('suggestedTask backlog fallback', () => {
  const task = (id: string, dueDate: string | null, extra: Partial<Task> = {}) =>
    ({ id, title: id, status: 'active', parentId: null, dueDate, priority: 0, pinned: false, order: 0, blockedBy: [], createdAt: 1000, updatedAt: 1000, ...extra } as Task);

  it('suggests top unblocked backlog task when nothing is due today', () => {
    const backlog = task('b1', null, { title: 'Do research' });
    expect(suggestedTask([backlog], '2026-10-27', { backlogFallback: true })).toMatchObject({
      task: { id: 'b1' },
      reason: 'From Backlog',
    });
  });

  it('still prefers a due-today task over backlog', () => {
    const today = task('tdy', '2026-10-27');
    const backlog = task('b1', null);
    expect(suggestedTask([backlog, today], '2026-10-27', { backlogFallback: true })?.task.id).toBe('tdy');
  });

  it('labels priority on backlog tasks honestly', () => {
    const p1 = task('p1', null, { priority: 1 });
    const p2 = task('p2', null, { priority: 2 });
    const p3 = task('p3', null, { priority: 3 });
    expect(suggestedTask([p1], '2026-10-27', { backlogFallback: true })?.reason).toBe('From Backlog · Top priority');
    expect(suggestedTask([p2], '2026-10-27', { backlogFallback: true })?.reason).toBe('From Backlog · Medium priority');
    expect(suggestedTask([p3], '2026-10-27', { backlogFallback: true })?.reason).toBe('From Backlog');
  });

  it('sorts backlog tasks by priority, then recency', () => {
    const olderP1 = task('older-p1', null, { priority: 1, updatedAt: 1000 });
    const newerP1 = task('newer-p1', null, { priority: 1, updatedAt: 2000 });
    const lowPriority = task('low', null, { priority: 3, updatedAt: 3000 });

    expect(suggestedTask([olderP1, newerP1, lowPriority], '2026-10-27', { backlogFallback: true })?.task.id).toBe('newer-p1');
    expect(suggestedTask([olderP1, lowPriority], '2026-10-27', { backlogFallback: true })?.task.id).toBe('older-p1');
  });

  it('excludes blocked backlog tasks and subtasks', () => {
    const blocker = task('blocker', '2026-11-01'); // scheduled in future, so not in backlog
    const blocked = task('blocked', null, { blockedBy: ['blocker'] });
    const child = task('child', null, { parentId: 'blocker' });
    expect(suggestedTask([blocker, blocked, child], '2026-10-27', { backlogFallback: true })).toBeNull();
  });

  it('without the opt-in, backlog stays invisible (baseline pinned)', () => {
    const backlog = task('b1', null);
    expect(suggestedTask([backlog], '2026-10-27')).toBeNull();
  });

  it('falls back to tomorrow if backlog is empty and tomorrowFallback is also enabled', () => {
    const tmr = task('tmr', '2026-10-28');
    expect(suggestedTask([tmr], '2026-10-27', { backlogFallback: true, tomorrowFallback: true })?.task.id).toBe('tmr');
  });
});
