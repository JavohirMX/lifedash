export type TaskStatus = 'active' | 'done' | 'archived';

export interface Task {
  id: string;
  title: string;
  note: string; // plain text mirror of noteDoc, used by search
  noteDoc: unknown | null; // ProseMirror JSON document; null = plain/empty
  projectId: string;
  parentId: string | null;
  goalId: string | null;
  noteId: string | null; // note this task was extracted from, if any
  status: TaskStatus;
  pinned: boolean;
  priority: number; // 0 none, 1 high, 2 medium, 3 low
  dueDate: string | null; // local YYYY-MM-DD
  dueTime: string | null; // local 'HH:MM', null = anytime
  recurrence: string | null; // RRULE string with DTSTART
  blockedBy: string[]; // task ids that gate this task
  tags: string[]; // lowercase, no '#'
  order: number;
  seriesId: string | null; // links recurring occurrences
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface Habit {
  id: string;
  name: string;
  color: string;
  weekdays: number[] | null; // null = every day; else weekday numbers (0=Sun)
  order: number;
  archived: boolean;
  createdAt: number;
}

export interface HabitLog {
  id: string; // `${habitId}:${date}` - idempotent per day
  habitId: string;
  date: string; // local YYYY-MM-DD
  doneAt: number;
}

export interface JournalEntry {
  id: string;
  date: string; // YYYY-MM-DD, one entry per day
  note: string;
  noteDoc: unknown | null;
  mood: number | null; // 1-5
  highlight?: string | null; // one-liner shown on the TV surface
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: string;
  title: string;
  note: string; // plain-text mirror for search/excerpts
  noteDoc: unknown | null; // ProseMirror JSON
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Goal {
  id: string;
  title: string;
  note: string;
  targetDate: string | null; // local YYYY-MM-DD
  status: 'active' | 'done' | 'archived';
  order: number;
  createdAt: number;
  updatedAt: number;
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
  parentId?: string | null; // nesting; absent/null = top level
}

export interface FocusSession {
  id: string;
  taskId: string;
  startedAt: number;
  endedAt: number | null;
  seconds: number; // final total once endedAt is set; 0 while running
}
