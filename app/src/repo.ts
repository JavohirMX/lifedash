import { loadRules, rolloverTargets, shouldCompleteParent } from './automation';
import { db, newId } from './db';
import type { Task, Project, Goal, Note, JournalEntry } from './types';
import { completeTask, wouldCreateCycle, normalizeTag, normalizeTask, reorderedPosition } from './logic';
import { todayStr } from './dates';

async function nextOrder(projectId: string): Promise<number> {
  const max = await db.tasks.where('projectId').equals(projectId).toArray();
  return max.reduce((m, t) => Math.max(m, t.order), 0) + 1;
}

export async function addTask(input: {
  title: string;
  projectId: string;
  dueDate?: string | null;
  parentId?: string | null;
  goalId?: string | null;
  tags?: string[];
}): Promise<Task> {
  const now = Date.now();
  const task: Task = {
    id: newId(),
    title: input.title.trim(),
    note: '',
    noteDoc: null,
    projectId: input.projectId,
    parentId: input.parentId ?? null,
    goalId: input.goalId ?? null,
    status: 'active',
    pinned: false,
    dueDate: input.dueDate ?? null,
    dueTime: null,
    recurrence: null,
    blockedBy: [],
    tags: input.tags ?? [],
    order: await nextOrder(input.projectId),
    seriesId: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  await db.tasks.add(task);
  return task;
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
  await db.tasks.update(id, { ...patch, updatedAt: Date.now() });
}

export async function toggleComplete(task: Task): Promise<void> {
  if (task.status === 'done') {
    // Undo. Note: if this was a recurring completion, the already-spawned next
    // occurrence stays - deleting it could remove edits the user already made.
    await updateTask(task.id, { status: 'active', completedAt: null });
    return;
  }
  const { updates, spawned } = completeTask(task, todayStr(), Date.now());
  await db.transaction('rw', db.tasks, async () => {
    await db.tasks.update(task.id, updates);
    if (spawned) {
      const now = Date.now();
      await db.tasks.add({ ...spawned, id: newId(), createdAt: now, updatedAt: now });
    }
  });
  // Automation: completing the last open subtask completes the parent
  // (through this same function, so recurrence spawns the next occurrence).
  if (task.parentId && loadRules().completeParent) {
    const all = await db.tasks.toArray();
    if (shouldCompleteParent(all, task.parentId)) {
      const parent = all.find((x) => x.id === task.parentId);
      if (parent) await toggleComplete(parent);
    }
  }
}

/** Move every overdue active task into Today. Returns how many moved. */
export async function applyRollover(today: string): Promise<number> {
  const all = await db.tasks.toArray();
  const ids = rolloverTargets(all, today);
  if (ids.length === 0) return 0;
  const now = Date.now();
  await db.tasks.where('id').anyOf(ids).modify({ dueDate: today, updatedAt: now });
  return ids.length;
}

export async function togglePin(task: Task): Promise<void> {
  await updateTask(task.id, { pinned: !task.pinned });
}

export async function deleteTask(task: Task): Promise<void> {
  await db.transaction('rw', db.tasks, db.attachments, async () => {
    const childIds = (await db.tasks.where('parentId').equals(task.id).primaryKeys()) as string[];
    await db.tasks.where('parentId').equals(task.id).delete();
    await db.tasks.delete(task.id);
    await db.attachments.where('taskId').anyOf([task.id, ...childIds]).delete();
  });
}

export async function addProject(name: string, color: string): Promise<Project> {
  const count = await db.projects.count();
  const project: Project = { id: newId(), name: name.trim(), color, order: count, archived: false };
  await db.projects.add(project);
  return project;
}

export async function deleteProject(project: Project): Promise<void> {
  await db.transaction('rw', db.tasks, db.projects, async () => {
    const ids = await db.tasks.where('projectId').equals(project.id).primaryKeys();
    const idSet = new Set(ids as string[]);
    await db.tasks.where('parentId').anyOf([...idSet]).delete();
    await db.tasks.where('projectId').equals(project.id).delete();
    await db.projects.delete(project.id);
  });
}

export async function exportJson(): Promise<string> {
  const [tasks, projects, attachments, habits, habitLogs, goals, notes, journal] = await Promise.all([
    db.tasks.toArray(),
    db.projects.toArray(),
    db.attachments.toArray(),
    db.habits.toArray(),
    db.habitLogs.toArray(),
    db.goals.toArray(),
    db.notes.toArray(),
    db.journal.toArray(),
  ]);
  // Attachment binaries stay on-device; metadata is exported for reference.
  const attachmentMeta = attachments.map(({ blob: _blob, ...meta }) => meta);
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      version: 2,
      projects,
      tasks,
      attachments: attachmentMeta,
      habits,
      habitLogs,
      goals,
      notes,
      journal,
    },
    null,
    2,
  );
}

export async function addAttachment(taskId: string, file: File): Promise<void> {
  await db.attachments.add({
    id: newId(),
    taskId,
    name: file.name,
    mime: file.type || 'application/octet-stream',
    byteSize: file.size,
    blob: file,
    createdAt: Date.now(),
  });
}

export async function deleteAttachment(id: string): Promise<void> {
  await db.attachments.delete(id);
}

export async function addBlocker(taskId: string, blockerId: string): Promise<{ ok: boolean; reason?: string }> {
  const all = (await db.tasks.toArray()).map(normalizeTask);
  if (wouldCreateCycle(all, taskId, blockerId)) {
    return { ok: false, reason: 'That would create a dependency loop.' };
  }
  const task = all.find((t) => t.id === taskId);
  if (!task) return { ok: false, reason: 'Task not found.' };
  const blockedBy = [...new Set([...(task.blockedBy ?? []), blockerId])];
  await updateTask(taskId, { blockedBy });
  return { ok: true };
}

export async function removeBlocker(taskId: string, blockerId: string): Promise<void> {
  const task = await db.tasks.get(taskId);
  if (!task) return;
  await updateTask(taskId, { blockedBy: (task.blockedBy ?? []).filter((id) => id !== blockerId) });
}

export async function addTag(taskId: string, raw: string): Promise<void> {
  const tag = normalizeTag(raw);
  if (!tag) return;
  const task = await db.tasks.get(taskId);
  if (!task) return;
  await updateTask(taskId, { tags: [...new Set([...(task.tags ?? []), tag])] });
}

export async function removeTag(taskId: string, tag: string): Promise<void> {
  const task = await db.tasks.get(taskId);
  if (!task) return;
  await updateTask(taskId, { tags: (task.tags ?? []).filter((t) => t !== tag) });
}

export async function moveTask(taskId: string, targetId: string, after: boolean, list: Task[]): Promise<void> {
  const order = reorderedPosition(list, taskId, targetId, after);
  if (order === null) return;
  await updateTask(taskId, { order });
}

export async function addHabit(name: string, color: string, weekdays: number[] | null): Promise<void> {
  const count = await db.habits.count();
  await db.habits.add({
    id: newId(),
    name: name.trim(),
    color,
    weekdays,
    order: count,
    archived: false,
    createdAt: Date.now(),
  });
}

export async function archiveHabit(id: string): Promise<void> {
  await db.habits.update(id, { archived: true });
}

export async function toggleHabitForDate(habitId: string, date: string): Promise<void> {
  const id = `${habitId}:${date}`;
  const existing = await db.habitLogs.get(id);
  if (existing) await db.habitLogs.delete(id);
  else await db.habitLogs.add({ id, habitId, date, doneAt: Date.now() });
}

export async function importTasks(
  items: import('./import').ImportedTask[],
  projectIdFor: (sourceName?: string) => string,
): Promise<number> {
  await db.transaction('rw', db.tasks, async () => {
    const counters = new Map<string, number>();
    const stack: string[] = []; // last task id per indent level
    for (const item of items) {
      const projectId = projectIdFor(item.project);
      const order = (counters.get(projectId) ?? (await db.tasks.where('projectId').equals(projectId).toArray()).reduce((m, t) => Math.max(m, t.order), 0)) + 1;
      counters.set(projectId, order);
      const now = Date.now();
      const indent = Math.min(item.indent, stack.length);
      const id = newId();
      await db.tasks.add({
        id,
        title: item.title,
        note: '',
        noteDoc: null,
        goalId: null,
        projectId,
        parentId: indent > 0 ? stack[indent - 1] : null,
        status: item.done ? 'done' : 'active',
        pinned: item.pinned,
        dueDate: item.dueDate,
        dueTime: null,
        recurrence: null,
        blockedBy: [],
        tags: item.tags,
        order,
        seriesId: null,
        createdAt: now,
        updatedAt: now,
        completedAt: item.done ? now : null,
      });
      stack[indent] = id;
      stack.length = indent + 1;
    }
  });
  return items.length;
}

export async function addGoal(title: string, targetDate: string | null): Promise<Goal> {
  const count = await db.goals.count();
  const now = Date.now();
  const goal: Goal = { id: newId(), title: title.trim(), note: '', targetDate, status: 'active', order: count, createdAt: now, updatedAt: now };
  await db.goals.add(goal);
  return goal;
}

export async function updateGoal(id: string, patch: Partial<Goal>): Promise<void> {
  await db.goals.update(id, { ...patch, updatedAt: Date.now() });
}

export async function addNote(): Promise<Note> {
  const now = Date.now();
  const note: Note = { id: newId(), title: '', note: '', noteDoc: null, pinned: false, createdAt: now, updatedAt: now };
  await db.notes.add(note);
  return note;
}

export async function updateNote(id: string, patch: Partial<Note>): Promise<void> {
  await db.notes.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteNote(id: string): Promise<void> {
  await db.notes.delete(id);
}

export async function getOrCreateJournalEntry(date: string): Promise<JournalEntry> {
  const existing = await db.journal.where('date').equals(date).first();
  if (existing) return existing;
  const now = Date.now();
  const entry: JournalEntry = { id: newId(), date, note: '', noteDoc: null, mood: null, createdAt: now, updatedAt: now };
  await db.journal.add(entry);
  return entry;
}

export async function updateJournalEntry(id: string, patch: Partial<JournalEntry>): Promise<void> {
  await db.journal.update(id, { ...patch, updatedAt: Date.now() });
}

// Restore a full backup (exportJson v2). Merges by id - existing rows with
// the same id are overwritten, nothing is deleted.
export async function importBackup(json: string): Promise<{ restored: Record<string, number> }> {
  const data = JSON.parse(json) as Record<string, unknown>;
  const tables = ['projects', 'tasks', 'habits', 'habitLogs', 'goals', 'notes', 'journal'] as const;
  const restored: Record<string, number> = {};
  await db.transaction('rw', tables.map((t) => db.table(t)), async () => {
    for (const t of tables) {
      const rows = data[t];
      if (Array.isArray(rows) && rows.length > 0) {
        await db.table(t).bulkPut(rows);
        restored[t] = rows.length;
      }
    }
  });
  return { restored };
}
