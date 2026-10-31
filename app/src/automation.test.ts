import { describe, expect, it } from 'vitest';
import { exportAutomation, restoreAutomation, saveRules, loadRules, rolloverTargets, shouldCompleteParent, loadUserRules, saveUserRules, tagRulesFor, weeklyRulesDue, hasOpenTitle, describeUserRule, type UserRule } from './automation';
import type { Task } from './types';

const base: Task = {
  id: 'a', title: 'A', note: '', noteDoc: null, status: 'active', pinned: false,
  priority: 0,
  projectId: 'inbox', dueDate: null, dueTime: null, recurrence: null,
  parentId: null, goalId: null, noteId: null, seriesId: null, order: 0, blockedBy: [], tags: [],
  createdAt: 0, updatedAt: 0, completedAt: null,
};
const t = (patch: Partial<Task>): Task => ({ ...base, ...patch });

describe('rolloverTargets', () => {
  it('picks only active tasks due before today', () => {
    const tasks = [
      t({ id: 'overdue', dueDate: '2026-10-19' }),
      t({ id: 'today', dueDate: '2026-10-20' }),
      t({ id: 'future', dueDate: '2026-10-21' }),
      t({ id: 'noDate' }),
      t({ id: 'doneOverdue', dueDate: '2026-10-19', status: 'done' }),
    ];
    expect(rolloverTargets(tasks, '2026-10-20')).toEqual(['overdue']);
  });
});

describe('shouldCompleteParent', () => {
  const parent = t({ id: 'p' });
  it('is true when all subtasks are done', () => {
    const tasks = [parent, t({ id: 'c1', parentId: 'p', status: 'done' }), t({ id: 'c2', parentId: 'p', status: 'done' })];
    expect(shouldCompleteParent(tasks, 'p')).toBe(true);
  });
  it('is false while any subtask is open', () => {
    const tasks = [parent, t({ id: 'c1', parentId: 'p', status: 'done' }), t({ id: 'c2', parentId: 'p' })];
    expect(shouldCompleteParent(tasks, 'p')).toBe(false);
  });
  it('is false when the parent is already done or has no subtasks', () => {
    expect(shouldCompleteParent([{ ...parent, status: 'done' }, t({ id: 'c', parentId: 'p', status: 'done' })], 'p')).toBe(false);
    expect(shouldCompleteParent([parent], 'p')).toBe(false);
  });
});

// Node test env has no localStorage; shim it for the user-rule store.
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  get length() { return store.size; },
} as Storage;

const rule = (patch: Partial<UserRule>): UserRule => ({
  id: 'r1', trigger: { kind: 'tag', tag: 'x' }, title: 'Do the thing',
  createdAt: 1, lastFired: null, ...patch,
});

describe('user rules store', () => {
  it('round-trips and defaults to empty', () => {
    store.clear();
    expect(loadUserRules()).toEqual([]);
    const rules = [rule({})];
    saveUserRules(rules);
    expect(loadUserRules()).toEqual(rules);
  });
});

describe('tagRulesFor', () => {
  it('matches only tag rules whose tag the completed task carries', () => {
    const rules = [rule({ id: 'a' }), rule({ id: 'b', trigger: { kind: 'tag', tag: 'y' } }), rule({ id: 'c', trigger: { kind: 'weekly', weekday: 2 } })];
    expect(tagRulesFor(rules, t({ tags: ['x'] })).map((r) => r.id)).toEqual(['a']);
  });
});

describe('weeklyRulesDue', () => {
  it('fires on the matching weekday once per day, stamped or not', () => {
    const rules = [
      rule({ id: 'a', trigger: { kind: 'weekly', weekday: 2 } }),
      rule({ id: 'b', trigger: { kind: 'weekly', weekday: 2 }, lastFired: '2026-10-20' }),
      rule({ id: 'c', trigger: { kind: 'weekly', weekday: 3 } }),
    ];
    expect(weeklyRulesDue(rules, '2026-10-20', 2).map((r) => r.id)).toEqual(['a']);
  });
});

describe('hasOpenTitle', () => {
  it('blocks on an active same-title task (case/trim-insensitive), not a done one', () => {
    expect(hasOpenTitle([t({ title: '  do THE Thing ' })], 'Do the thing')).toBe(true);
    expect(hasOpenTitle([t({ title: 'Do the thing', status: 'done' })], 'Do the thing')).toBe(false);
  });
});

describe('describeUserRule', () => {
  it('states the honest app-open behavior', () => {
    expect(describeUserRule(rule({ trigger: { kind: 'weekly', weekday: 3 } }))).toBe('Every Wednesday when you open Lifedash');
    expect(describeUserRule(rule({ trigger: { kind: 'tag', tag: 'home' } }))).toBe('When a #home task completes');
  });
});


describe('automation backups', () => {
  it('roundtrips toggles and rule definitions with stamps', () => {
    saveRules({ rollover: true, completeParent: false });
    const rule: UserRule = { id: 'backup-rule', title: 'Review', createdAt: 1, lastFired: '2026-10-27', trigger: { kind: 'weekly', weekday: 2 } };
    saveUserRules([rule]);
    const block = JSON.parse(JSON.stringify(exportAutomation()));
    saveRules({ rollover: false, completeParent: false }); saveUserRules([]);
    restoreAutomation(block);
    expect(loadRules().rollover).toBe(true);expect(loadUserRules()).toEqual([rule]);
  });
  it('leaves device rules unchanged for absent or malformed blocks', () => {
    saveRules({ rollover: false, completeParent: true });
    const before = exportAutomation();
    for (const v of [undefined, null, [], 'bad', {rules: 'bad', userRules: 'bad'}]) restoreAutomation(v);
    expect(exportAutomation()).toEqual(before);
  });
  it('drops invalid rows individually', () => {
    const good: UserRule = { id: 'ok', title: 'Review', createdAt: 1, lastFired: null, trigger: { kind: 'tag', tag: 'done' } };
    restoreAutomation({ userRules: [good, null, {}, {...good, trigger: {kind: 'weekly', weekday: 8}}] });
    expect(loadUserRules()).toEqual([good]);
  });
  it('keeps valid optional action fields on restore', () => {
    const rule: UserRule = { id: 'a', title: 'Review', createdAt: 1, lastFired: null, trigger: { kind: 'weekly', weekday: 1 }, projectId: 'p1', pinned: true };
    restoreAutomation({ userRules: [rule] });
    expect(loadUserRules()).toEqual([rule]);
  });
  it('sanitizes malformed optional action fields instead of dropping the rule', () => {
    const base: UserRule = { id: 'a', title: 'Review', createdAt: 1, lastFired: null, trigger: { kind: 'tag', tag: 'done' } };
    restoreAutomation({ userRules: [
      { ...base, id: 'num-proj', projectId: 42 as unknown as string, pinned: 'yes' as unknown as boolean },
      { ...base, id: 'blank-proj', projectId: '   ' },
    ] });
    const restored = loadUserRules();
    expect(restored.map((r) => r.id).sort()).toEqual(['blank-proj', 'num-proj']);
    expect(restored.every((r) => r.projectId === undefined && r.pinned === undefined)).toBe(true);
  });
});
