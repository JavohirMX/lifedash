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
  await writeFile(file, JSON.stringify({ version: 2, tasks: [{id:'1', title:'Public fixture', status:'active', note:'DO NOT SHARE'}] }));
  const client = new Client({ name: 'test', version: '1.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['server.mjs', '--snapshot', file], cwd: import.meta.dirname }));
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name), ['search_tasks']);
    assert.equal(tools[0].annotations.readOnlyHint, true);
    assert.equal(tools[0].inputSchema.additionalProperties, false);
    const result = await client.callTool({ name: 'search_tasks', arguments: {query:'fixture'} });
    assert.equal(result.isError, undefined);
    assert.equal(JSON.stringify(result).includes('DO NOT SHARE'), false);
    assert.equal(JSON.parse(result.content[0].text).total, 1);
    const invalid = await client.callTool({ name: 'search_tasks', arguments: {path:'/etc/passwd'} });
    assert.equal(invalid.isError, true);
    const write = await client.callTool({ name: 'delete_task', arguments: {id:'1'} });
    assert.equal(write.isError, true);
  } finally { await client.close(); await rm(dir, { recursive: true }); }
});
