import { describe, expect, it, beforeEach } from 'vitest';
import { deriveGreeting, deriveHighlight, deriveTv, isTvEnabled, setTvEnabled, TV_ENABLED_KEY, TV_PREFERENCE_CHANGED_EVENT } from './tv';
import { suggestedTask } from './logic';
import type { FocusSession, Goal, Habit, HabitLog, JournalEntry, Project, Task } from './types';

let seq = 0;
function task(over: Partial<Task>): Task {
  seq++;
  return {
    id: `t${seq}`, title: `task ${seq}`, note: '', noteDoc: null, projectId: 'inbox',
    parentId: null, goalId: null, noteId: null, status: 'active', pinned: false,
    priority: 0, dueDate: null, dueTime: null, recurrence: null, blockedBy: [],
    tags: [], order: seq, seriesId: null, createdAt: seq, updatedAt: seq,
    completedAt: null,
    ...over,
  };
}
function habit(over: Partial<Habit>): Habit {
  seq++;
  return { id: `h${seq}`, name: `habit ${seq}`, color: '#000', weekdays: null, order: seq, archived: false, createdAt: seq, ...over };
}
function log(habitId: string, date: string): HabitLog {
  return { id: `${habitId}:${date}`, habitId, date, doneAt: 1 };
}
function entry(over: Partial<JournalEntry>): JournalEntry {
  return { id: 'j1', date: '2026-10-27', note: '', noteDoc: null, mood: null, createdAt: 1, updatedAt: 1, ...over };
}

const TODAY = '2026-10-27'; // a Tuesday

describe('deriveTv', () => {
  it('sorts the due list by date, then priority, then time', () => {
    const a = task({ dueDate: TODAY, priority: 3, dueTime: '09:00', title: 'late low' });
    const b = task({ dueDate: TODAY, priority: 1, dueTime: '18:00', title: 'high' });
    const c = task({ dueDate: '2026-10-26', priority: 3, title: 'older' });
    const d = task({ dueDate: TODAY, priority: 1, dueTime: '08:00', title: 'high early' });
    const tv = deriveTv([a, b, c, d], [], [], [], TODAY);
    expect(tv.dueToday.map((t) => t.title)).toEqual(['older', 'high early', 'high', 'late low']);
  });

  it('picks the top task by priority, then earliest due', () => {
    const low = task({ dueDate: '2026-10-25', priority: 3, title: 'older but low' });
    const high = task({ dueDate: TODAY, priority: 1, title: 'high' });
    const tv = deriveTv([low, high], [], [], [], TODAY);
    expect(tv.topTask?.title).toBe('high');
  });

  it('excludes future-dated tasks from the due list', () => {
    const future = task({ dueDate: '2026-10-28' });
    const tv = deriveTv([future], [], [], [], TODAY);
    expect(tv.dueToday).toHaveLength(0);
    expect(tv.topTask).toBeNull();
  });

  it('excludes completed and subtasks', () => {
    const done = task({ dueDate: TODAY, status: 'done' });
    const child = task({ dueDate: TODAY, parentId: 't1' });
    const tv = deriveTv([done, child], [], [], [], TODAY);
    expect(tv.dueToday).toHaveLength(0);
  });

  it('marks the top task overdue only when its date is before today', () => {
    const overdue = task({ dueDate: '2026-10-20', priority: 1 });
    const todayTask = task({ dueDate: TODAY, priority: 1 });
    expect(deriveTv([overdue], [], [], [], TODAY).topTaskOverdueSince).toBe('2026-10-20');
    expect(deriveTv([todayTask], [], [], [], TODAY).topTaskOverdueSince).toBeNull();
  });

  it('filters habits by weekday schedule and archived state', () => {
    const everyday = habit({ name: 'everyday' });
    const tueOnly = habit({ name: 'tue only', weekdays: [2] });
    const monOnly = habit({ name: 'mon only', weekdays: [1] });
    const archived = habit({ name: 'archived', archived: true });
    const tv = deriveTv([], [everyday, tueOnly, monOnly, archived], [], [], TODAY);
    expect(tv.habitsToday.map((r) => r.habit.name)).toEqual(['everyday', 'tue only']);
  });

  it('counts done habits and computes the percentage', () => {
    const h1 = habit({ name: 'a' });
    const h2 = habit({ name: 'b' });
    const tv = deriveTv([], [h1, h2], [log(h1.id, TODAY)], [], TODAY);
    expect(tv.habitsDone).toBe(1);
    expect(tv.habitsTotal).toBe(2);
    expect(tv.habitPct).toBe(50);
    expect(tv.habitsToday.find((r) => r.habit.id === h1.id)?.done).toBe(true);
  });

  it('returns null percentages when nothing is scheduled', () => {
    const tv = deriveTv([], [], [], [], TODAY);
    expect(tv.habitPct).toBeNull();
    expect(tv.weekPct).toBeNull();
    expect(tv.topTask).toBeNull();
  });

  it('counts scheduled check-ins over the last 7 days', () => {
    const everyday = habit({ name: 'a' });
    const tueOnly = habit({ name: 'b', weekdays: [2] });
    // last 7 days (Wed 21 .. Tue 27) contain exactly one Tuesday
    const logs = [log(everyday.id, TODAY), log(tueOnly.id, TODAY), log(everyday.id, '2026-10-26')];
    const tv = deriveTv([], [everyday, tueOnly], logs, [], TODAY);
    expect(tv.weekScheduled).toBe(8); // 7 everyday + 1 tuesday
    expect(tv.weekDone).toBe(3);
    expect(tv.weekPct).toBe(38);
  });

  it('enriches tasks with project information and overdue day counts', () => {
    const p1: Project = { id: 'p1', name: 'Work', color: '#2563eb', order: 1, archived: false, parentId: null };
    const tOverdue = task({ dueDate: '2026-10-25', priority: 1, projectId: 'p1', title: 'Overdue Project Task' });
    const tToday = task({ dueDate: TODAY, priority: 2, projectId: 'inbox', title: 'Inbox Task' });
    const tv = deriveTv([tOverdue, tToday], [], [], [], TODAY, { projects: [p1] });

    expect(tv.topTaskProject).toEqual({ id: 'p1', name: 'Work', color: '#2563eb' });
    expect(tv.dueTaskItems).toHaveLength(2);
    expect(tv.dueTaskItems[0].project).toEqual({ id: 'p1', name: 'Work', color: '#2563eb' });
    expect(tv.dueTaskItems[0].overdueDays).toBe(2);
    expect(tv.dueTaskItems[1].project).toBeNull();
    expect(tv.dueTaskItems[1].overdueDays).toBe(0);
  });

  it('derives running focus session and today focus totals', () => {
    const t1 = task({ id: 't-focus', title: 'Focusing Task' });
    const now = new Date('2026-10-27T14:30:00Z');
    const nowMs = now.getTime();
    const session: FocusSession = {
      id: 'fs-1',
      taskId: 't-focus',
      startedAt: nowMs - 120000, // 2 minutes ago
      endedAt: null,
      seconds: 0,
    };
    const tv = deriveTv([t1], [], [], [], TODAY, {
      focusSessions: [session],
      now,
    });
    expect(tv.focus.runningTaskId).toBe('t-focus');
    expect(tv.focus.runningTaskTitle).toBe('Focusing Task');
    expect(tv.focus.runningSeconds).toBe(120);
    expect(tv.focus.todaySeconds).toBeGreaterThanOrEqual(120);
  });

  it('includes active goals up to 4 items sorted by order', () => {
    const g1: Goal = { id: 'g1', title: 'Goal 1', note: '', targetDate: '2026-12-31', status: 'active', order: 1, createdAt: 1, updatedAt: 1 };
    const g2: Goal = { id: 'g2', title: 'Goal 2', note: '', targetDate: null, status: 'active', order: 0, createdAt: 2, updatedAt: 2 };
    const gArchived: Goal = { id: 'g3', title: 'Old Goal', note: '', targetDate: null, status: 'archived', order: 2, createdAt: 3, updatedAt: 3 };
    const tv = deriveTv([], [], [], [], TODAY, { goals: [g1, g2, gArchived] });

    expect(tv.activeGoals).toEqual([
      { id: 'g2', title: 'Goal 2', targetDate: null },
      { id: 'g1', title: 'Goal 1', targetDate: '2026-12-31' },
    ]);
  });

  it('counts tasks completed today', () => {
    const nowMs = new Date('2026-10-27T10:00:00').getTime();
    const doneToday = task({ status: 'done', completedAt: nowMs });
    const doneYesterday = task({ status: 'done', completedAt: nowMs - 86400000 });
    const active = task({ status: 'active' });
    const tv = deriveTv([doneToday, doneYesterday, active], [], [], [], TODAY);
    expect(tv.completedTodayCount).toBe(1);
  });
});

describe('deriveGreeting', () => {
  it('returns appropriate greetings for time of day', () => {
    expect(deriveGreeting(new Date('2026-10-27T08:00:00'))).toBe('Good morning');
    expect(deriveGreeting(new Date('2026-10-27T13:00:00'))).toBe('Good afternoon');
    expect(deriveGreeting(new Date('2026-10-27T19:00:00'))).toBe('Good evening');
    expect(deriveGreeting(new Date('2026-10-27T23:30:00'))).toBe('Good night');
  });
});

describe('isTvEnabled & setTvEnabled', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    globalThis.localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
    if (typeof globalThis.window === 'undefined') {
      const listeners = new Map<string, Array<() => void>>();
      (globalThis as unknown as { window: unknown }).window = {
        addEventListener: (event: string, cb: () => void) => {
          listeners.set(event, [...(listeners.get(event) ?? []), cb]);
        },
        removeEventListener: (event: string, cb: () => void) => {
          listeners.set(event, (listeners.get(event) ?? []).filter((l) => l !== cb));
        },
        dispatchEvent: (event: { type: string }) => {
          (listeners.get(event.type) ?? []).forEach((cb) => cb());
          return true;
        },
      };
    }
  });

  it('defaults to false when no key is set', () => {
    expect(isTvEnabled()).toBe(false);
  });

  it('persists enabled state and dispatches event', () => {
    let fired = false;
    const listener = () => { fired = true; };
    window.addEventListener(TV_PREFERENCE_CHANGED_EVENT, listener);

    setTvEnabled(true);
    expect(isTvEnabled()).toBe(true);
    expect(localStorage.getItem(TV_ENABLED_KEY)).toBe('1');
    expect(fired).toBe(true);

    fired = false;
    setTvEnabled(false);
    expect(isTvEnabled()).toBe(false);
    expect(localStorage.getItem(TV_ENABLED_KEY)).toBeNull();
    expect(fired).toBe(true);

    window.removeEventListener(TV_PREFERENCE_CHANGED_EVENT, listener);
  });
});

describe('deriveHighlight', () => {
  it('trims and returns the highlight', () => {
    expect(deriveHighlight(entry({ highlight: '  shipped it  ' }))).toBe('shipped it');
  });
  it('returns null for empty, whitespace, missing, or no entry', () => {
    expect(deriveHighlight(entry({ highlight: '' }))).toBeNull();
    expect(deriveHighlight(entry({ highlight: '   ' }))).toBeNull();
    expect(deriveHighlight(entry({}))).toBeNull();
    expect(deriveHighlight(null)).toBeNull();
    expect(deriveHighlight(undefined)).toBeNull();
  });
});

// Baselines pinning existing suggestedTask behavior.
describe('suggestedTask baselines', () => {
  it('prefers overdue over due-today', () => {
    const over = task({ dueDate: '2026-10-20', title: 'overdue' });
    const todayT = task({ dueDate: TODAY, title: 'today' });
    expect(suggestedTask([todayT, over], TODAY)?.task.title).toBe('overdue');
    expect(suggestedTask([todayT, over], TODAY)?.reason).toBe('Overdue');
  });
  it('breaks ties by priority, then time, then age', () => {
    const a = task({ dueDate: TODAY, priority: 2, dueTime: '09:00', title: 'p2 early' });
    const b = task({ dueDate: TODAY, priority: 1, title: 'p1' });
    expect(suggestedTask([a, b], TODAY)?.task.title).toBe('p1');
    const c = task({ dueDate: TODAY, priority: 1, dueTime: '07:00', title: 'p1 7am' });
    const d = task({ dueDate: TODAY, priority: 1, dueTime: '08:00', title: 'p1 8am' });
    expect(suggestedTask([d, c], TODAY)?.task.title).toBe('p1 7am');
  });
  it('excludes blocked tasks and subtasks', () => {
    const blocker = task({ title: 'blocker' });
    const blocked = task({ dueDate: TODAY, priority: 1, blockedBy: [blocker.id], title: 'blocked' });
    const child = task({ dueDate: TODAY, priority: 1, parentId: blocker.id, title: 'child' });
    expect(suggestedTask([blocker, blocked, child], TODAY)).toBeNull();
  });
  it('returns null when nothing is due', () => {
    const future = task({ dueDate: '2026-11-01' });
    const undated = task({ title: 'someday' });
    expect(suggestedTask([future, undated], TODAY)).toBeNull();
  });
  it('labels a plain due-today pick honestly', () => {
    const plain = task({ dueDate: TODAY, title: 'plain' });
    const timedP1 = task({ dueDate: TODAY, dueTime: '17:30', priority: 1, title: 'timed p1' });
    const timedP2 = task({ dueDate: TODAY, dueTime: '17:30', priority: 2, title: 'timed p2' });
    expect(suggestedTask([plain], TODAY)?.reason).toBe('Due today');
    expect(suggestedTask([timedP1], TODAY)?.reason).toBe('Top priority');
    expect(suggestedTask([timedP2], TODAY)?.reason).toBe('Due 17:30');
  });
  it('ignores completed tasks', () => {
    const done = task({ dueDate: TODAY, status: 'done' });
    expect(suggestedTask([done], TODAY)).toBeNull();
  });
});
