import { open } from 'node:fs/promises';
const MAX_BYTES = 10 * 1024 * 1024;
export async function loadSnapshot(path) {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Snapshot must be a regular JSON file under 10 MB.');
    const text = await handle.readFile('utf8');
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Snapshot exceeds 10 MB.');
    const data = JSON.parse(text);
    if (data?.version !== 2 || !Array.isArray(data.tasks)) throw new Error('Expected a LifeDash version 2 JSON export.');
    // Copy a narrow projection. Never expose notes, journal, attachments or settings.
    const tasks = data.tasks.map(t => {
      if (!t || typeof t.title !== 'string' || typeof t.id !== 'string' || !['active', 'done', 'archived'].includes(t.status)) throw new Error('Invalid task in snapshot.');
      return Object.freeze({ id: t.id, title: t.title.slice(0, 2000), status: t.status, dueDate: typeof t.dueDate === 'string' ? t.dueDate.slice(0, 10) : null, priority: [0, 1, 2, 3].includes(t.priority) ? t.priority : 0 });
    });
    return Object.freeze({ exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : null, tasks: Object.freeze(tasks) });
  } finally { await handle.close(); }
}
export function queryTasks(snapshot, { query = '', status = 'active', limit = 20 } = {}) {
  if (typeof query !== 'string' || query.length > 200 || !['active', 'done', 'archived', 'all'].includes(status) || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid search arguments.');
  const matches = snapshot.tasks.filter(t => (status === 'all' || t.status === status) && t.title.toLowerCase().includes(query.toLowerCase()));
  return { exportedAt: snapshot.exportedAt, total: matches.length, tasks: matches.slice(0, limit) };
}
