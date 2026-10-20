import Dexie, { type Table } from 'dexie';
import type { Task, Project } from './types';

export const INBOX_ID = 'inbox';

export class LifeDashDB extends Dexie {
  tasks!: Table<Task, string>;
  projects!: Table<Project, string>;

  constructor() {
    super('lifedash');
    this.version(1).stores({
      tasks: 'id, status, projectId, parentId, dueDate, seriesId',
      projects: 'id, order',
    });
  }
}

export const db = new LifeDashDB();

export async function ensureSeed(): Promise<void> {
  if ((await db.projects.count()) === 0) {
    await db.projects.add({ id: INBOX_ID, name: 'Inbox', color: '#6366f1', order: 0, archived: false });
  }
}

let seq = 0;
export function newId(): string {
  // uuid where available, fallback for older webviews
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `id-${Date.now()}-${seq++}-${Math.random().toString(36).slice(2, 10)}`;
}
