import { describe, expect, it, beforeEach } from 'vitest';

// Node test env has no localStorage; the module only touches it inside
// functions, so a tiny in-memory stub is enough.
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  get length() { return store.size; },
} as Storage;
import { dueReminders, remindersEnabled, setRemindersEnabled, journalPromptEnabled, setJournalPromptEnabled, journalPromptDue, startReminders } from './reminders';
import type { Task } from './types';

const mk = (over: Partial<Task>): Task => ({
  id: 't1', title: 'Task', note: '', noteDoc: null, projectId: '', goalId: null,
  noteId: null, seriesId: null, parentId: null, tags: [], priority: 0, dueDate: null,
  dueTime: null, recurrence: null, pinned: false, blockedBy: [], status: 'active',
  order: 0, completedAt: null, createdAt: 0, updatedAt: 0,
  ...over,
});

describe('dueReminders', () => {
  it('matches active top-level tasks due at the exact date and time', () => {
    const tasks = [
      mk({ id: 'hit', dueDate: '2026-10-20', dueTime: '09:30' }),
      mk({ id: 'other-time', dueDate: '2026-10-20', dueTime: '10:00' }),
      mk({ id: 'other-day', dueDate: '2026-10-21', dueTime: '09:30' }),
      mk({ id: 'done', dueDate: '2026-10-20', dueTime: '09:30', status: 'done' }),
      mk({ id: 'subtask', dueDate: '2026-10-20', dueTime: '09:30', parentId: 'p' }),
      mk({ id: 'anytime', dueDate: '2026-10-20', dueTime: null }),
    ];
    const hits = dueReminders(tasks, '2026-10-20', '09:30').map((t) => t.id);
    expect(hits).toEqual(['hit']);
  });
});

describe('pref', () => {
  beforeEach(() => localStorage.clear());
  it('round-trips the enabled flag', () => {
    expect(remindersEnabled()).toBe(false);
    setRemindersEnabled(true);
    expect(remindersEnabled()).toBe(true);
    setRemindersEnabled(false);
    expect(remindersEnabled()).toBe(false);
  });
});

describe('startReminders', () => {
  beforeEach(() => localStorage.clear());
  it('fires once per task and remembers across restarts', () => {
    const at = new Date(2026, 9, 20, 9, 30, 12);
    const task = mk({ id: 'hit', dueDate: '2026-10-20', dueTime: '09:30' });
    const seen: string[] = [];
    const stop = startReminders(() => [task], (t) => seen.push(t.id), () => at);
    expect(seen).toEqual(['hit']);
    stop();
    // A second scheduler in the same minute does not re-fire (persisted).
    const seen2: string[] = [];
    const stop2 = startReminders(() => [task], (t) => seen2.push(t.id), () => at);
    expect(seen2).toEqual([]);
    stop2();
  });
});

describe('journal prompt pref', () => {
  beforeEach(() => localStorage.clear());
  it('defaults off and round-trips independently of the reminders pref', () => {
    expect(journalPromptEnabled()).toBe(false);
    setRemindersEnabled(true);
    expect(journalPromptEnabled()).toBe(false);
    setJournalPromptEnabled(true);
    expect(journalPromptEnabled()).toBe(true);
    setJournalPromptEnabled(false);
    expect(journalPromptEnabled()).toBe(false);
    expect(remindersEnabled()).toBe(true);
  });
});

describe('journalPromptDue', () => {
  it('gates on the 21:00 minute, an empty journal, and not-yet-fired', () => {
    const fired = new Set<string>();
    expect(journalPromptDue('2026-10-20', '21:00', true, fired)).toBe(true);
    expect(journalPromptDue('2026-10-20', '20:59', true, fired)).toBe(false);
    expect(journalPromptDue('2026-10-20', '21:01', true, fired)).toBe(false);
    expect(journalPromptDue('2026-10-20', '21:00', false, fired)).toBe(false);
    expect(journalPromptDue('2026-10-20', '21:00', true, new Set(['journal:2026-10-20']))).toBe(false);
  });
});

describe('startReminders journal hook', () => {
  beforeEach(() => localStorage.clear());
  it('fires the nudge once per day across restarts, alongside task reminders', () => {
    const at = new Date(2026, 9, 20, 21, 0, 5);
    const task = mk({ id: 'hit', dueDate: '2026-10-20', dueTime: '21:00' });
    const tasks: string[] = [];
    const nudges: string[] = [];
    const hook = { isEmptyToday: () => true, notify: () => nudges.push('nudge') };
    const stop1 = startReminders(() => [task], (t) => tasks.push(t.id), () => at, 30_000, hook);
    expect(tasks).toEqual(['hit']);
    expect(nudges).toEqual(['nudge']);
    stop1();
    const stop2 = startReminders(() => [task], (t) => tasks.push(t.id), () => at, 30_000, hook);
    expect(nudges).toEqual(['nudge']);
    stop2();
  });

  it('stays silent when the journal has content and without a hook', () => {
    const at = new Date(2026, 9, 20, 21, 0, 5);
    const nudges: string[] = [];
    const stop1 = startReminders(() => [], () => {}, () => at, 30_000, { isEmptyToday: () => false, notify: () => nudges.push('x') });
    stop1();
    const stop2 = startReminders(() => [], () => {}, () => at);
    stop2();
    expect(nudges).toEqual([]);
  });
});
