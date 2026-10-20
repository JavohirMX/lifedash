import { describe, it, expect } from 'vitest';
import {
  searchNotes, searchJournal, searchGoals,
  makeRecurrence,
  nextOccurrenceDate,
  describeRecurrence,
  completeTask,
  sortTasks,
  todayTasks,
  suggestedTask,
  extractChecklistItems,
  upcomingTasks,
  backlogTasks,
  subtaskProgress,
} from '../src/logic';
import type { Task, Note, JournalEntry, Goal } from '../src/types';

function task(partial: Partial<Task>): Task {
  return {
    id: partial.id ?? 't1',
    title: 'Task',
    note: '',
    noteDoc: null,
    goalId: null,
    noteId: null,
    projectId: 'inbox',
    parentId: null,
    status: 'active',
    priority: partial.priority ?? 0,
    pinned: false,
    dueDate: null,
    dueTime: null,
    recurrence: null,
    blockedBy: [],
    tags: [],
    order: 0,
    seriesId: null,
    createdAt: 0,
    updatedAt: 0,
    completedAt: null,
    ...partial,
  };
}

describe('recurrence', () => {
  it('daily: next occurrence is the next day', () => {
    const r = makeRecurrence('daily', '2026-10-20');
    expect(nextOccurrenceDate(r, '2026-10-20', '2026-10-20')).toBe('2026-10-21');
  });

  it('daily: overdue completion skips the missed days, lands tomorrow', () => {
    const r = makeRecurrence('daily', '2026-10-10');
    expect(nextOccurrenceDate(r, '2026-10-10', '2026-10-20')).toBe('2026-10-21');
  });

  it('weekly: same weekday next week', () => {
    // 2026-10-20 is a Tuesday
    const r = makeRecurrence('weekly', '2026-10-20');
    expect(nextOccurrenceDate(r, '2026-10-20', '2026-10-20')).toBe('2026-10-27');
  });

  it('monthly: same day next month', () => {
    const r = makeRecurrence('monthly', '2026-10-20');
    expect(nextOccurrenceDate(r, '2026-10-20', '2026-10-20')).toBe('2026-11-20');
  });

  it('every N days honors the interval', () => {
    const r = makeRecurrence('ndays', '2026-10-20', 3);
    expect(nextOccurrenceDate(r, '2026-10-20', '2026-10-20')).toBe('2026-10-23');
  });

  it('every N days overdue skips ahead to a future occurrence', () => {
    const r = makeRecurrence('ndays', '2026-10-01', 7);
    const next = nextOccurrenceDate(r, '2026-10-01', '2026-10-20');
    expect(next).toBe('2026-10-22'); // occurrences: 1, 8, 15, 22
  });

  it('completed early (before due date) anchors at the due date', () => {
    const r = makeRecurrence('daily', '2026-10-25');
    expect(nextOccurrenceDate(r, '2026-10-25', '2026-10-20')).toBe('2026-10-26');
  });

  it('describes rules in plain words', () => {
    expect(describeRecurrence(makeRecurrence('daily', '2026-10-20'))).toBe('Daily');
    expect(describeRecurrence(makeRecurrence('weekly', '2026-10-20'))).toBe('Weekly');
    expect(describeRecurrence(makeRecurrence('ndays', '2026-10-20', 5))).toBe('Every 5 days');
    expect(describeRecurrence(null)).toBe('');
  });
});

describe('completeTask', () => {
  it('marks a plain task done with no spawn', () => {
    const { updates, spawned } = completeTask(task({}), '2026-10-20', 123);
    expect(updates.status).toBe('done');
    expect(updates.completedAt).toBe(123);
    expect(spawned).toBeNull();
  });

  it('spawns the next occurrence for a recurring task, linked by seriesId', () => {
    const t = task({ id: 'abc', dueDate: '2026-10-20', recurrence: makeRecurrence('daily', '2026-10-20'), pinned: true });
    const { updates, spawned } = completeTask(t, '2026-10-20', 123);
    expect(updates.status).toBe('done');
    expect(spawned).not.toBeNull();
    expect(spawned!.dueDate).toBe('2026-10-21');
    expect(spawned!.seriesId).toBe('abc');
    expect(spawned!.status).toBe('active');
    expect(spawned!.pinned).toBe(true);
    expect(spawned!.recurrence).toBe(t.recurrence);
    expect(spawned!.completedAt).toBeNull();
  });

  it('keeps the series id stable across generations', () => {
    const t = task({ id: 'gen2', seriesId: 'root', dueDate: '2026-10-20', recurrence: makeRecurrence('daily', '2026-10-20') });
    const { spawned } = completeTask(t, '2026-10-20', 1);
    expect(spawned!.seriesId).toBe('root');
  });
});

describe('sorting and views', () => {
  const a = task({ id: 'a', order: 2, createdAt: 2 });
  const b = task({ id: 'b', order: 1, createdAt: 3 });
  const c = task({ id: 'c', order: 9, pinned: true, createdAt: 1 });

  it('pinned first, then manual order', () => {
    expect(sortTasks([a, b, c]).map((t) => t.id)).toEqual(['c', 'b', 'a']);
  });

  it('today includes overdue and due-today, excludes future and done', () => {
    const list = todayTasks(
      [
        task({ id: 'overdue', dueDate: '2026-10-19' }),
        task({ id: 'today', dueDate: '2026-10-20' }),
        task({ id: 'future', dueDate: '2026-10-21' }),
        task({ id: 'done', dueDate: '2026-10-20', status: 'done' }),
        task({ id: 'nodate' }),
      ],
      '2026-10-20',
    );
    expect(list.map((t) => t.id).sort()).toEqual(['overdue', 'today']);
  });

  it('subtasks do not appear as top-level view rows', () => {
    const list = todayTasks(
      [task({ id: 'parent', dueDate: '2026-10-20' }), task({ id: 'sub', parentId: 'parent', dueDate: '2026-10-20' })],
      '2026-10-20',
    );
    expect(list.map((t) => t.id)).toEqual(['parent']);
  });

  it('backlog is active no-date tasks only', () => {
    const list = backlogTasks([task({ id: 'x' }), task({ id: 'y', dueDate: '2026-10-20' }), task({ id: 'z', status: 'done' })]);
    expect(list.map((t) => t.id)).toEqual(['x']);
  });

  it('upcoming groups by date within the window', () => {
    const groups = upcomingTasks(
      [
        task({ id: 'soon', dueDate: '2026-10-22' }),
        task({ id: 'far', dueDate: '2026-12-31' }),
        task({ id: 'today', dueDate: '2026-10-20' }),
      ],
      '2026-10-20',
    );
    expect([...groups.keys()]).toEqual(['2026-10-22']);
    expect(groups.get('2026-10-22')!.map((t) => t.id)).toEqual(['soon']);
  });

  it('subtask progress counts done vs total, ignoring archived', () => {
    const all = [
      task({ id: 'p' }),
      task({ id: 's1', parentId: 'p', status: 'done' }),
      task({ id: 's2', parentId: 'p' }),
      task({ id: 's3', parentId: 'p', status: 'archived' }),
    ];
    expect(subtaskProgress(all, 'p')).toEqual({ done: 1, total: 2 });
  });
});

describe('dependencies', () => {
  const mk = (id: string, blockedBy: string[] = []) =>
    task({ id, blockedBy });

  it('detects direct and transitive cycles, and self-block', async () => {
    const { wouldCreateCycle } = await import('../src/logic');
    // A blocked by B, B blocked by C
    const all = [mk('A', ['B']), mk('B', ['C']), mk('C')];
    expect(wouldCreateCycle(all, 'C', 'A')).toBe(true);  // C <- A would loop A->B->C->A
    expect(wouldCreateCycle(all, 'B', 'A')).toBe(true);  // B <- A loops A->B->A
    expect(wouldCreateCycle(all, 'A', 'A')).toBe(true);  // self
    expect(wouldCreateCycle(all, 'C', 'B')).toBe(true);  // C <- B loops B->C->B
    expect(wouldCreateCycle(all, 'A', 'C')).toBe(false);      // A <- C is fine (A already blocked by B)
    expect(wouldCreateCycle(all, 'D', 'A')).toBe(false); // new task blocked by A is fine
  });

  it('isBlocked only counts active blockers', async () => {
    const { isBlocked, activeBlockers } = await import('../src/logic');
    const blocker = task({ id: 'B' });
    const t = task({ id: 'A', blockedBy: ['B'] });
    expect(isBlocked([t, blocker], t)).toBe(true);
    expect(activeBlockers([t, blocker], t).map((x) => x.id)).toEqual(['B']);
    const doneBlocker = task({ id: 'B', status: 'done' });
    expect(isBlocked([t, doneBlocker], t)).toBe(false);
    // done tasks are never "blocked"
    expect(isBlocked([task({ id: 'A', blockedBy: ['B'], status: 'done' }), blocker], task({ id: 'A', blockedBy: ['B'], status: 'done' }))).toBe(false);
  });
});

describe('tags and search', () => {
  it('normalizes tags', async () => {
    const { normalizeTag } = await import('../src/logic');
    expect(normalizeTag('#Work Stuff')).toBe('work-stuff');
    expect(normalizeTag('  Urgent ')).toBe('urgent');
  });

  it('searches text tokens across title and note, AND semantics', async () => {
    const { searchTasks } = await import('../src/logic');
    const all = [
      task({ id: 'a', title: 'Buy milk', note: 'from the corner shop' }),
      task({ id: 'b', title: 'Buy eggs', note: '' }),
      task({ id: 'c', title: 'Fix bike', note: 'buy chain lube' }),
    ];
    expect(searchTasks(all, 'buy').map((t) => t.id).sort()).toEqual(['a', 'b', 'c']);
    expect(searchTasks(all, 'buy shop').map((t) => t.id)).toEqual(['a']);
    expect(searchTasks(all, 'nothing-matches')).toEqual([]);
  });

  it('filters by #tag and combines with text', async () => {
    const { searchTasks } = await import('../src/logic');
    const all = [
      task({ id: 'a', title: 'Buy milk', tags: ['shopping'] }),
      task({ id: 'b', title: 'Buy tools', tags: ['shopping', 'home'] }),
      task({ id: 'c', title: 'Buy book', tags: [] }),
    ];
    expect(searchTasks(all, '#shopping').map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(searchTasks(all, 'buy #home').map((t) => t.id)).toEqual(['b']);
  });

  it('archived tasks never match', async () => {
    const { searchTasks } = await import('../src/logic');
    expect(searchTasks([task({ id: 'a', title: 'ghost', status: 'archived' })], 'ghost')).toEqual([]);
  });
});

describe('ordering', () => {
  it('orderBetween handles empty, head, tail and middle', async () => {
    const { orderBetween } = await import('../src/logic');
    expect(orderBetween(undefined, undefined)).toBe(1);
    expect(orderBetween(undefined, 5)).toBe(4);
    expect(orderBetween(5, undefined)).toBe(6);
    expect(orderBetween(2, 4)).toBe(3);
  });

  it('reorderedPosition drops before/after target, ignoring the dragged row', async () => {
    const { reorderedPosition } = await import('../src/logic');
    const list = [task({ id: 'a', order: 1 }), task({ id: 'b', order: 2 }), task({ id: 'c', order: 3 })];
    // move c before a -> before order 1
    expect(reorderedPosition(list, 'c', 'a', false)).toBe(0);
    // move a after c -> tail
    expect(reorderedPosition(list, 'a', 'c', true)).toBe(4);
    // move a after b -> between 2 and 3
    expect(reorderedPosition(list, 'a', 'b', true)).toBe(2.5);
    // drop on itself is a no-op
    expect(reorderedPosition(list, 'a', 'a', true)).toBeNull();
    // target not in list
    expect(reorderedPosition(list, 'a', 'zzz', true)).toBeNull();
  });
});

describe('global search helpers', () => {
  const mkNote = (id: string, title: string, note: string, updatedAt = 1): Note => ({
    id, title, note, noteDoc: null, pinned: false, createdAt: 0, updatedAt,
  });
  const mkEntry = (date: string, note: string): JournalEntry => ({
    id: date, date, note, noteDoc: null, mood: null, createdAt: 0, updatedAt: 0,
  });
  const mkGoal = (id: string, title: string, status: Goal['status'] = 'active'): Goal => ({
    id, title, note: '', targetDate: null, status, order: 0, createdAt: 0, updatedAt: 0,
  });

  it('searchNotes matches title and body, newest first', () => {
    const notes = [mkNote('a', 'Trip ideas', 'Lisbon in spring', 1), mkNote('b', 'Other', 'nothing', 3), mkNote('c', 'Spring cleaning', 'garage', 2)];
    const r = searchNotes(notes, 'spring');
    expect(r.map((n) => n.id)).toEqual(['c', 'a']);
  });

  it('searchNotes requires every token', () => {
    const notes = [mkNote('a', 'Trip ideas', 'Lisbon in spring')];
    expect(searchNotes(notes, 'lisbon spring')).toHaveLength(1);
    expect(searchNotes(notes, 'lisbon winter')).toHaveLength(0);
  });

  it('searchJournal matches body, latest date first', () => {
    const entries = [mkEntry('2026-10-18', 'focused day'), mkEntry('2026-10-20', 'focused again'), mkEntry('2026-10-19', 'rest')];
    expect(searchJournal(entries, 'focused').map((e) => e.date)).toEqual(['2026-10-20', '2026-10-18']);
  });

  it('searchGoals skips archived', () => {
    const goals = [mkGoal('a', 'Run a 10k'), mkGoal('b', 'Run a marathon', 'archived')];
    expect(searchGoals(goals, 'run').map((g) => g.id)).toEqual(['a']);
  });
});

describe('priority sorting', () => {
  it('higher priority sorts first, pinned still wins', () => {
    const a = task({ id: 'a', priority: 3, order: 1 });
    const b = task({ id: 'b', priority: 1, order: 2 });
    const c = task({ id: 'c', priority: 0, order: 0 });
    const d = task({ id: 'd', pinned: true, priority: 3, order: 9 });
    expect(sortTasks([a, b, c, d]).map((t) => t.id)).toEqual(['d', 'b', 'a', 'c']);
  });
});

describe('suggestedTask', () => {
  it('overdue beats due-today regardless of priority', () => {
    const a = task({ id: 'a', dueDate: '2026-10-20', priority: 1 });
    const b = task({ id: 'b', dueDate: '2026-10-19', priority: 3 });
    expect(suggestedTask([a, b], '2026-10-20')?.task.id).toBe('b');
    expect(suggestedTask([a, b], '2026-10-20')?.reason).toBe('Overdue');
  });
  it('priority breaks ties within the same day', () => {
    const a = task({ id: 'a', dueDate: '2026-10-20', priority: 0 });
    const b = task({ id: 'b', dueDate: '2026-10-20', priority: 1 });
    expect(suggestedTask([a, b], '2026-10-20')?.task.id).toBe('b');
  });
  it('earlier due time wins among equal priority', () => {
    const a = task({ id: 'a', dueDate: '2026-10-20', dueTime: '17:00' });
    const b = task({ id: 'b', dueDate: '2026-10-20', dueTime: '09:00' });
    expect(suggestedTask([a, b], '2026-10-20')?.task.id).toBe('b');
  });
  it('skips blocked tasks and subtasks; null when nothing is due', () => {
    const blocker = task({ id: 'x', title: 'Blocker', dueDate: '2026-10-20' });
    const blocked = task({ id: 'y', dueDate: '2026-10-20', blockedBy: ['x'] });
    const sub = task({ id: 'z', dueDate: '2026-10-20', parentId: 'x' });
    expect(suggestedTask([blocker, blocked, sub], '2026-10-20')?.task.id).toBe('x');
    expect(suggestedTask([task({ id: 'f', dueDate: '2026-10-21' })], '2026-10-20')).toBeNull();
  });
});

describe('extractChecklistItems', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'intro' }] },
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Buy milk' }] }] },
          { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Done one' }] }] },
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Call bank' }] }] },
        ],
      },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'not a task' }] }] }] },
    ],
  };
  it('pulls unchecked task items only', () => {
    expect(extractChecklistItems(doc)).toEqual(['Buy milk', 'Call bank']);
  });
  it('empty doc and null are safe', () => {
    expect(extractChecklistItems(null)).toEqual([]);
    expect(extractChecklistItems({ type: 'doc' })).toEqual([]);
  });
});
