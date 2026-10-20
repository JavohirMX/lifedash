import { db, newId } from './db';
import type { Task, Project } from './types';
import { completeTask, wouldCreateCycle, normalizeTag, normalizeTask } from './logic';
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
}): Promise<Task> {
  const now = Date.now();
  const task: Task = {
    id: newId(),
    title: input.title.trim(),
    note: '',
    projectId: input.projectId,
    parentId: input.parentId ?? null,
    status: 'active',
    pinned: false,
    dueDate: input.dueDate ?? null,
    recurrence: null,
    blockedBy: [],
    tags: [],
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
}

export async function togglePin(task: Task): Promise<void> {
  await updateTask(task.id, { pinned: !task.pinned });
}

export async function deleteTask(task: Task): Promise<void> {
  await db.transaction('rw', db.tasks, async () => {
    await db.tasks.where('parentId').equals(task.id).delete();
    await db.tasks.delete(task.id);
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
  const [tasks, projects] = await Promise.all([db.tasks.toArray(), db.projects.toArray()]);
  return JSON.stringify({ exportedAt: new Date().toISOString(), projects, tasks }, null, 2);
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
