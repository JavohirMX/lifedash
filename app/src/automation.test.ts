import { describe, expect, it } from 'vitest';
import { rolloverTargets, shouldCompleteParent } from './automation';
import type { Task } from './types';

const base: Task = {
  id: 'a', title: 'A', note: '', noteDoc: null, status: 'active', pinned: false,
  projectId: 'inbox', dueDate: null, dueTime: null, recurrence: null,
  parentId: null, goalId: null, seriesId: null, order: 0, blockedBy: [], tags: [],
  createdAt: 0, updatedAt: 0, completedAt: null,
};
const t = (patch: Partial<Task>): Task => ({ ...base, ...patch });

describe('rolloverTargets', () => {
  it('picks only active tasks due before today', () => {
    const tasks = [
      t({ id: 'overdue', dueDate: '2026-10-19' }),
      t({ id: 'today', dueDate: '2026-10-20' }),
      t({ id: 'future', dueDate: '2026-10-21' }),
      t({ id: 'noDate' }),
      t({ id: 'doneOverdue', dueDate: '2026-10-19', status: 'done' }),
    ];
    expect(rolloverTargets(tasks, '2026-10-20')).toEqual(['overdue']);
  });
});

describe('shouldCompleteParent', () => {
  const parent = t({ id: 'p' });
  it('is true when all subtasks are done', () => {
    const tasks = [parent, t({ id: 'c1', parentId: 'p', status: 'done' }), t({ id: 'c2', parentId: 'p', status: 'done' })];
    expect(shouldCompleteParent(tasks, 'p')).toBe(true);
  });
  it('is false while any subtask is open', () => {
    const tasks = [parent, t({ id: 'c1', parentId: 'p', status: 'done' }), t({ id: 'c2', parentId: 'p' })];
    expect(shouldCompleteParent(tasks, 'p')).toBe(false);
  });
  it('is false when the parent is already done or has no subtasks', () => {
    expect(shouldCompleteParent([{ ...parent, status: 'done' }, t({ id: 'c', parentId: 'p', status: 'done' })], 'p')).toBe(false);
    expect(shouldCompleteParent([parent], 'p')).toBe(false);
  });
});
