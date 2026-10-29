import { DATABASE_NAME, SAMPLE_MODE } from './dev/sampleMode';
import Dexie, { type Table } from 'dexie';
import type { Task, Project, Attachment, Habit, HabitLog, Goal, Note, JournalEntry, FocusSession } from './types';

export const INBOX_ID = 'inbox';

/** Synced automation configuration (Settings toggles + user-defined rules). */
export interface AutomationSettingsRow {
  id: string; // singleton: 'settings'
  rollover: boolean;
  completeParent: boolean;
}

export interface UserRuleRow {
  id: string;
  trigger: { kind: 'tag'; tag: string } | { kind: 'weekly'; weekday: number };
  title: string;
  createdAt: number;
  lastFired: string | null;
}

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
  focusSessions!: Table<FocusSession, string>;
  automationRules!: Table<AutomationSettingsRow, string>;
  userRules!: Table<UserRuleRow, string>;

  constructor() {
    super(DATABASE_NAME);
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
    this.version(11)
      .stores({
        tasks: 'id, status, projectId, parentId, dueDate, seriesId, goalId, noteId',
        projects: 'id, order',
        attachments: 'id, taskId',
        habits: 'id, order',
        habitLogs: 'id, habitId, date',
        goals: 'id, order',
        notes: 'id, updatedAt',
        journal: 'id, date',
        syncmeta: 'key',
        focusSessions: 'id, taskId',
      });
    this.version(12).stores({
      tasks: 'id, status, projectId, parentId, dueDate, seriesId, goalId, noteId',
      projects: 'id, order',
      attachments: 'id, taskId',
      habits: 'id, order',
      habitLogs: 'id, habitId, date',
      goals: 'id, order',
      notes: 'id, updatedAt',
      journal: 'id, date',
      syncmeta: 'key',
      focusSessions: 'id, taskId',
      automationRules: 'id',
      userRules: 'id',
    });
    this.version(10)
      .stores({
        tasks: 'id, status, projectId, parentId, dueDate, seriesId, goalId, noteId',
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
          .modify((t: { noteId?: string | null }) => {
            t.noteId ??= null;
          }),
      );
  }
}

export const db = new LifeDashDB();

export async function ensureSeed(): Promise<void> {
  if (SAMPLE_MODE) {
    const { seedSample } = await import('./dev/seed');
    await seedSample();
    return;
  }
  // StrictMode can start two seed calls together. Keep count + insert atomic.
  await db.transaction('rw', db.projects, async () => {
    if ((await db.projects.count()) === 0) {
      await db.projects.add({ id: INBOX_ID, name: 'Inbox', color: '#0f766e', order: 0, archived: false });
    }
  });
}

let seq = 0;
export function newId(): string {
  // uuid where available, fallback for older webviews
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `id-${Date.now()}-${seq++}-${Math.random().toString(36).slice(2, 10)}`;
}
