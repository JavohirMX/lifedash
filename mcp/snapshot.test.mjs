import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSnapshot, queryTasks } from './snapshot.mjs';
const fixture = { version: 2, exportedAt: '2026-10-20', tasks: [{ id: '1', title: 'Plan test', status: 'active', dueDate: '2026-10-21', priority: 1, note: 'SECRET', noteDoc: 'SECRET', tags: ['SECRET'] }], journal: ['SECRET'], sync: { token: 'SECRET' } };
test('projects only safe fields and holds an immutable snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lifedash-mcp-'));
  try {
    const file = join(dir, 'backup.json'); await writeFile(file, JSON.stringify(fixture));
    const snapshot = await loadSnapshot(file);
    assert.equal(JSON.stringify(snapshot).includes('SECRET'), false);
    assert.equal(queryTasks(snapshot, { query: 'PLAN' }).total, 1);
    assert.equal(queryTasks(snapshot, { status: 'done' }).total, 0);
    assert.throws(() => snapshot.tasks.push({}));
    await writeFile(file, '{}'); assert.equal(snapshot.tasks.length, 1);
    await assert.rejects(loadSnapshot(file));
  } finally { await rm(dir, { recursive: true }); }
});
test('bounds search arguments', () => {
  for (const args of [{limit: 51}, {limit: -1}, {query: 'x'.repeat(201)}, {status: 'unknown'}]) assert.throws(() => queryTasks({ tasks: [] }, args));
});
