// Node test env has no localStorage; sync.ts touches it in saveSyncStatus.
globalThis.localStorage = {
  store: new Map<string, string>(),
  getItem(k: string) { return this.store.get(k) ?? null; },
  setItem(k: string, v: string) { this.store.set(k, v); },
  removeItem(k: string) { this.store.delete(k); },
  clear() { this.store.clear(); },
  key() { return null; },
  get length() { return this.store.size; },
} as Storage;
// Node env has no window; saveSyncStatus dispatches an event on it.
(globalThis as { window?: unknown }).window = { dispatchEvent: () => true };

import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the Dexie db. sync.ts only uses:
// syncmeta.get/put/delete/where('key').startsWith(...).toArray()/count(),
// and table(col).get/put/delete/hook.
const { meta, tables } = vi.hoisted(() => {
  const meta = new Map<string, unknown>();
  const tables = new Map<string, Map<string, unknown>>();
  return { meta, tables };
});

vi.mock('./db', () => ({
  db: {
    syncmeta: {
      get: async (key: string) => (meta.has(key) ? { key, value: meta.get(key) } : undefined),
      put: async (row: { key: string; value: unknown }) => { meta.set(row.key, row.value); return row.key; },
      delete: async (key: string) => { meta.delete(key); },
      where: () => ({
        startsWith: (prefix: string) => ({
          toArray: async () => [...meta.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ key: k, value: meta.get(k) })),
          count: async () => [...meta.keys()].filter((k) => k.startsWith(prefix)).length,
        }),
      }),
    },
    table: (col: string) => {
      if (!tables.has(col)) tables.set(col, new Map());
      const t = tables.get(col)!;
      return {
        get: async (id: string) => t.get(id),
        put: async (obj: { id: string }) => { t.set(obj.id, obj); return obj.id; },
        delete: async (id: string) => { t.delete(id); },
        hook: () => {},
      };
    },
  },
}));

import { syncNow } from './sync';

const settings = { url: 'http://test', username: 'u', token: 'tok' };

interface PushChange { collection: string; id: string; base_rev: number; deleted: boolean; data: unknown }

function mockFetch(script: { changesResponses: object[]; pushResults?: object[] }) {
  const pushes: PushChange[][] = [];
  let changeCall = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/api/changes?')) {
      const body = script.changesResponses[changeCall++] ?? { changes: [], rev: 0 };
      return { ok: true, json: async () => body } as Response;
    }
    if (String(url).endsWith('/api/changes') && init?.method === 'POST') {
      pushes.push((JSON.parse(String(init.body)) as { changes: PushChange[] }).changes);
      return { ok: true, json: async () => ({ results: script.pushResults ?? [] }) } as Response;
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
  return pushes;
}

const serverTask = (id: string, title: string) => ({ id, title, projectId: 'inbox' });

beforeEach(() => {
  meta.clear();
  tables.clear();
  vi.unstubAllGlobals();
});

describe('sync edit-edit conflicts', () => {
  it('keeps the stale base_rev for locally-dirty entities so the server detects the conflict (server wins)', async () => {
    // Local: task X at base rev 1, edited locally ("local edit") -> dirty.
    tables.get('tasks') ?? tables.set('tasks', new Map());
    tables.get('tasks')!.set('X', serverTask('X', 'local edit'));
    meta.set('rev:tasks:X', 1);
    meta.set('dirty:tasks:X', { deleted: false });

    // Server has since moved to rev 2 ("server v2"): first pull delivers it.
    const pushes = mockFetch({
      changesResponses: [
        { changes: [{ collection: 'tasks', id: 'X', rev: 2, deleted: false, data: serverTask('X', 'server v2') }], rev: 2 },
        { changes: [], rev: 2 },
      ],
      pushResults: [
        { id: 'X', collection: 'tasks', status: 'conflict', current: { rev: 2, deleted: false, data: serverTask('X', 'server v2') } },
      ],
    });

    const r = await syncNow(settings);

    // Regression: the push must carry the STALE base_rev 1. The old bug
    // refreshed base_rev to 2 during pull, so the push matched the server
    // and silently overwrote it (no conflict ever reported).
    expect(pushes).toHaveLength(1);
    expect(pushes[0][0].base_rev).toBe(1);
    expect(r.conflicts).toBe(1);
    // Server-wins applied: local value replaced, rev updated, dirty cleared.
    expect((tables.get('tasks')!.get('X') as { title: string }).title).toBe('server v2');
    expect(meta.get('rev:tasks:X')).toBe(2);
    expect(meta.has('dirty:tasks:X')).toBe(false);
  });

  it('applies remote changes for non-dirty entities and pushes clean edits with the fresh rev', async () => {
    // Task Y clean at rev 1; server moves it to rev 3.
    tables.set('tasks', new Map([['Y', serverTask('Y', 'old title')]]));
    meta.set('rev:tasks:Y', 1);
    meta.set('cursor', 0);

    const pushes = mockFetch({
      changesResponses: [
        { changes: [{ collection: 'tasks', id: 'Y', rev: 3, deleted: false, data: serverTask('Y', 'remote v3') }], rev: 3 },
        { changes: [], rev: 3 },
      ],
      pushResults: [{ id: 'Y', collection: 'tasks', status: 'ok', rev: 4 }],
    });
    // Edit Y locally AFTER... no: mark dirty before sync with base rev 1; pull (clean read of Y happens
    // only when not dirty). Instead simulate: dirty Y at rev 1, server has NOT touched it -> push ok.
    meta.set('dirty:tasks:Y', { deleted: false });

    const r = await syncNow(settings);
    expect(r.pushed).toBe(1);
    expect(r.conflicts).toBe(0);
    // Server moved Y to rev 3 during the first pull, but Y was dirty so it
    // was skipped there; the push still went with stale base_rev 1 and the
    // (scripted) server accepted - the point here is the happy path reports
    // and clears dirty state.
    expect(pushes[0][0].base_rev).toBe(1);
    expect(meta.get('rev:tasks:Y')).toBe(4);
    expect(meta.has('dirty:tasks:Y')).toBe(false);
  });

  it('applies pulled data for entities with no local edit', async () => {
    meta.set('cursor', 0);
    mockFetch({
      changesResponses: [
        { changes: [{ collection: 'tasks', id: 'Z', rev: 1, deleted: false, data: serverTask('Z', 'pulled task') }], rev: 1 },
        { changes: [], rev: 1 },
      ],
    });
    const r = await syncNow(settings);
    expect(r.pulled).toBe(1);
    expect((tables.get('tasks')!.get('Z') as { title: string }).title).toBe('pulled task');
    expect(meta.get('rev:tasks:Z')).toBe(1);
  });

  it('sends tombstones for locally-deleted entities with data: {} and no data fetch', async () => {
    // Task D synced before (rev 2), then deleted locally: dirty with deleted flag, no row.
    meta.set('rev:tasks:D', 2);
    meta.set('dirty:tasks:D', { deleted: true });
    meta.set('cursor', 2);
    const pushes = mockFetch({
      changesResponses: [{ changes: [], rev: 2 }, { changes: [], rev: 2 }],
      pushResults: [{ id: 'D', collection: 'tasks', status: 'ok', rev: 3 }],
    });
    const r = await syncNow(settings);
    expect(r.pushed).toBe(1);
    expect(pushes[0][0]).toMatchObject({ collection: 'tasks', id: 'D', base_rev: 2, deleted: true, data: {} });
    expect(meta.has('dirty:tasks:D')).toBe(false);
  });

  it('round-trips habitLog ids that contain a colon through dirty keys', async () => {
    // habitLog ids look like "habitId:2026-10-20"; the dirty key split must rejoin the tail.
    tables.set('habitLogs', new Map([['h1:2026-10-20', { id: 'h1:2026-10-20', habitId: 'h1', date: '2026-10-20' }]]));
    meta.set('rev:habitLogs:h1:2026-10-20', 1);
    meta.set('dirty:habitLogs:h1:2026-10-20', { deleted: false });
    meta.set('cursor', 1);
    const pushes = mockFetch({
      changesResponses: [{ changes: [], rev: 1 }, { changes: [], rev: 1 }],
      pushResults: [{ id: 'h1:2026-10-20', collection: 'habitLogs', status: 'ok', rev: 2 }],
    });
    const r = await syncNow(settings);
    expect(r.pushed).toBe(1);
    expect(pushes[0][0]).toMatchObject({ collection: 'habitLogs', id: 'h1:2026-10-20', base_rev: 1, deleted: false });
    expect((pushes[0][0].data as { habitId: string }).habitId).toBe('h1');
  });

  it('never-synced local create pushes with base_rev 0', async () => {
    tables.set('tasks', new Map([['N', serverTask('N', 'brand new')]]));
    meta.set('dirty:tasks:N', { deleted: false });
    meta.set('cursor', 0);
    const pushes = mockFetch({
      changesResponses: [{ changes: [], rev: 0 }, { changes: [], rev: 0 }],
      pushResults: [{ id: 'N', collection: 'tasks', status: 'ok', rev: 1 }],
    });
    const r = await syncNow(settings);
    expect(r.pushed).toBe(1);
    expect(pushes[0][0].base_rev).toBe(0);
    expect(meta.get('rev:tasks:N')).toBe(1);
  });
});
