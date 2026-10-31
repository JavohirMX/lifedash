import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hydrateAutomation, refreshAutomationFromSync, loadRules, loadUserRules, saveRules, saveUserRules,
  AUTOMATION_CHANGED_EVENT, type UserRule,
} from './automation';

// In-memory stand-in for the two automation Dexie tables.
const { tables } = vi.hoisted(() => {
  const tables = {
    automationRules: new Map<string, Record<string, unknown>>(),
    userRules: new Map<string, Record<string, unknown>>(),
  };
  return { tables };
});

vi.mock('./db', () => ({
  db: {
    automationRules: {
      get: async (id: string) => tables.automationRules.get(id),
      put: async (row: { id: string }) => { tables.automationRules.set(row.id, row); return row.id; },
    },
    userRules: {
      toArray: async () => [...tables.userRules.values()],
      clear: async () => tables.userRules.clear(),
      delete: async (id: string) => tables.userRules.delete(id),
      bulkPut: async (rows: { id: string }[]) => { for (const r of rows) tables.userRules.set(r.id, r); },
    },
  },
}));

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  get length() { return store.size; },
} as Storage;

// Minimal window/Event shim for the node test env.
const listeners = new Map<string, Set<(e: { type: string }) => void>>();
globalThis.CustomEvent = class {
  constructor(public type: string) {}
} as unknown as typeof CustomEvent;
globalThis.window = {
  addEventListener: (t: string, f: (e: { type: string }) => void) => {
    if (!listeners.has(t)) listeners.set(t, new Set());
    listeners.get(t)!.add(f);
  },
  removeEventListener: (t: string, f: (e: { type: string }) => void) => listeners.get(t)?.delete(f),
  dispatchEvent: (e: { type: string }) => { listeners.get(e.type)?.forEach((f) => f(e)); return true; },
} as unknown as Window & typeof globalThis;

const rule = (patch: Partial<UserRule>): UserRule => ({
  id: 'r1', trigger: { kind: 'tag', tag: 'gym' }, title: 'Log workout',
  createdAt: 1, lastFired: null, ...patch,
});

beforeEach(() => {
  store.clear();
  tables.automationRules.clear();
  tables.userRules.clear();
});

describe('hydrateAutomation', () => {
  it('migrates legacy localStorage config into Dexie on first run', async () => {
    saveRules({ rollover: true, completeParent: false });
    tables.automationRules.clear(); // simulate pre-migration install
    store.set('lifedash-user-rules', JSON.stringify([rule({})]));
    await hydrateAutomation();
    expect(tables.automationRules.get('settings')).toEqual({ id: 'settings', rollover: true, completeParent: false });
    expect(tables.userRules.get('r1')).toBeDefined();
  });

  it('adopts synced Dexie config over stale localStorage on later runs', async () => {
    store.set('lifedash-rules', JSON.stringify({ rollover: false, completeParent: false }));
    tables.automationRules.set('settings', { id: 'settings', rollover: true, completeParent: true });
    tables.userRules.set('r2', { ...rule({ id: 'r2', title: 'From other device' }) } as Record<string, unknown>);
    await hydrateAutomation();
    expect(loadRules()).toEqual({ rollover: true, completeParent: true });
    expect(loadUserRules().map((r) => r.id)).toEqual(['r2']);
  });
});

describe('refreshAutomationFromSync', () => {
  it('writes pulled rows into the localStorage cache and notifies the UI', async () => {
    tables.automationRules.set('settings', { id: 'settings', rollover: true, completeParent: false });
    tables.userRules.set('r3', { ...rule({ id: 'r3' }) } as Record<string, unknown>);
    const seen: string[] = [];
    const listener = () => seen.push('fired');
    window.addEventListener(AUTOMATION_CHANGED_EVENT, listener);
    try {
      await refreshAutomationFromSync();
    } finally {
      window.removeEventListener(AUTOMATION_CHANGED_EVENT, listener);
    }
    expect(loadRules()).toEqual({ rollover: true, completeParent: false });
    expect(loadUserRules().map((r) => r.id)).toEqual(['r3']);
    expect(seen).toEqual(['fired']);
  });

  it('a pull deleting every user rule empties the cache too', async () => {
    store.set('lifedash-user-rules', JSON.stringify([rule({})]));
    await refreshAutomationFromSync();
    expect(loadUserRules()).toEqual([]);
  });
});

describe('saveRules mirror', () => {
  it('writes through to Dexie so sync picks the change up', async () => {
    saveRules({ rollover: false, completeParent: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(tables.automationRules.get('settings')).toEqual({ id: 'settings', rollover: false, completeParent: true });
    expect(loadRules()).toEqual({ rollover: false, completeParent: true });
  });

  it('saveUserRules deletes removed rules individually to trigger delete hooks for sync', async () => {
    tables.userRules.set('r1', rule({ id: 'r1' }) as Record<string, unknown>);
    tables.userRules.set('r2', rule({ id: 'r2' }) as Record<string, unknown>);
    saveUserRules([rule({ id: 'r2' })]);
    await new Promise((r) => setTimeout(r, 0));
    expect(tables.userRules.get('r1')).toBeUndefined();
    expect(tables.userRules.get('r2')).toBeDefined();
    expect(loadUserRules().map((r) => r.id)).toEqual(['r2']);
  });
});
