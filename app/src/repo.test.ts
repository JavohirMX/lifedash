import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from './types';

// In-memory stand-in for the Dexie db: addTask only uses
// db.tasks.add() and db.tasks.where('projectId').equals(...).toArray().
const { rows } = vi.hoisted(() => ({ rows: { items: [] as Task[] } }));

vi.mock('./db', () => ({
  newId: () => 'test-id-' + rows.items.length,
  db: {
    tasks: {
      add: async (t: Task) => {
        rows.items.push(t);
        return t.id;
      },
      where: () => ({
        equals: () => ({ toArray: async () => rows.items }),
      }),
    },
  },
}));

import { addTask } from './repo';

describe('addTask', () => {
  beforeEach(() => {
    rows.items = [];
  });

  it('persists the recurrence rule from natural-language parsing', async () => {
    // Regression: addTask used to hardcode recurrence: null, silently dropping
    // "every day" style rules typed into quick-add.
    const rule = 'DTSTART:20261022T120000Z\nRRULE:FREQ=DAILY;INTERVAL=1';
    const t = await addTask({ title: 'Water plants', projectId: '', dueDate: '2026-10-22', recurrence: rule });
    expect(t.recurrence).toBe(rule);
    expect(rows.items[0].recurrence).toBe(rule);
  });

  it('defaults recurrence to null when none is given', async () => {
    const t = await addTask({ title: 'One-off', projectId: '' });
    expect(t.recurrence).toBeNull();
  });
});
