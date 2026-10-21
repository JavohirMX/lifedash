import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from './types';

// In-memory stand-in for the Dexie db covering the small query surface
// repo.ts uses in these tests.
const { rows } = vi.hoisted(() => ({ rows: { tasks: [] as Task[], notes: [] as { id: string }[] } }));

function fakeTable<T extends { id: string }>(items: T[]) {
  const matching = (field: string, value: unknown) => items.filter((t) => (t as Record<string, unknown>)[field] === value);
  return {
    add: async (t: T) => {
      items.push(t);
      return t.id;
    },
    delete: async (id: string) => {
      const i = items.findIndex((t) => t.id === id);
      if (i >= 0) items.splice(i, 1);
    },
    where: (field: string) => ({
      equals: (value: unknown) => ({
        toArray: async () => matching(field, value),
        primaryKeys: async () => matching(field, value).map((t) => t.id),
        delete: async () => {
          for (const t of matching(field, value)) items.splice(items.indexOf(t), 1);
        },
        modify: (patchOrFn: Partial<T> | ((t: T) => void)) => {
          for (const t of matching(field, value)) {
            if (typeof patchOrFn === 'function') patchOrFn(t);
            else Object.assign(t, patchOrFn);
          }
          return Promise.resolve(0);
        },
      }),
      anyOf: () => ({ delete: async () => 0 }),
    }),
    filter: (fn: (t: T) => boolean) => ({
      modify: async (fn2: (t: T) => void) => {
        items.filter(fn).forEach(fn2);
        return 0;
      },
    }),
  };
}

vi.mock('./db', () => ({
  newId: () => 'test-id-' + rows.tasks.length,
  db: {
    tasks: fakeTable(rows.tasks),
    notes: fakeTable(rows.notes),
    attachments: fakeTable([]),
    transaction: async (...args: unknown[]) => {
      const fn = args[args.length - 1] as () => Promise<void>;
      return fn();
    },
  },
}));

import { addTask, deleteNote, deleteTask } from './repo';

describe('addTask', () => {
  beforeEach(() => {
    rows.tasks.length = 0;
    rows.notes.length = 0;
  });

  it('persists the recurrence rule from natural-language parsing', async () => {
    // Regression: addTask used to hardcode recurrence: null, silently dropping
    // "every day" style rules typed into quick-add.
    const rule = 'DTSTART:20261022T120000Z\nRRULE:FREQ=DAILY;INTERVAL=1';
    const t = await addTask({ title: 'Water plants', projectId: '', dueDate: '2026-10-22', recurrence: rule });
    expect(t.recurrence).toBe(rule);
    expect(rows.tasks[0].recurrence).toBe(rule);
  });

  it('defaults recurrence to null when none is given', async () => {
    const t = await addTask({ title: 'One-off', projectId: '' });
    expect(t.recurrence).toBeNull();
  });
});

describe('deleteTask', () => {
  beforeEach(() => {
    rows.tasks.length = 0;
  });
  const mk = (id: string, extra: Partial<Task> = {}): Task => ({
    id, title: id, note: '', noteDoc: null, projectId: '', parentId: null, goalId: null,
    noteId: null, status: 'active', pinned: false, priority: 0, dueDate: null, dueTime: null,
    recurrence: null, blockedBy: [], tags: [], order: 1, seriesId: null,
    createdAt: 1, updatedAt: 1, completedAt: null, ...extra,
  });

  it('strips the deleted id from other tasks blockedBy lists', async () => {
    const blocker = mk('a');
    const blocked = mk('b', { blockedBy: ['a', 'keep'] });
    rows.tasks.push(blocker, blocked);
    await deleteTask(blocker);
    expect(rows.tasks.map((t) => t.id)).toEqual(['b']);
    expect(rows.tasks[0].blockedBy).toEqual(['keep']);
  });

  it('cascades subtasks and strips their ids from blockedBy too', async () => {
    const parent = mk('p');
    const child = mk('c', { parentId: 'p' });
    const other = mk('d', { blockedBy: ['c'] });
    rows.tasks.push(parent, child, other);
    await deleteTask(parent);
    expect(rows.tasks.map((t) => t.id)).toEqual(['d']);
    expect(rows.tasks[0].blockedBy).toEqual([]);
  });
});

describe('deleteNote', () => {
  beforeEach(() => {
    rows.tasks.length = 0;
    rows.notes.length = 0;
  });
  it('clears noteId on tasks created from the note', async () => {
    rows.notes.push({ id: 'n1' });
    const linked = await addTask({ title: 'from note', projectId: '', noteId: 'n1' });
    expect(linked.noteId).toBe('n1');
    await deleteNote('n1');
    expect(rows.notes).toEqual([]);
    expect(rows.tasks.find((t) => t.id === linked.id)?.noteId).toBeNull();
  });
});
