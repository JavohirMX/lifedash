import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  loadSnapshot,
  queryTasks,
  queryProjects,
  queryHabits,
  queryGoals,
  queryNotes,
  queryDaySchedule,
} from './snapshot.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--snapshot') {
  console.error('Usage: node server.mjs --snapshot /absolute/path/to/explicitly-chosen-export.json');
  process.exit(1);
}

try {
  const snapshot = await loadSnapshot(args[1]);
  const server = new McpServer({ name: 'lifedash-readonly-snapshot', version: '0.2.0' });

  // Tool 1: search_tasks
  server.registerTool(
    'search_tasks',
    {
      description: 'Search task titles in an explicitly selected, static LifeDash backup. Returns titles, status, due dates and priority only.',
      inputSchema: z
        .object({
          query: z.string().max(200).default(''),
          status: z.enum(['active', 'done', 'archived', 'all']).default('active'),
          limit: z.number().int().min(1).max(50).default(20),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => ({ content: [{ type: 'text', text: JSON.stringify(queryTasks(snapshot, args)) }] }),
  );

  // Tool 2: list_projects
  server.registerTool(
    'list_projects',
    {
      description: 'List projects from the LifeDash backup, including task counts and hierarchy.',
      inputSchema: z
        .object({
          includeArchived: z.boolean().default(false),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => ({ content: [{ type: 'text', text: JSON.stringify(queryProjects(snapshot, args)) }] }),
  );

  // Tool 3: get_habits
  server.registerTool(
    'get_habits',
    {
      description: 'Retrieve habits and recent completion logs from the LifeDash backup.',
      inputSchema: z
        .object({
          includeArchived: z.boolean().default(false),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => ({ content: [{ type: 'text', text: JSON.stringify(queryHabits(snapshot, args)) }] }),
  );

  // Tool 4: get_goals
  server.registerTool(
    'get_goals',
    {
      description: 'Retrieve long-horizon goals and target dates from the LifeDash backup.',
      inputSchema: z
        .object({
          status: z.enum(['active', 'done', 'archived', 'all']).default('active'),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => ({ content: [{ type: 'text', text: JSON.stringify(queryGoals(snapshot, args)) }] }),
  );

  // Tool 5: search_notes
  server.registerTool(
    'search_notes',
    {
      description: 'Search note titles and excerpts in the LifeDash backup.',
      inputSchema: z
        .object({
          query: z.string().max(200).default(''),
          limit: z.number().int().min(1).max(50).default(20),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => ({ content: [{ type: 'text', text: JSON.stringify(queryNotes(snapshot, args)) }] }),
  );

  // Tool 6: get_day_schedule
  server.registerTool(
    'get_day_schedule',
    {
      description: 'Get scheduled tasks and timeline blocks for a specific date (YYYY-MM-DD).',
      inputSchema: z
        .object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => ({ content: [{ type: 'text', text: JSON.stringify(queryDaySchedule(snapshot, args)) }] }),
  );

  await server.connect(new StdioServerTransport());
} catch {
  console.error('Could not open a valid LifeDash snapshot or start MCP. Check the chosen file and installation. No file contents were logged.');
  process.exitCode = 1;
}
