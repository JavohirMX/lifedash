import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const serverUrl = (process.env.LIFEDASH_SERVER_URL || 'http://localhost:8787').replace(/\/+$/, '');
const token = process.env.LIFEDASH_AGENT_TOKEN;

if (!token) {
  console.error('Error: LIFEDASH_AGENT_TOKEN environment variable is required.');
  console.error('Create a token in Lifedash Settings -> Agent API Keys, then launch with:');
  console.error('  LIFEDASH_AGENT_TOKEN="your_key" node agent-server.mjs');
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch(`${serverUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Lifedash Agent API error (${res.status}): ${errorText}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

try {
  const server = new McpServer({ name: 'lifedash-live-agent', version: '0.2.0' });

  // search_tasks
  server.registerTool(
    'search_tasks',
    {
      description: 'Search tasks live from the Lifedash sync server.',
      inputSchema: z
        .object({
          query: z.string().default(''),
          status: z.enum(['active', 'done', 'archived', 'all']).default('active'),
          limit: z.number().int().min(1).max(50).default(20),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const q = new URLSearchParams();
      if (args.query) q.set('q', args.query);
      if (args.status !== 'all') q.set('status', args.status);
      q.set('limit', String(args.limit));
      const data = await api('GET', `/api/agent/tasks?${q.toString()}`);
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    },
  );

  // create_task
  server.registerTool(
    'create_task',
    {
      description: 'Create a new task in Lifedash. Requires read-write scope.',
      inputSchema: z
        .object({
          title: z.string().min(1).max(500),
          dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
          priority: z.number().int().min(0).max(3).default(0),
          projectId: z.string().optional(),
          parentId: z.string().optional(),
          tags: z.array(z.string()).optional(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const data = await api('POST', '/api/agent/tasks', args);
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    },
  );

  // update_task
  server.registerTool(
    'update_task',
    {
      description: 'Update an existing task in Lifedash. Requires read-write scope.',
      inputSchema: z
        .object({
          id: z.string(),
          title: z.string().min(1).max(500).optional(),
          status: z.enum(['active', 'done', 'archived']).optional(),
          dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
          dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
          priority: z.number().int().min(0).max(3).optional(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ id, ...patch }) => {
      const data = await api('PATCH', `/api/agent/tasks/${encodeURIComponent(id)}`, patch);
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    },
  );

  // list_projects
  server.registerTool(
    'list_projects',
    {
      description: 'List all projects from Lifedash.',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const data = await api('GET', '/api/agent/projects');
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    },
  );

  // list_habits
  server.registerTool(
    'list_habits',
    {
      description: 'List habits and recent progress from Lifedash.',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const data = await api('GET', '/api/agent/habits');
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    },
  );

  // list_goals
  server.registerTool(
    'list_goals',
    {
      description: 'List goals and active statuses from Lifedash.',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const data = await api('GET', '/api/agent/goals');
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    },
  );

  // search_notes
  server.registerTool(
    'search_notes',
    {
      description: 'Search notes and excerpts from Lifedash.',
      inputSchema: z
        .object({
          query: z.string().default(''),
          limit: z.number().int().min(1).max(50).default(20),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const q = new URLSearchParams();
      if (args.query) q.set('q', args.query);
      q.set('limit', String(args.limit));
      const data = await api('GET', `/api/agent/notes?${q.toString()}`);
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    },
  );

  await server.connect(new StdioServerTransport());
} catch (err) {
  console.error('Could not start Lifedash Live Agent MCP:', err);
  process.exit(1);
}
