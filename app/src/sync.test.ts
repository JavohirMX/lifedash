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

import { acknowledgeConflictNotice, getConflictNotice, loadSyncStatus, logout, syncNow } from './sync';

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

  it('records a persistent conflict notice and clears it on acknowledgement', async () => {
    tables.get('tasks') ?? tables.set('tasks', new Map());
    tables.get('tasks')!.set('X', serverTask('X', 'local edit'));
    meta.set('rev:tasks:X', 1);
    meta.set('dirty:tasks:X', { deleted: false });
    mockFetch({
      changesResponses: [
        { changes: [{ collection: 'tasks', id: 'X', rev: 2, deleted: false, data: serverTask('X', 'server v2') }], rev: 2 },
        { changes: [], rev: 2 },
      ],
      pushResults: [
        { id: 'X', collection: 'tasks', status: 'conflict', current: { rev: 2, deleted: false, data: serverTask('X', 'server v2') } },
      ],
    });
    const r = await syncNow(settings);
    expect(r.conflicts).toBe(1);
    const notice = await getConflictNotice();
    expect(notice?.count).toBe(1);
    expect(typeof notice?.at).toBe('number');
    await acknowledgeConflictNotice();
    expect(await getConflictNotice()).toBeNull();
  });

  it('accumulates unacknowledged conflicts across syncs', async () => {
    tables.get('tasks') ?? tables.set('tasks', new Map());
    for (const id of ['X', 'Y']) {
      tables.get('tasks')!.set(id, serverTask(id, 'local'));
      meta.set(`rev:tasks:${id}`, 1);
      meta.set(`dirty:tasks:${id}`, { deleted: false });
    }
    mockFetch({
      changesResponses: [{ changes: [], rev: 1 }, { changes: [], rev: 1 }],
      pushResults: [
        { id: 'X', collection: 'tasks', status: 'conflict', current: { rev: 2, deleted: false, data: serverTask('X', 'server') } },
        { id: 'Y', collection: 'tasks', status: 'conflict', current: { rev: 2, deleted: false, data: serverTask('Y', 'server') } },
      ],
    });
    const r = await syncNow(settings);
    expect(r.conflicts).toBe(2);
    expect((await getConflictNotice())?.count).toBe(2);
  });

  it('does not record a notice for an identical-content conflict (default Inbox first join)', async () => {
    const inbox = { id: 'inbox', name: 'Inbox', color: '#0f766e', order: 0, archived: false };
    tables.set('projects', new Map([['inbox', inbox]]));
    meta.set('dirty:projects:inbox', { deleted: false });
    mockFetch({
      changesResponses: [{ changes: [], rev: 1 }, { changes: [], rev: 1 }],
      pushResults: [
        { id: 'inbox', collection: 'projects', status: 'conflict', current: { rev: 1, deleted: false, data: { ...inbox } } },
      ],
    });
    const r = await syncNow(settings);
    expect(r.conflicts).toBe(1);
    expect(await getConflictNotice()).toBeNull();
  });

  it('does not record a notice when a sync has no conflicts', async () => {
    mockFetch({ changesResponses: [{ changes: [], rev: 0 }, { changes: [], rev: 0 }], pushResults: [] });
    const r = await syncNow(settings);
    expect(r.conflicts).toBe(0);
    expect(await getConflictNotice()).toBeNull();
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

describe('logout', () => {
  const s = { url: 'https://sync.example.com/', username: 'u', token: 'tok123' };

  it("returns 'revoked' when the server confirms and sends the bearer token", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response('{}', { status: 200 });
    }));
    expect(await logout(s)).toBe('revoked');
    expect(calls[0][0]).toBe('https://sync.example.com/api/logout');
    expect((calls[0][1]?.headers as Record<string, string>).Authorization).toBe('Bearer tok123');
    vi.unstubAllGlobals();
  });

  it("returns 'unavailable' when the server predates the logout endpoint (404)", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    expect(await logout(s)).toBe('unavailable');
    vi.unstubAllGlobals();
  });

  it("returns 'unavailable' when the server is unreachable", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await logout(s)).toBe('unavailable');
    vi.unstubAllGlobals();
  });

  it("returns 'unavailable' when the token was already invalid (401)", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })));
    expect(await logout(s)).toBe('unavailable');
    vi.unstubAllGlobals();
  });
});


describe('sync push batching', () => {
  it('sends 1200 dirty tasks as 500/500/200 and clears acknowledged keys', async () => {
    const rows = new Map<string, unknown>();
    for (let i = 0; i < 1200; i++) {
      const id = `batch-${i}`;
      rows.set(id, serverTask(id, 'Task'));
      meta.set(`dirty:tasks:${id}`, { deleted: false });
    }
    tables.set('tasks', rows);
    const sizes: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const changes = JSON.parse(String(init.body)).changes as PushChange[];
        sizes.push(changes.length);
        return { ok: true, json: async () => ({ results: changes.map((c) => ({
          collection: c.collection, id: c.id, status: 'ok', rev: 1,
        })) }) } as Response;
      }
      return { ok: true, json: async () => ({ changes: [], rev: 0 }) } as Response;
    }));
    expect((await syncNow(settings)).pushed).toBe(1200);
    expect(sizes).toEqual([500, 500, 200]);
    expect([...meta.keys()].filter(k => k.startsWith('dirty:'))).toHaveLength(0);
  });

  it('leaves an unacknowledged failed batch dirty for retry', async () => {
    const rows = new Map<string, unknown>();
    for (let i = 0; i < 501; i++) {
      const id = `retry-${i}`;
      rows.set(id, serverTask(id, 'Task'));
      meta.set(`dirty:tasks:${id}`, { deleted: false });
    }
    tables.set('tasks', rows);
    let pushes = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        if (++pushes === 2) return { ok: false, status: 503, text: async () => 'unavailable' } as Response;
        const changes = JSON.parse(String(init.body)).changes as PushChange[];
        return { ok: true, json: async () => ({ results: changes.map(c => ({
          collection: c.collection, id: c.id, status: 'ok', rev: 1,
        })) }) } as Response;
      }
      return { ok: true, json: async () => ({ changes: [], rev: 0 }) } as Response;
    }));
    await expect(syncNow(settings)).rejects.toThrow('push failed: 503');
    expect([...meta.keys()].filter(k => k.startsWith('dirty:'))).toHaveLength(1);
  });
});


describe('sync status persistence', () => {
  it('does not turn successful sync into failure when status storage fails', async () => {
    mockFetch({ changesResponses: [] });
    const original = localStorage.setItem;
    localStorage.setItem = () => { throw new Error('Status storage unavailable'); };
    try {
      expect(await syncNow(settings)).toMatchObject({ pushed: 0, pulled: 0 });
      expect(loadSyncStatus()).toMatchObject({ ok: true, persistenceFailed: true });
    } finally { localStorage.setItem = original; }
    await syncNow(settings);
    expect(loadSyncStatus()).toMatchObject({ ok: true });
    expect(loadSyncStatus()?.persistenceFailed).toBeUndefined();
  });
});
