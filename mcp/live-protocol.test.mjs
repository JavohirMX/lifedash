// Fail-first live coverage for agent-server.mjs: boots the real FastAPI sync
// server and exercises every MCP tool over stdio. The earlier drift (reads
// hitting nonexistent /api/agent/tasks|projects|... routes, update_task
// sending status values the server PATCH rejects) 404s/422s this suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = join(import.meta.dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

test('live agent server: every tool works against a real sync server', { timeout: 120000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lifedash-live-mcp-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const serverProc = spawn(
    'uv',
    ['run', '--directory', join(repoRoot, 'server'), 'python', '-m', 'uvicorn',
     'app.main:app', '--host', '127.0.0.1', '--port', String(port), '--no-proxy-headers'],
    { env: { ...process.env, SYNC_DB: join(dir, 'sync.db') }, stdio: 'ignore' },
  );
  const client = new Client({ name: 'live-protocol-test', version: '1.0' });
  try {
    // Wait for the server to become healthy.
    const deadline = Date.now() + 60000;
    for (;;) {
      if (serverProc.exitCode !== null) throw new Error('uvicorn exited before becoming healthy');
      try {
        const r = await fetch(`${base}/api/health`);
        if (r.status === 200) break;
      } catch { /* not up yet */ }
      if (Date.now() >= deadline) throw new Error('uvicorn did not become healthy in 60s');
      await new Promise((r) => setTimeout(r, 200));
    }

    const http = async (method, path, body, bearer) => {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, json: res.status === 204 ? null : await res.json() };
    };

    // Register a user and mint a read-write agent token.
    const reg = await http('POST', '/api/register', { username: `mcp-${Date.now()}`, password: 'correct horse battery staple' });
    assert.equal(reg.status, 200, JSON.stringify(reg.json));
    const session = reg.json.token;
    const keyRes = await http('POST', '/api/agent-tokens', { name: 'live-test', scope: 'read-write' }, session);
    assert.equal(keyRes.status, 201, JSON.stringify(keyRes.json));
    const agentToken = keyRes.json.token;

    // Seed a project, habit, goal and note through the sync push endpoint.
    const seed = (collection, id, data) =>
      http('POST', '/api/changes', { changes: [{ collection, id, base_rev: 0, deleted: false, data }] }, session);
    assert.equal((await seed('projects', 'proj-1', { id: 'proj-1', name: 'Work', color: '#0f766e', order: 0, archived: false })).status, 200);
    assert.equal((await seed('habits', 'habit-1', { id: 'habit-1', name: 'Meditate', frequency: 'daily' })).status, 200);
    assert.equal((await seed('goals', 'goal-1', { id: 'goal-1', title: 'Launch product' })).status, 200);
    assert.equal((await seed('notes', 'note-1', { id: 'note-1', title: 'Roadmap', text: 'Q4 milestones' })).status, 200);

    // Connect the MCP client to the live agent server over stdio.
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: ['agent-server.mjs'],
      cwd: import.meta.dirname,
      env: { ...process.env, LIFEDASH_SERVER_URL: base, LIFEDASH_AGENT_TOKEN: agentToken },
    }));

    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ['create_task', 'list_goals', 'list_habits', 'list_projects', 'search_notes', 'search_tasks', 'update_task'].sort(),
    );

    const call = async (name, args) => client.callTool({ name, arguments: args });
    const payload = (res) => JSON.parse(res.content[0].text);

    // Reads against the live entities surface.
    const projRes = await call('list_projects', {});
    assert.equal(projRes.isError, undefined, JSON.stringify(projRes));
    assert.equal(payload(projRes).projects.some((p) => p.name === 'Work'), true);

    const habitRes = await call('list_habits', {});
    assert.equal(habitRes.isError, undefined, JSON.stringify(habitRes));
    assert.equal(payload(habitRes).habits.some((h) => h.name === 'Meditate'), true);

    const goalRes = await call('list_goals', {});
    assert.equal(goalRes.isError, undefined, JSON.stringify(goalRes));
    assert.equal(payload(goalRes).goals.some((g) => g.title === 'Launch product'), true);

    const noteRes = await call('search_notes', { query: 'roadmap' });
    assert.equal(noteRes.isError, undefined, JSON.stringify(noteRes));
    assert.equal(payload(noteRes).notes.length, 1);

    // Create a task through the MCP write tool.
    const createRes = await call('create_task', { title: 'Live fixture', dueDate: '2026-11-06' });
    assert.equal(createRes.isError, undefined, JSON.stringify(createRes));
    const taskId = payload(createRes).id;
    assert.ok(taskId);

    // Search: default (active) finds it; done does not.
    const activeRes = await call('search_tasks', { query: 'fixture' });
    assert.equal(activeRes.isError, undefined, JSON.stringify(activeRes));
    assert.equal(payload(activeRes).tasks.length, 1);
    assert.equal(payload(await call('search_tasks', { query: 'fixture', status: 'done' })).tasks.length, 0);

    // status: done must go through /complete (server PATCH rejects 'done').
    const doneRes = await call('update_task', { id: taskId, status: 'done' });
    assert.equal(doneRes.isError, undefined, JSON.stringify(doneRes));
    assert.equal(payload(doneRes).changed, true);
    assert.equal(payload(await call('search_tasks', { query: 'fixture', status: 'done' })).tasks.length, 1);
    assert.equal(payload(await call('search_tasks', { query: 'fixture' })).tasks.length, 0);

    // status: active on a done task must go through /uncomplete.
    const activeAgain = await call('update_task', { id: taskId, status: 'active' });
    assert.equal(activeAgain.isError, undefined, JSON.stringify(activeAgain));
    assert.equal(payload(activeAgain).changed, true);
    assert.equal(payload(await call('search_tasks', { query: 'fixture' })).tasks.length, 1);

    // Field edit plus archive through PATCH.
    const editRes = await call('update_task', { id: taskId, title: 'Live fixture v2', priority: 2 });
    assert.equal(editRes.isError, undefined, JSON.stringify(editRes));
    const archRes = await call('update_task', { id: taskId, status: 'archived' });
    assert.equal(archRes.isError, undefined, JSON.stringify(archRes));
    const archived = payload(await call('search_tasks', { query: 'fixture', status: 'archived' })).tasks;
    assert.equal(archived.length, 1);
    assert.equal(archived[0].title, 'Live fixture v2');
    assert.equal(archived[0].priority, 2);

    // Unarchive back to active through PATCH.
    const unarchRes = await call('update_task', { id: taskId, status: 'active' });
    assert.equal(unarchRes.isError, undefined, JSON.stringify(unarchRes));
    assert.equal(payload(await call('search_tasks', { query: 'fixture' })).tasks.length, 1);

    // Strict schema: unknown parameters rejected.
    const invalid = await call('search_tasks', { path: '/etc/passwd' });
    assert.equal(invalid.isError, true);
    // Unknown tool rejected.
    const write = await call('delete_task', { id: taskId });
    assert.equal(write.isError, true);
  } finally {
    await client.close().catch(() => {});
    serverProc.kill('SIGTERM');
    await rm(dir, { recursive: true, force: true });
  }
});
