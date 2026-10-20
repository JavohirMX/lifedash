export type TaskStatus = 'active' | 'done' | 'archived';

export interface Task {
  id: string;
  title: string;
  note: string; // plain text mirror of noteDoc, used by search
  noteDoc: unknown | null; // ProseMirror JSON document; null = plain/empty
  projectId: string;
  parentId: string | null;
  status: TaskStatus;
  pinned: boolean;
  dueDate: string | null; // local YYYY-MM-DD
  recurrence: string | null; // RRULE string with DTSTART
  blockedBy: string[]; // task ids that gate this task
  tags: string[]; // lowercase, no '#'
  order: number;
  seriesId: string | null; // links recurring occurrences
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface Attachment {
  id: string;
  taskId: string;
  name: string;
  mime: string;
  byteSize: number;
  blob: Blob;
  createdAt: number;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  order: number;
  archived: boolean;
}
