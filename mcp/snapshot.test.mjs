import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadSnapshot,
  queryTasks,
  queryProjects,
  queryHabits,
  queryGoals,
  queryNotes,
  queryDaySchedule,
} from './snapshot.mjs';

const fixture = {
  version: 2,
  exportedAt: '2026-10-20',
  tasks: [
    { id: '1', title: 'Plan test', status: 'active', dueDate: '2026-10-21', dueTime: '10:00', priority: 1, projectId: 'p1', note: 'SECRET', noteDoc: 'SECRET', tags: ['SECRET'] },
    { id: '2', title: 'Done task', status: 'done', dueDate: '2026-10-20', priority: 0, projectId: 'p1' },
  ],
  projects: [
    { id: 'p1', name: 'Work Project', color: '#0f766e', archived: false },
    { id: 'p2', name: 'Archived Project', color: '#64748b', archived: true },
  ],
  habits: [
    { id: 'h1', name: 'Exercise', weekdays: [1, 2, 3, 4, 5], archived: false },
  ],
  habitLogs: [
    { habitId: 'h1', date: '2026-10-19' },
    { habitId: 'h1', date: '2026-10-20' },
  ],
  goals: [
    { id: 'g1', title: 'Ship v1.0', targetDate: '2026-12-31', status: 'active' },
  ],
  notes: [
    { id: 'n1', title: 'Architecture decisions', note: 'Decided on local-first SQLite/IndexedDB', pinned: true },
  ],
  journal: ['SECRET'],
  sync: { token: 'SECRET' },
};

test('projects only safe fields and holds an immutable snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lifedash-mcp-'));
  try {
    const file = join(dir, 'backup.json');
    await writeFile(file, JSON.stringify(fixture));
    const snapshot = await loadSnapshot(file);

    assert.equal(JSON.stringify(snapshot).includes('SECRET'), false);
    assert.equal(queryTasks(snapshot, { query: 'PLAN' }).total, 1);
    assert.equal(queryTasks(snapshot, { status: 'done' }).total, 1);
    assert.throws(() => snapshot.tasks.push({}));

    // Projects query
    const activeProjects = queryProjects(snapshot, { includeArchived: false });
    assert.equal(activeProjects.total, 1);
    assert.equal(activeProjects.projects[0].activeTasks, 1);
    assert.equal(activeProjects.projects[0].doneTasks, 1);
    assert.equal(queryProjects(snapshot, { includeArchived: true }).total, 2);

    // Habits query
    const habitsRes = queryHabits(snapshot);
    assert.equal(habitsRes.total, 1);
    assert.equal(habitsRes.habits[0].totalCompletions, 2);

    // Goals query
    assert.equal(queryGoals(snapshot, { status: 'active' }).total, 1);
    assert.equal(queryGoals(snapshot, { status: 'done' }).total, 0);

    // Notes query
    assert.equal(queryNotes(snapshot, { query: 'Architecture' }).total, 1);
    assert.equal(queryNotes(snapshot, { query: 'IndexedDB' }).total, 1);

    // Day schedule query
    const sched = queryDaySchedule(snapshot, { date: '2026-10-21' });
    assert.equal(sched.total, 1);
    assert.equal(sched.tasks[0].id, '1');

    await writeFile(file, '{}');
    assert.equal(snapshot.tasks.length, 2);
    await assert.rejects(loadSnapshot(file));
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('bounds search arguments', () => {
  for (const args of [{ limit: 51 }, { limit: -1 }, { query: 'x'.repeat(201) }, { status: 'unknown' }]) {
    assert.throws(() => queryTasks({ tasks: [] }, args));
  }
  assert.throws(() => queryGoals({ goals: [] }, { status: 'invalid' }));
  assert.throws(() => queryDaySchedule({ tasks: [] }, { date: 'invalid-date' }));
  assert.throws(() => queryNotes({ notes: [] }, { limit: 100 }));
});
