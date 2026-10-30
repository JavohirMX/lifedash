import { describe, expect, it } from 'vitest';
import { deriveHighlight, deriveTv } from './tv';
import { suggestedTask } from './logic';
import type { Habit, HabitLog, JournalEntry, Task } from './types';

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
