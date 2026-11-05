import { open } from 'node:fs/promises';

const MAX_BYTES = 10 * 1024 * 1024;

export async function loadSnapshot(path) {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) {
      throw new Error('Snapshot must be a regular JSON file under 10 MB.');
    }
    const text = await handle.readFile('utf8');
    if (Buffer.byteLength(text) > MAX_BYTES) {
      throw new Error('Snapshot exceeds 10 MB.');
    }
    const data = JSON.parse(text);
    if (data?.version !== 2 || !Array.isArray(data.tasks)) {
      throw new Error('Expected a LifeDash version 2 JSON export.');
    }

    // Copy narrow projections. Never expose credentials, session tokens or private keys.
    const tasks = data.tasks.map((t) => {
      if (!t || typeof t.title !== 'string' || typeof t.id !== 'string' || !['active', 'done', 'archived'].includes(t.status)) {
        throw new Error('Invalid task in snapshot.');
      }
      return Object.freeze({
        id: t.id,
        title: t.title.slice(0, 2000),
        status: t.status,
        dueDate: typeof t.dueDate === 'string' ? t.dueDate.slice(0, 10) : null,
        dueTime: typeof t.dueTime === 'string' ? t.dueTime.slice(0, 5) : null,
        plannedDate: typeof t.plannedDate === 'string' ? t.plannedDate.slice(0, 10) : null,
        plannedTime: typeof t.plannedTime === 'string' ? t.plannedTime.slice(0, 5) : null,
        durationMinutes: typeof t.durationMinutes === 'number' ? t.durationMinutes : null,
        priority: [0, 1, 2, 3].includes(t.priority) ? t.priority : 0,
        projectId: typeof t.projectId === 'string' ? t.projectId : 'inbox',
        parentId: typeof t.parentId === 'string' ? t.parentId : null,
      });
    });

    const projects = Array.isArray(data.projects)
      ? data.projects.map((p) =>
          Object.freeze({
            id: String(p.id ?? ''),
            name: String(p.name ?? '').slice(0, 200),
            color: String(p.color ?? '#0f766e'),
            parentId: typeof p.parentId === 'string' ? p.parentId : null,
            archived: Boolean(p.archived),
          }),
        )
      : [];

    const habits = Array.isArray(data.habits)
      ? data.habits.map((h) =>
          Object.freeze({
            id: String(h.id ?? ''),
            name: String(h.name ?? '').slice(0, 200),
            weekdays: Array.isArray(h.weekdays) ? h.weekdays : null,
            archived: Boolean(h.archived),
          }),
        )
      : [];

    const habitLogs = Array.isArray(data.habitLogs)
      ? data.habitLogs.map((l) =>
          Object.freeze({
            habitId: String(l.habitId ?? ''),
            date: String(l.date ?? '').slice(0, 10),
          }),
        )
      : [];

    const goals = Array.isArray(data.goals)
      ? data.goals.map((g) =>
          Object.freeze({
            id: String(g.id ?? ''),
            title: String(g.title ?? '').slice(0, 300),
            targetDate: typeof g.targetDate === 'string' ? g.targetDate.slice(0, 10) : null,
            status: ['active', 'done', 'archived'].includes(g.status) ? g.status : 'active',
          }),
        )
      : [];

    const notes = Array.isArray(data.notes)
      ? data.notes.map((n) =>
          Object.freeze({
            id: String(n.id ?? ''),
            title: String(n.title ?? '').slice(0, 300),
            excerpt: typeof n.note === 'string' ? n.note.slice(0, 500) : '',
            pinned: Boolean(n.pinned),
          }),
        )
      : [];

    return Object.freeze({
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : null,
      tasks: Object.freeze(tasks),
      projects: Object.freeze(projects),
      habits: Object.freeze(habits),
      habitLogs: Object.freeze(habitLogs),
      goals: Object.freeze(goals),
      notes: Object.freeze(notes),
    });
  } finally {
    await handle.close();
  }
}

export function queryTasks(snapshot, { query = '', status = 'active', limit = 20 } = {}) {
  if (
    typeof query !== 'string' ||
    query.length > 200 ||
    !['active', 'done', 'archived', 'all'].includes(status) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    throw new Error('Invalid search arguments.');
  }
  const matches = (snapshot.tasks || []).filter(
    (t) => (status === 'all' || t.status === status) && t.title.toLowerCase().includes(query.toLowerCase()),
  );
  return { exportedAt: snapshot.exportedAt, total: matches.length, tasks: matches.slice(0, limit) };
}

export function queryProjects(snapshot, { includeArchived = false } = {}) {
  const list = (snapshot.projects || []).filter((p) => includeArchived || !p.archived);
  const enriched = list.map((p) => {
    const tasksInProj = (snapshot.tasks || []).filter((t) => t.projectId === p.id);
    return {
      ...p,
      activeTasks: tasksInProj.filter((t) => t.status === 'active').length,
      doneTasks: tasksInProj.filter((t) => t.status === 'done').length,
    };
  });
  return { exportedAt: snapshot.exportedAt, total: enriched.length, projects: enriched };
}

export function queryHabits(snapshot, { includeArchived = false } = {}) {
  const list = (snapshot.habits || []).filter((h) => includeArchived || !h.archived);
  const enriched = list.map((h) => {
    const logs = (snapshot.habitLogs || []).filter((l) => l.habitId === h.id).map((l) => l.date);
    return {
      ...h,
      totalCompletions: logs.length,
      recentDates: logs.slice(-7),
    };
  });
  return { exportedAt: snapshot.exportedAt, total: enriched.length, habits: enriched };
}

export function queryGoals(snapshot, { status = 'active' } = {}) {
  if (!['active', 'done', 'archived', 'all'].includes(status)) {
    throw new Error('Invalid status argument.');
  }
  const list = (snapshot.goals || []).filter((g) => status === 'all' || g.status === status);
  return { exportedAt: snapshot.exportedAt, total: list.length, goals: list };
}

export function queryNotes(snapshot, { query = '', limit = 20 } = {}) {
  if (typeof query !== 'string' || query.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('Invalid search arguments.');
  }
  const q = query.toLowerCase();
  const list = (snapshot.notes || []).filter(
    (n) => n.title.toLowerCase().includes(q) || n.excerpt.toLowerCase().includes(q),
  );
  return { exportedAt: snapshot.exportedAt, total: list.length, notes: list.slice(0, limit) };
}

export function queryDaySchedule(snapshot, { date } = {}) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Invalid date argument. Use YYYY-MM-DD.');
  }
  const tasks = (snapshot.tasks || []).filter((t) => t.dueDate === date || t.plannedDate === date);
  const sorted = [...tasks].sort((a, b) => {
    const timeA = a.plannedTime || a.dueTime || '99:99';
    const timeB = b.plannedTime || b.dueTime || '99:99';
    return timeA.localeCompare(timeB);
  });
  return { exportedAt: snapshot.exportedAt, date, total: sorted.length, tasks: sorted };
}
