import Dexie, { type Table } from 'dexie';
import type { Task, Project, Attachment, Habit, HabitLog, Goal, Note, JournalEntry } from './types';

export const INBOX_ID = 'inbox';

export class LifeDashDB extends Dexie {
  syncmeta!: Table<{ key: string; value: unknown }, string>;
  tasks!: Table<Task, string>;
  projects!: Table<Project, string>;
  attachments!: Table<Attachment, string>;
  habits!: Table<Habit, string>;
  goals!: Table<Goal, string>;
  notes!: Table<Note, string>;
  journal!: Table<JournalEntry, string>;
  habitLogs!: Table<HabitLog, string>;

  constructor() {
    super('lifedash');
    this.version(1).stores({
      tasks: 'id, status, projectId, parentId, dueDate, seriesId',
      projects: 'id, order',
    });
    this.version(2)
      .stores({
        tasks: 'id, status, projectId, parentId, dueDate, seriesId',
        projects: 'id, order',
      })
      .upgrade((tx) =>
        tx
          .table('tasks')
          .toCollection()
          .modify((t: { blockedBy?: string[]; tags?: string[] }) => {
            t.blockedBy ??= [];
            t.tags ??= [];
          }),
      );
    this.version(3)
      .stores({
        tasks: 'id, status, projectId, parentId, dueDate, seriesId',
        projects: 'id, order',
        attachments: 'id, taskId',
      })
      .upgrade((tx) =>
        tx
          .table('tasks')
          .toCollection()
          .modify((t: { noteDoc?: unknown }) => {
            t.noteDoc ??= null;
          }),
      );
    this.version(4)
      .stores({
        tasks: 'id, status, projectId, parentId, dueDate, seriesId',
        projects: 'id, order',
        attachments: 'id, taskId',
        habits: 'id, order',
        habitLogs: 'id, habitId, date',
      })
      .upgrade((tx) =>
        tx
          .table('tasks')
          .toCollection()
          .modify((t: { dueTime?: string | null }) => {
            t.dueTime ??= null;
          }),
      );
    this.version(5).stores({
      tasks: 'id, status, projectId, parentId, dueDate, seriesId',
      projects: 'id, order',
      attachments: 'id, taskId',
      habits: 'id, order',
      habitLogs: 'id, habitId, date',
      syncmeta: 'key',
    });
    this.version(6)
      .stores({
        tasks: 'id, status, projectId, parentId, dueDate, seriesId, goalId',
        projects: 'id, order',
        attachments: 'id, taskId',
        habits: 'id, order',
        habitLogs: 'id, habitId, date',
        goals: 'id, order',
        syncmeta: 'key',
      })
      .upgrade((tx) =>
        tx
          .table('tasks')
          .toCollection()
          .modify((t: { goalId?: string | null }) => {
            t.goalId ??= null;
          }),
      );
    this.version(7).stores({
      tasks: 'id, status, projectId, parentId, dueDate, seriesId, goalId',
      projects: 'id, order',
      attachments: 'id, taskId',
      habits: 'id, order',
      habitLogs: 'id, habitId, date',
      goals: 'id, order',
      notes: 'id, updatedAt',
      syncmeta: 'key',
    });
    this.version(8).stores({
      tasks: 'id, status, projectId, parentId, dueDate, seriesId, goalId',
      projects: 'id, order',
      attachments: 'id, taskId',
      habits: 'id, order',
      habitLogs: 'id, habitId, date',
      goals: 'id, order',
      notes: 'id, updatedAt',
      journal: 'id, date',
      syncmeta: 'key',
    });
    this.version(9)
      .stores({
        tasks: 'id, status, projectId, parentId, dueDate, seriesId, goalId',
        projects: 'id, order',
        attachments: 'id, taskId',
        habits: 'id, order',
        habitLogs: 'id, habitId, date',
        goals: 'id, order',
        notes: 'id, updatedAt',
        journal: 'id, date',
        syncmeta: 'key',
      })
      .upgrade((tx) =>
        tx
          .table('tasks')
          .toCollection()
          .modify((t: { priority?: number }) => {
            t.priority ??= 0;
          }),
      );
  }
}

export const db = new LifeDashDB();

export async function ensureSeed(): Promise<void> {
  if ((await db.projects.count()) === 0) {
    await db.projects.add({ id: INBOX_ID, name: 'Inbox', color: '#0f766e', order: 0, archived: false });
  }
}

let seq = 0;
export function newId(): string {
  // uuid where available, fallback for older webviews
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `id-${Date.now()}-${seq++}-${Math.random().toString(36).slice(2, 10)}`;
}
