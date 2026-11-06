import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('real stdio initialize/list/call; unknown parameters and writes rejected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lifedash-protocol-'));
  const file = join(dir, 'backup.json');
  await writeFile(
    file,
    JSON.stringify({
      version: 2,
      tasks: [{ id: '1', title: 'Public fixture', status: 'active', note: 'DO NOT SHARE', dueDate: '2026-11-05' }],
      projects: [{ id: 'p1', name: 'Work', color: '#0f766e' }],
      habits: [{ id: 'h1', name: 'Meditate' }],
      goals: [{ id: 'g1', title: 'Launch product' }],
      notes: [{ id: 'n1', title: 'Roadmap', note: 'Q4 milestones' }],
    }),
  );
  const client = new Client({ name: 'test', version: '1.0' });
  try {
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: ['server.mjs', '--snapshot', file], cwd: import.meta.dirname }),
    );
    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name).sort();
    const expected = ['search_tasks', 'list_projects', 'get_habits', 'get_goals', 'search_notes', 'get_day_schedule'].sort();
    assert.deepEqual(toolNames, expected);

    for (const tool of tools) {
      assert.equal(tool.annotations.readOnlyHint, true);
      assert.equal(tool.inputSchema.additionalProperties, false);
    }

    // Call search_tasks
    const taskRes = await client.callTool({ name: 'search_tasks', arguments: { query: 'fixture' } });
    assert.equal(taskRes.isError, undefined);
    assert.equal(JSON.stringify(taskRes).includes('DO NOT SHARE'), false);
    assert.equal(JSON.parse(taskRes.content[0].text).total, 1);

    // Call list_projects
    const projRes = await client.callTool({ name: 'list_projects', arguments: {} });
    assert.equal(projRes.isError, undefined);
    assert.equal(JSON.parse(projRes.content[0].text).total, 1);

    // Call get_day_schedule
    const schedRes = await client.callTool({ name: 'get_day_schedule', arguments: { date: '2026-11-05' } });
    assert.equal(schedRes.isError, undefined);
    assert.equal(JSON.parse(schedRes.content[0].text).total, 1);

    // Strict schema: unknown parameters rejected
    const invalid = await client.callTool({ name: 'search_tasks', arguments: { path: '/etc/passwd' } });
    assert.equal(invalid.isError, true);

    // Nonexistent write tool rejected
    const write = await client.callTool({ name: 'delete_task', arguments: { id: '1' } });
    assert.equal(write.isError, true);
  } finally {
    await client.close();
    await rm(dir, { recursive: true });
  }
});
