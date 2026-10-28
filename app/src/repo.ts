import { decodePortable, RECORD_TABLES } from './portableBackup';
import { discardDeletedEditorDraft } from './editorDrafts';
import { exportAutomation, restoreAutomation, loadRules, rolloverTargets, shouldCompleteParent, loadUserRules, saveUserRules, tagRulesFor, weeklyRulesDue, hasOpenTitle } from './automation';
import { reconcileRunningSessions } from './focus';
import { hasProjectCycle, wouldCycle } from './projects';
import type { FocusSession } from './types';
import { parseLocalDate } from './dates';
import { db, newId, INBOX_ID } from './db';
import type { Task, Project, Goal, Note, JournalEntry } from './types';
import { completeTask, skipOccurrence, subtasksOf, wouldCreateCycle, normalizeTag, normalizeTask, reorderedPosition, renamedTags, extractChecklistItems, filterNewChecklistItems } from './logic';
import { todayStr } from './dates';

async function nextOrder(projectId: string): Promise<number> {
  const max = await db.tasks.where('projectId').equals(projectId).toArray();
  return max.reduce((m, t) => Math.max(m, t.order), 0) + 1;
}

export async function addTask(input: {
  title: string;
  projectId: string;
  dueDate?: string | null;
  dueTime?: string | null;
  recurrence?: string | null;
  priority?: number;
  parentId?: string | null;
  goalId?: string | null;
  noteId?: string | null;
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
    noteId: input.noteId ?? null,
    status: 'active',
    pinned: false,
    priority: input.priority ?? 0,
    dueDate: input.dueDate ?? null,
    dueTime: input.dueTime ?? null,
    recurrence: input.recurrence ?? null,
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
  await applyUserRulesForCompletion(task);
}

/** Explicitly skip the current occurrence of a recurring task. */
export async function skipTask(task: Task): Promise<void> {
  const result = skipOccurrence(task, todayStr(), Date.now());
  if (!result) return;
  await db.tasks.update(task.id, result.updates);
}

/** Complete a parent task, optionally completing its open subtasks first.
 * Subtasks go through the normal completion path (toggleComplete), so
 * recurring subtasks spawn their next occurrence and user rules fire. */
export async function completeWithSubtasks(task: Task, includeSubtasks: boolean): Promise<void> {
  if (includeSubtasks) {
    const all = await db.tasks.toArray();
    for (const sub of subtasksOf(all, task.id)) {
      if (sub.status === 'active') await toggleComplete(sub);
    }
  }
  // Completing the last child may already complete the parent via automation.
  // Never toggle that freshly-completed parent back to active.
  const current = await db.tasks.get(task.id);
  if (current && current.status !== 'done') await toggleComplete(current);
}

/** Fire user tag rules for a just-completed task. Created tasks carry no
 * tags, so a rule's own product can never retrigger it. */
export async function applyUserRulesForCompletion(task: Task): Promise<number> {
  const due = tagRulesFor(loadUserRules(), task);
  if (due.length === 0) return 0;
  const all = await db.tasks.toArray();
  let created = 0;
  for (const rule of due) {
    if (hasOpenTitle(all, rule.title)) continue;
    const t = await addTask({ title: rule.title, projectId: task.projectId });
    all.push(t);
    created++;
  }
  return created;
}

/** Fire due weekly user rules on app open. lastFired is stamped even when
 * creation is skipped (open task with the same title), so a rule still fires
 * at most once per day. */
export async function applyWeeklyUserRules(today: string): Promise<number> {
  const weekday = parseLocalDate(today).getDay();
  const rules = loadUserRules();
  const due = weeklyRulesDue(rules, today, weekday);
  if (due.length === 0) return 0;
  const all = await db.tasks.toArray();
  let created = 0;
  for (const rule of due) {
    if (!hasOpenTitle(all, rule.title)) {
      const t = await addTask({ title: rule.title, projectId: 'inbox' });
      all.push(t);
      created++;
    }
    rule.lastFired = today;
  }
  saveUserRules(rules);
  return created;
}

/** Start focusing on a task. Any already-running session is finalized in
 * the same readwrite transaction, so exactly one session runs at a time;
 * IndexedDB serializes overlapping readwrite transactions even across tabs. */
export async function startFocus(taskId: string): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.focusSessions, async () => {
    const running = await db.focusSessions.filter((s) => s.endedAt === null).toArray();
    for (const s of running) {
      await db.focusSessions.update(s.id, { endedAt: now, seconds: Math.max(0, Math.floor((now - s.startedAt) / 1000)) });
    }
    await db.focusSessions.add({ id: newId(), taskId, startedAt: now, endedAt: null, seconds: 0 });
  });
}

/** Stop the running session, if any. Same single-transaction shape as
 * startFocus: the read-then-write race cannot interleave. */
export async function stopFocus(): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.focusSessions, async () => {
    const running = await db.focusSessions.filter((s) => s.endedAt === null).toArray();
    for (const s of running) {
      await db.focusSessions.update(s.id, { endedAt: now, seconds: Math.max(0, Math.floor((now - s.startedAt) / 1000)) });
    }
  });
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
  let deletedIds: string[] = [];
  await db.transaction('rw', db.tasks, db.attachments, async () => {
    const childIds = (await db.tasks.where('parentId').equals(task.id).primaryKeys()) as string[];
    const gone = new Set([task.id, ...childIds]);
    deletedIds = [...gone];
    await db.tasks.where('parentId').equals(task.id).delete();
    await db.tasks.delete(task.id);
    await db.attachments.where('taskId').anyOf([...gone]).delete();
    // Strip dead dependency references so they don't linger and sync forever.
    await db.tasks
      .filter((t) => (t.blockedBy ?? []).some((id) => gone.has(id)))
      .modify((t) => {
        t.blockedBy = (t.blockedBy ?? []).filter((id) => !gone.has(id));
      });
  });
  for (const id of deletedIds) discardDeletedEditorDraft(db.name, 'tasks', id);
}

export async function addProject(name: string, color: string, parentId: string | null = null): Promise<Project> {
  const all = await db.projects.toArray();
  if (parentId !== null && !all.some((p) => p.id === parentId)) {
    throw new Error('That parent project no longer exists.');
  }
  const project: Project = { id: newId(), name: name.trim(), color, order: all.length, archived: false, parentId };
  await db.projects.add(project);
  return project;
}

export async function updateProject(
  id: string,
  patch: { name?: string; color?: string; parentId?: string | null },
): Promise<void> {
  const clean: { name?: string; color?: string; parentId?: string | null } = {};
  if (patch.name !== undefined) clean.name = patch.name.trim();
  if (patch.color !== undefined) clean.color = patch.color;
  if (patch.parentId !== undefined) {
    if (patch.parentId !== null) {
      const all = await db.projects.toArray();
      if (wouldCycle(all, id, patch.parentId)) {
        throw new Error("A project can't live inside itself or one of its own subprojects.");
      }
    }
    clean.parentId = patch.parentId;
  }
  await db.projects.update(id, clean);
}

export async function deleteProject(project: Project): Promise<void> {
  let deletedIds: string[] = [];
  await db.transaction('rw', db.tasks, db.projects, async () => {
    const ids = await db.tasks.where('projectId').equals(project.id).primaryKeys();
    const idSet = new Set(ids as string[]);
    const childIds = await db.tasks.where('parentId').anyOf([...idSet]).primaryKeys();
    deletedIds = [...new Set([...ids, ...childIds])] as string[];
    await db.tasks.where('parentId').anyOf([...idSet]).delete();
    await db.tasks.where('projectId').equals(project.id).delete();
    // Approved policy (John, Oct 27): subprojects move up one level
    // and stay intact; only this project's own tasks are deleted.
    await db.projects.filter((p) => (p.parentId ?? null) === project.id).modify({ parentId: project.parentId ?? null });
    await db.projects.delete(project.id);
  });
  for (const id of deletedIds) discardDeletedEditorDraft(db.name, 'tasks', id);
}

export async function exportJson(): Promise<string> {
  const [tasks, projects, attachments, habits, habitLogs, goals, notes, journal, focusSessions] = await Promise.all([
    db.tasks.toArray(),
    db.projects.toArray(),
    db.attachments.toArray(),
    db.habits.toArray(),
    db.habitLogs.toArray(),
    db.goals.toArray(),
    db.notes.toArray(),
    db.journal.toArray(),
    db.focusSessions.toArray(),
  ]);
  // Attachment binaries stay on-device; metadata is exported for reference.
  const attachmentMeta = attachments.map(({ blob: _blob, ...meta }) => meta);
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      version: 2,
      automation: exportAutomation(),
      projects,
      tasks,
      attachments: attachmentMeta,
      habits,
      habitLogs,
      goals,
      notes,
      journal,
      focusSessions,
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

/** Rename a tag everywhere. Renaming onto an existing tag merges them. */
export async function renameTag(from: string, to: string): Promise<number> {
  if (!from || !to || from === to) return 0;
  const affected = await db.tasks.filter((t) => (t.tags ?? []).includes(from)).toArray();
  await db.transaction('rw', db.tasks, async () => {
    const now = Date.now();
    for (const t of affected) {
      await db.tasks.update(t.id, { tags: renamedTags(t.tags ?? [], from, to), updatedAt: now });
    }
  });
  return affected.length;
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

export async function updateHabit(id: string, patch: { name?: string; weekdays?: number[] | null }): Promise<void> {
  const clean: { name?: string; weekdays?: number[] | null } = {};
  if (patch.name !== undefined) clean.name = patch.name.trim();
  if (patch.weekdays !== undefined) clean.weekdays = patch.weekdays;
  await db.habits.update(id, clean);
}

export async function archiveHabit(id: string): Promise<void> {
  await db.habits.update(id, { archived: true });
}

export async function restoreHabit(id: string): Promise<void> {
  await db.habits.update(id, { archived: false });
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
        noteId: null,
        projectId,
        priority: 0,
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

// Keep conversion atomic and deduplicate inside the same write transaction.
// A retry or another tab must not create a partial or duplicate task set.
export async function addTasksFromNoteChecklist(noteId: string): Promise<number> {
  return db.transaction('rw', db.tasks, db.notes, async () => {
    const note = await db.notes.get(noteId);
    if (!note) throw new Error('Note no longer exists.');
    const existing = (await db.tasks.where('noteId').equals(noteId).toArray()).map((task) => task.title);
    const items = filterNewChecklistItems(extractChecklistItems(note.noteDoc), existing);
    for (const title of items) await addTask({ title, projectId: INBOX_ID, noteId });
    return items.length;
  });
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
  await db.transaction('rw', db.notes, db.tasks, async () => {
    await db.notes.delete(id);
    // Tasks created from this note keep their text; drop the dead link.
    await db.tasks.where('noteId').equals(id).modify({ noteId: null });
  });
  discardDeletedEditorDraft(db.name, 'notes', id);
}

export async function getOrCreateJournalEntry(date: string): Promise<JournalEntry> {
  // Mood, highlight and rich-text saves can arrive together. Keep the lookup
  // and creation in one read-write transaction, including across browser tabs.
  return db.transaction('rw', db.journal, async () => {
    const existing = await db.journal.where('date').equals(date).first();
    if (existing) return existing;
    const now = Date.now();
    const entry: JournalEntry = { id: newId(), date, note: '', noteDoc: null, mood: null, highlight: null, createdAt: now, updatedAt: now };
    await db.journal.add(entry);
    return entry;
  });
}

export async function updateJournalEntry(id: string, patch: Partial<JournalEntry>): Promise<void> {
  await db.journal.update(id, { ...patch, updatedAt: Date.now() });
}

// Restore a full backup (exportJson v2). Merges by id - existing rows with
// the same id are overwritten, nothing is deleted.
export async function countAttachments(): Promise<number> {
  return db.attachments.count();
}

export async function importBackup(json: string): Promise<{ restored: Record<string, number> }> {
  const data = JSON.parse(json) as Record<string, unknown>;
  if (data?.version !== 2 && data?.version !== 3) throw new Error('Not a supported Lifedash backup.');
  const portable = data.version === 3 ? await decodePortable(data) : null;
  const tables: string[] = portable ? [...RECORD_TABLES, 'attachments'] : [...RECORD_TABLES];
  // Validate every row before writing anything: one bad row aborts the
  // whole restore instead of leaving a half-import (Dexie also rolls the
  // transaction back on any write error).
  const valid: [string, Record<string, unknown>[]][] = [];
  for (const t of tables) {
    const rows = portable ? portable[t] : data[t];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    for (const r of rows) {
      if (!r || typeof r !== 'object' || typeof (r as { id?: unknown }).id !== 'string') {
        throw new Error(`Backup row without an id in "${t}". Nothing was restored.`);
      }
    }
    valid.push([t, rows as Record<string, unknown>[]]);
  }
  const projectRows = (valid.find(([t]) => t === 'projects')?.[1] ?? []) as unknown as Project[];
  if (hasProjectCycle(projectRows)) {
    throw new Error('Backup has a broken project hierarchy (cycle or missing parent). Nothing was restored.');
  }
  const restored: Record<string, number> = {};
  await db.transaction('rw', tables.map((t) => db.table(t)), async () => {
    for (const [t, rows] of valid) {
      await db.table(t).bulkPut(rows);
      restored[t] = rows.length;
    }
    // A backup can carry a running session while one is already running
    // here; reconcile inside the restore transaction so at most one runs.
    const all = (await db.focusSessions.toArray()) as FocusSession[];
    for (const s of reconcileRunningSessions(all)) {
      if (s.endedAt !== null && all.find((o) => o.id === s.id)?.endedAt === null) {
        await db.focusSessions.put(s);
      }
    }
  });
  try { restoreAutomation(data.automation); }
  catch { throw new Error('Backup records were restored, but automation settings could not be fully restored. Check your records and Automation before restoring again.'); }
  return { restored };
}
