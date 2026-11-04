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
// scheduleSync debounces via window timers; stub them so hook-triggered
// scheduling is a no-op in tests (dirty-mark state is what tests assert).
(globalThis as { window?: unknown }).window = { dispatchEvent: () => true, clearTimeout: () => undefined, setTimeout: () => 0 };

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the Dexie db. sync.ts only uses:
// syncmeta.get/put/delete/where('key').startsWith(...).toArray()/count(),
// and table(col).get/put/delete/hook.
const { meta, tables, hooks } = vi.hoisted(() => {
  const meta = new Map<string, unknown>();
  const tables = new Map<string, Map<string, unknown>>();
  const hooks = {} as Record<string, (...args: unknown[]) => void>;
  return { meta, tables, hooks };
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
        put: async (obj: { id: string }) => { if (obj.id === 'simulated-dexie-error') { const e = new Error('simulated DataError'); e.name = 'DataError'; throw e; } t.set(obj.id, obj); return obj.id; },
        delete: async (id: string) => { t.delete(id); },
        hook: (name: string, cb: (...args: unknown[]) => void) => { hooks[`${col}:${name}`] = cb; },
      };
    },
    attachments: {
      get: async (id: string) => tables.get('attachments')?.get(id),
      filter: (fn: (a: unknown) => boolean) => ({
        sortBy: async () => [...(tables.get('attachments')?.values() ?? [])].filter(fn),
      }),
      update: async (id: string, mods: Record<string, unknown>) => {
        const t = tables.get('attachments');
        const row = t?.get(id);
        if (t && row) t.set(id, { ...(row as object), ...mods });
      },
    },
  },
}));

import { acknowledgeConflictNotice, attachmentUploadFailures, getConflictNotice, getSyncHalt, installSyncHooks, loadSyncQuarantine, loadSyncQuarantineOverflow, loadSyncStatus, logout, promptAttachmentUploadIfTaskSynced, retryAttachmentUpload, saveSyncSettings, syncNow, uploadAttachmentBlob } from './sync';

const settings = { url: 'http://test', username: 'u', token: 'tok' };

// Node test env: localStorage shim so loadSyncSettings resolves.
const lsStore = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => (lsStore.has(k) ? lsStore.get(k)! : null),
  setItem: (k: string, v: string) => void lsStore.set(k, v),
  removeItem: (k: string) => void lsStore.delete(k),
  clear: () => lsStore.clear(),
  key: () => null,
  get length() { return lsStore.size; },
} as Storage;

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
    if (String(url).includes('/api/attachments?') && init?.method === 'POST') {
      const u = new URL(String(url));
      blobUploads.push({ id: u.searchParams.get('id'), taskId: u.searchParams.get('task_id'), size: Number(init.body ? (init.body as { size?: number }).size ?? 0 : 0) });
      return { ok: true, json: async () => ({ id: u.searchParams.get('id'), rev: 7 }) } as Response;
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
  return pushes;
}
const blobUploads: { id: string | null; taskId: string | null; size: number }[] = [];

const serverTask = (id: string, title: string) => ({ id, title, projectId: 'inbox', status: 'active', createdAt: 1700000000000, updatedAt: 1700000001000 });

beforeEach(() => {
  meta.clear();
  tables.clear();
  blobUploads.length = 0;
  lsStore.clear();
  lsStore.set('lifedash-sync', JSON.stringify(settings));
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

  it('keeps the unacknowledged conflict count in the saved status after a later no-op sync', async () => {
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
    const r1 = await syncNow(settings);
    expect(r1.conflicts).toBe(1);
    // The run that resolved the conflict reports it as this-run activity.
    expect(loadSyncStatus()?.summary).toBe('pushed 0, pulled 0, 1 conflict (server won)');

    // A later idle auto-sync (nothing dirty, nothing new) must not erase
    // awareness of the still-unacknowledged conflict from the status line,
    // and must not present it as activity of that idle run.
    mockFetch({ changesResponses: [{ changes: [], rev: 2 }, { changes: [], rev: 2 }] });
    const r2 = await syncNow(settings);
    expect(r2).toMatchObject({ pushed: 0, pulled: 0, conflicts: 0 });
    expect(loadSyncStatus()?.summary).toBe('pushed 0, pulled 0, 1 earlier conflict (server won) awaiting review');
  });

  it('distinguishes this-run conflicts from still-outstanding earlier ones in one summary', async () => {
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
    await syncNow(settings);
    // Second conflict on Y while X's notice is still unacknowledged.
    tables.get('tasks')!.set('Y', serverTask('Y', 'local edit Y'));
    meta.set('rev:tasks:Y', 2);
    meta.set('dirty:tasks:Y', { deleted: false });
    mockFetch({
      changesResponses: [{ changes: [], rev: 3 }, { changes: [], rev: 3 }],
      pushResults: [
        { id: 'Y', collection: 'tasks', status: 'conflict', current: { rev: 3, deleted: false, data: serverTask('Y', 'server v3') } },
      ],
    });
    const r2 = await syncNow(settings);
    expect(r2.conflicts).toBe(1);
    expect(loadSyncStatus()?.summary).toBe('pushed 0, pulled 0, 1 conflict (server won), 1 earlier conflict (server won) awaiting review');
  });

  it('drops the conflict count from the status once the notice is acknowledged', async () => {
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
    await syncNow(settings);
    await acknowledgeConflictNotice();
    mockFetch({ changesResponses: [{ changes: [], rev: 2 }, { changes: [], rev: 2 }] });
    await syncNow(settings);
    expect(loadSyncStatus()?.summary).toBe('pushed 0, pulled 0');
  });

  it('a failed sync replaces the stale success status with an honest failure', async () => {
    // An earlier success is on record.
    mockFetch({ changesResponses: [{ changes: [], rev: 0 }, { changes: [], rev: 0 }] });
    await syncNow(settings);
    expect(loadSyncStatus()?.ok).toBe(true);
    // The server then rejects the token: the persisted status must say so,
    // in user-safe wording, instead of keeping the stale success.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => '{"detail":"invalid token"}' }) as Response));
    await expect(syncNow(settings)).rejects.toThrow();
    const st = loadSyncStatus();
    expect(st?.ok).toBe(false);
    expect(st?.summary).toContain('sign in');
    expect(st?.summary).not.toContain('invalid token');
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

  it('metadata push precedes blob upload: backfill still delivers the bytes', async () => {
    tables.get('attachments') ?? tables.set('attachments', new Map());
    tables.get('attachments')!.set('A9', {
      id: 'A9', taskId: 't1', name: 'race.txt', mime: 'text/plain', byteSize: 5,
      blob: { size: 5, type: 'text/plain' }, createdAt: 1,
    });
    meta.set('dirty:attachments:A9', { deleted: false });

    const pushes = mockFetch({
      changesResponses: [{ changes: [], rev: 0 }, { changes: [], rev: 1 }],
      pushResults: [{ id: 'A9', collection: 'attachments', status: 'ok', rev: 1 }],
    });

    await syncNow(settings);
    expect(pushes.flat().some((c) => c.id === 'A9')).toBe(true); // metadata went first
    expect(blobUploads).toEqual([{ id: 'A9', taskId: 't1', size: 5 }]); // bytes followed
    const row = tables.get('attachments')!.get('A9') as { blobOnServer?: boolean };
    expect(row.blobOnServer).toBe(true);
    expect(meta.get('rev:attachments:A9')).toBe(7); // upload rev grounds the row
  });

  it('a permanently failing blob stops blocking the backfill queue', async () => {
    tables.get('attachments') ?? tables.set('attachments', new Map());
    tables.get('attachments')!.set('BAD', {
      id: 'BAD', taskId: 'gone', name: 'bad.txt', mime: 'text/plain', byteSize: 1,
      blob: { size: 1, type: 'text/plain' }, createdAt: 1,
    });
    tables.get('attachments')!.set('OK1', {
      id: 'OK1', taskId: 't1', name: 'ok.txt', mime: 'text/plain', byteSize: 2,
      blob: { size: 2, type: 'text/plain' }, createdAt: 2,
    });
    meta.set('blobfail:BAD', { count: 1, lastAt: Date.now(), permanent: true }); // refused for good

    mockFetch({ changesResponses: [{ changes: [], rev: 0 }, { changes: [], rev: 1 }] });
    await syncNow(settings);
    expect(blobUploads.map((u) => u.id)).toEqual(['OK1']); // BAD skipped, OK1 delivered
  });

  it('a permanent refusal expires after a day and the blob is retried', async () => {
    tables.get('attachments') ?? tables.set('attachments', new Map());
    tables.get('attachments')!.set('OLD', {
      id: 'OLD', taskId: 't1', name: 'old.txt', mime: 'text/plain', byteSize: 2,
      blob: { size: 2, type: 'text/plain' }, createdAt: 1,
    });
    // Recent permanent refusal: still skipped.
    meta.set('blobfail:OLD', { count: 1, lastAt: Date.now(), permanent: true });
    mockFetch({ changesResponses: [{ changes: [], rev: 0 }, { changes: [], rev: 1 }] });
    await syncNow(settings);
    expect(blobUploads).toEqual([]);
    // Same refusal, older than a day: retried (task may exist now, proxy healed).
    // The counter stays monotonic (rev 1 settled above): rev 0 here would
    // correctly trip the rollback guard.
    meta.set('blobfail:OLD', { count: 1, lastAt: Date.now() - 25 * 60 * 60 * 1000, permanent: true });
    mockFetch({ changesResponses: [{ changes: [], rev: 1 }, { changes: [], rev: 1 }] });
    await syncNow(settings);
    expect(blobUploads.map((u) => u.id)).toEqual(['OLD']);
    expect(meta.get('blobfail:OLD')).toBeUndefined();
  });

  it('manual sync with retryFailedUploads clears tallies and retries in the same pass', async () => {
    tables.get('attachments') ?? tables.set('attachments', new Map());
    tables.get('attachments')!.set('STUCK', {
      id: 'STUCK', taskId: 't1', name: 's.txt', mime: 'text/plain', byteSize: 2,
      blob: { size: 2, type: 'text/plain' }, createdAt: 1,
    });
    meta.set('blobfail:STUCK', { count: 3, lastAt: Date.now(), permanent: true });
    mockFetch({ changesResponses: [{ changes: [], rev: 0 }, { changes: [], rev: 1 }] });
    await syncNow(settings, { retryFailedUploads: true });
    expect(blobUploads.map((u) => u.id)).toEqual(['STUCK']);
    expect(meta.get('blobfail:STUCK')).toBeUndefined();
  });

  it('a refused manual retry re-records the failure classification so the file does not look queued', async () => {
    tables.get('attachments') ?? tables.set('attachments', new Map());
    tables.get('attachments')!.set('R1', {
      id: 'R1', taskId: 't1', name: 'empty.txt', mime: 'text/plain', byteSize: 0,
      blob: { size: 0, type: 'text/plain' }, createdAt: 1,
    });
    // Server refuses this file for good (422 empty upload).
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      // Healthy rollback-guard preflight: this test characterizes the refusal path.
      if (String(url).includes('/api/changes?')) return { ok: true, json: async () => ({ changes: [], rev: 0 }) } as Response;
      if (String(url).includes('/api/attachments?') && init?.method === 'POST') {
        return { ok: false, status: 422 } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    // Behavior fail-first through the actual manual-retry caller: removing
    // the refusal recording from retryAttachmentUpload fails this test even
    // though the recording helper still exists.
    const outcome = await retryAttachmentUpload('R1');
    expect(outcome).toBe('permanent');
    const failures = await attachmentUploadFailures();
    expect(failures['R1']?.permanent).toBe(true);
    // A further refused retry keeps the classification (the retry path
    // clears the old tally first, so the count restarts at 1 by design).
    const outcome2 = await retryAttachmentUpload('R1');
    expect(outcome2).toBe('permanent');
    const tally = meta.get('blobfail:R1') as { count: number; permanent?: boolean };
    expect(tally.count).toBe(1);
    expect(tally.permanent).toBe(true);
  });

  it('structured per-file-size 413 needs attention; quota and plain 413 stay transient', async () => {
    tables.get('attachments') ?? tables.set('attachments', new Map());
    tables.get('attachments')!.set('BIG', {
      id: 'BIG', taskId: 't1', name: 'big.bin', mime: 'application/octet-stream', byteSize: 3,
      blob: { size: 3, type: 'application/octet-stream' }, createdAt: 1,
    });
    const stub413 = (body: unknown) => vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      // Healthy rollback-guard preflight: this test characterizes the 413 classes.
      if (String(url).includes('/api/changes?')) return { ok: true, json: async () => ({ changes: [], rev: 0 }) } as Response;
      if (String(url).includes('/api/attachments?') && init?.method === 'POST') {
        return { ok: false, status: 413, json: async () => body } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    // New server: machine-readable per-file-size refusal needs attention.
    stub413({ detail: { reason: 'attachment_file_too_large', max_file_mb: 1 } });
    expect(await uploadAttachmentBlob(tables.get('attachments')!.get('BIG') as never)).toBe('permanent');
    // Old server: plain-string detail stays transient (no prose parsing).
    stub413({ detail: 'file exceeds the 1 MB per-file limit' });
    expect(await uploadAttachmentBlob(tables.get('attachments')!.get('BIG') as never)).toBe('transient');
    // Quota refusals stay transient even with the new structured shape:
    // freed space heals them without user attention on this file.
    stub413({ detail: { reason: 'attachment_quota_exceeded', quota_mb: 200 } });
    expect(await uploadAttachmentBlob(tables.get('attachments')!.get('BIG') as never)).toBe('transient');
  });

  it('saving sync settings clears stale upload-failure tallies', async () => {
    meta.set('blobfail:X1', { count: 2, lastAt: Date.now(), permanent: true });
    saveSyncSettings(settings);
    await new Promise((r) => setTimeout(r, 5));
    expect(meta.get('blobfail:X1')).toBeUndefined();
  });

  it('no sync account is unconfigured, never a failure', async () => {
    lsStore.clear();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const outcome = await uploadAttachmentBlob({ id: 'A1', taskId: 't1', name: 'f.txt', blob: new Blob(['x']) });
    expect(outcome).toBe('unconfigured');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(meta.get('blobfail:A1')).toBeUndefined();
  });

  it('a blobOnServer-only write does not mark the attachment dirty again', async () => {
    const updating = hooks['attachments:updating'];
    expect(updating).toBeTypeOf('function');
    mockFetch({ changesResponses: [{ changes: [], rev: 0 }] });
    // A real edit schedules the auto-sync debounce; the node env has no
    // window timers, so stub them (the debounce itself is not under test).
    const realWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { dispatchEvent: () => true, setTimeout: () => 0, clearTimeout: () => {} };
    try {
      updating({ blobOnServer: true }, 'A1');
      await new Promise((r) => setTimeout(r, 5));
      expect(meta.get('dirty:attachments:A1')).toBeUndefined();
      // A real edit still marks and still clears the failure tally.
      meta.set('blobfail:A1', { count: 1, lastAt: Date.now(), permanent: true });
      updating({ name: 'renamed.txt' }, 'A1');
      await new Promise((r) => setTimeout(r, 5));
      expect(meta.get('dirty:attachments:A1')).toEqual({ deleted: false });
      expect(meta.get('blobfail:A1')).toBeUndefined();
    } finally {
      (globalThis as { window?: unknown }).window = realWindow;
    }
  });

  it('transient failures back off, then retry after the backoff elapses', async () => {
    tables.get('attachments') ?? tables.set('attachments', new Map());
    const row = {
      id: 'FLAKY', taskId: 't1', name: 'f.txt', mime: 'text/plain', byteSize: 2,
      blob: { size: 2, type: 'text/plain' }, createdAt: 1,
    };
    tables.get('attachments')!.set('FLAKY', row);
    // Two recent transient failures: still inside the backoff window, skipped.
    meta.set('blobfail:FLAKY', { count: 2, lastAt: Date.now() });
    mockFetch({ changesResponses: [{ changes: [], rev: 0 }, { changes: [], rev: 1 }] });
    await syncNow(settings);
    expect(blobUploads).toEqual([]);
    // Backoff elapsed: retried and delivered. Counter stays monotonic.
    meta.set('blobfail:FLAKY', { count: 2, lastAt: Date.now() - 10 * 60 * 1000 });
    mockFetch({ changesResponses: [{ changes: [], rev: 1 }, { changes: [], rev: 1 }] });
    await syncNow(settings);
    expect(blobUploads.map((u) => u.id)).toEqual(['FLAKY']);
    expect(meta.get('blobfail:FLAKY')).toBeUndefined(); // tally cleared on success
  });

  it('attachment pushes carry metadata only, never the blob', async () => {
    tables.get('attachments') ?? tables.set('attachments', new Map());
    tables.get('attachments')!.set('A1', {
      id: 'A1', taskId: 't1', name: 'f.txt', mime: 'text/plain', byteSize: 3,
      blob: { size: 3, type: 'text/plain' }, createdAt: 1,
    });
    meta.set('dirty:attachments:A1', { deleted: false });

    const pushes = mockFetch({
      changesResponses: [{ changes: [], rev: 0 }, { changes: [], rev: 1 }],
      pushResults: [{ id: 'A1', collection: 'attachments', status: 'ok', rev: 1 }],
    });

    await syncNow(settings);
    const sent = pushes.flat().find((c) => c.id === 'A1');
    expect(sent).toBeDefined();
    expect(sent!.collection).toBe('attachments');
    const data = sent!.data as Record<string, unknown>;
    expect('blob' in data).toBe(false);
    expect(data.name).toBe('f.txt');
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

  it('round-trips focus sessions through pull and push', async () => {
    // Pull: a session logged via the agent API on another device lands in the local table.
    meta.set('cursor', 0);
    const session = { id: 'fs1', taskId: 't1', startedAt: 1761724800000, endedAt: 1761727500000, seconds: 2400 };
    mockFetch({
      changesResponses: [
        { changes: [{ collection: 'focusSessions', id: 'fs1', rev: 1, deleted: false, data: session }], rev: 1 },
        { changes: [], rev: 1 },
      ],
    });
    const r1 = await syncNow(settings);
    expect(r1.pulled).toBe(1);
    expect(tables.get('focusSessions')!.get('fs1')).toMatchObject({ taskId: 't1', seconds: 2400 });
    expect(meta.get('rev:focusSessions:fs1')).toBe(1);
    // Push: a locally recorded session goes out as a never-synced create (base_rev 0).
    tables.get('focusSessions')!.set('fs2', { id: 'fs2', taskId: 't1', startedAt: 1761730000000, endedAt: 1761730900000, seconds: 900 });
    meta.set('dirty:focusSessions:fs2', { deleted: false });
    const pushes = mockFetch({
      changesResponses: [{ changes: [], rev: 1 }, { changes: [], rev: 1 }],
      pushResults: [{ id: 'fs2', collection: 'focusSessions', status: 'ok', rev: 2 }],
    });
    const r2 = await syncNow(settings);
    expect(r2.pushed).toBe(1);
    expect(pushes[0][0]).toMatchObject({ collection: 'focusSessions', id: 'fs2', base_rev: 0, deleted: false });
    expect((pushes[0][0].data as { seconds: number }).seconds).toBe(900);
    expect(meta.has('dirty:focusSessions:fs2')).toBe(false);
    // Tombstone: a deleted session pushes deleted:true with an empty body.
    meta.set('dirty:focusSessions:fs1', { deleted: true });
    const pushes2 = mockFetch({
      changesResponses: [{ changes: [], rev: 2 }, { changes: [], rev: 2 }],
      pushResults: [{ id: 'fs1', collection: 'focusSessions', status: 'ok', rev: 3 }],
    });
    const r3 = await syncNow(settings);
    expect(r3.pushed).toBe(1);
    expect(pushes2[0][0]).toMatchObject({ collection: 'focusSessions', id: 'fs1', deleted: true, data: {} });
  });

describe('attachment metadata sync', () => {
  it('pulled attachment metadata preserves the local blob', async () => {
    const blob = new Blob(['bytes']);
    tables.set('attachments', new Map([['a1', { id: 'a1', taskId: 't1', name: 'f.txt', mime: 'text/plain', byteSize: 5, blob }]]));
    meta.set('cursor', 0);
    mockFetch({
      changesResponses: [
        { changes: [{ collection: 'attachments', id: 'a1', rev: 1, deleted: false, data: { id: 'a1', taskId: 't1', name: 'f.txt', mime: 'text/plain', byteSize: 5, sha256: 'abc' } }], rev: 1 },
        { changes: [], rev: 1 },
      ],
    });
    const r = await syncNow(settings);
    expect(r.pulled).toBe(1);
    const row = tables.get('attachments')!.get('a1') as { sha256?: string; blob?: Blob };
    expect(row.sha256).toBe('abc');
    expect(row.blob).toBe(blob);
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

describe('pull resilience against malformed entities', () => {
  it('realigns a blob that lost its inline id instead of wedging sync', async () => {
    mockFetch({
      changesResponses: [
        { changes: [{ collection: 'tasks', id: 'noid', rev: 1, deleted: false, data: { title: 'Pulled task', projectId: 'inbox', status: 'active' , createdAt: 1700000000000, updatedAt: 1700000001000 } }], rev: 1 },
        { changes: [], rev: 1 },
      ],
    });
    const r = await syncNow(settings);
    expect(r.pulled).toBe(1);
    expect(r.skipped ?? 0).toBe(0);
    expect(tables.get('tasks')!.get('noid')).toMatchObject({ id: 'noid', title: 'Pulled task' });
    expect(meta.get('cursor')).toBe(1);
    expect(loadSyncStatus()?.ok).toBe(true);
  });

  it('skips an entity whose data id contradicts its key, applies the rest, and advances the cursor', async () => {
    mockFetch({
      changesResponses: [
        { changes: [
          { collection: 'tasks', id: 'keyed', rev: 1, deleted: false, data: { id: 'different-id', title: 'Mismatched' } },
          { collection: 'tasks', id: 'good', rev: 2, deleted: false, data: { id: 'good', title: 'Good task', status: 'active' , createdAt: 1700000000000, updatedAt: 1700000001000 } },
        ], rev: 2 },
        { changes: [], rev: 2 },
      ],
    });
    const r = await syncNow(settings);
    expect(r.pulled).toBe(1);
    expect(r.skipped).toBe(1);
    expect(tables.get('tasks')!.get('good')).toMatchObject({ title: 'Good task' });
    expect(tables.get('tasks')!.has('keyed')).toBe(false);
    expect(tables.get('tasks')!.has('different-id')).toBe(false);
    expect(meta.get('cursor')).toBe(2);
    expect(loadSyncStatus()?.ok).toBe(true);
    expect(loadSyncStatus()?.summary).toContain('1 skipped (kept for review)');
    // The skipped payload is quarantined with its reason, not dropped.
    const q = await loadSyncQuarantine();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ collection: 'tasks', id: 'keyed', rev: 1 });
    expect((q[0].data as { id: string }).id).toBe('different-id');
    expect(q[0].reason).toContain('id mismatch');
  });

  it('quarantines a task with an unreadable status instead of letting it vanish from every view', async () => {
    mockFetch({
      changesResponses: [
        { changes: [
          { collection: 'tasks', id: 'bad-status', rev: 1, deleted: false, data: { id: 'bad-status', title: 'Hand-pushed', status: 'open' } },
          { collection: 'tasks', id: 'good2', rev: 2, deleted: false, data: { id: 'good2', title: 'Good task', status: 'active', createdAt: 1700000000000, updatedAt: 1700000001000 } },
        ], rev: 2 },
        { changes: [], rev: 2 },
      ],
    });
    const r = await syncNow(settings);
    expect(r.pulled).toBe(1);
    expect(r.skipped).toBe(1);
    expect(tables.get('tasks')!.has('bad-status')).toBe(false);
    expect(tables.get('tasks')!.get('good2')).toMatchObject({ title: 'Good task' });
    expect(meta.get('cursor')).toBe(2);
    const q = await loadSyncQuarantine();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ collection: 'tasks', id: 'bad-status' });
    expect(q[0].reason).toContain('status');
  });

  it('fills absent required fields on a pulled task so list views can see it', async () => {
    mockFetch({
      changesResponses: [
        { changes: [{ collection: 'tasks', id: 'sparse', rev: 1, deleted: false, data: { id: 'sparse', title: 'Sparse task', status: 'active', projectId: 'inbox', dueDate: '2026-01-02', createdAt: 1700000000000, updatedAt: 1700000001000 } }], rev: 1 },
        { changes: [], rev: 1 },
      ],
    });
    const r = await syncNow(settings);
    expect(r.pulled).toBe(1);
    expect(r.skipped ?? 0).toBe(0);
    const row = tables.get('tasks')!.get('sparse') as Record<string, unknown>;
    // The strict parentId === null check every list view relies on:
    expect(row.parentId).toBeNull();
    expect(row.blockedBy).toEqual([]);
    expect(row.tags).toEqual([]);
    expect(row.pinned).toBe(false);
    expect(row.order).toBe(0);
    expect(row.createdAt).toEqual(expect.any(Number));
    // Delivered values pass through untouched:
    expect(row.title).toBe('Sparse task');
    expect(row.dueDate).toBe('2026-01-02');
    expect(row.createdAt).toBe(1700000000000);
    expect(row.updatedAt).toBe(1700000001000);
    expect(await loadSyncQuarantine()).toHaveLength(0);
  });

  it('quarantines a task missing its history fields instead of inventing them', async () => {
    mockFetch({
      changesResponses: [
        { changes: [
          { collection: 'tasks', id: 'no-history', rev: 1, deleted: false, data: { id: 'no-history', title: 'No timestamps', status: 'active' } },
          { collection: 'tasks', id: 'good3', rev: 2, deleted: false, data: { id: 'good3', title: 'Good task', status: 'active', createdAt: 1700000000000, updatedAt: 1700000001000 } },
        ], rev: 2 },
        { changes: [], rev: 2 },
      ],
    });
    const r = await syncNow(settings);
    expect(r.pulled).toBe(1);
    expect(r.skipped).toBe(1);
    expect(tables.get('tasks')!.has('no-history')).toBe(false);
    expect(tables.get('tasks')!.has('good3')).toBe(true);
    const q = await loadSyncQuarantine();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ collection: 'tasks', id: 'no-history' });
    expect(q[0].reason).toContain('history');
  });

  it('quarantines a supplied tags value that is not a string list (the render-crash class)', async () => {
    mockFetch({
      changesResponses: [
        { changes: [
          { collection: 'tasks', id: 'bad-tags', rev: 1, deleted: false, data: { id: 'bad-tags', title: 'Bad tags', status: 'active', createdAt: 1700000000000, updatedAt: 1700000001000, tags: 'urgent' } },
          { collection: 'tasks', id: 'good4', rev: 2, deleted: false, data: { id: 'good4', title: 'Good task', status: 'active', createdAt: 1700000000000, updatedAt: 1700000001000 } },
        ], rev: 2 },
        { changes: [], rev: 2 },
      ],
    });
    const r = await syncNow(settings);
    expect(r.pulled).toBe(1);
    expect(r.skipped).toBe(1);
    expect(tables.get('tasks')!.has('bad-tags')).toBe(false);
    const q = await loadSyncQuarantine();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ collection: 'tasks', id: 'bad-tags' });
    expect(q[0].reason).toContain('tags');
  });

  it('quarantines supplied mistyped scalar and array fields without touching valid rows', async () => {
    mockFetch({
      changesResponses: [
        { changes: [
          { collection: 'tasks', id: 'bad-order', rev: 1, deleted: false, data: { id: 'bad-order', title: 'Bad order', status: 'active', createdAt: 1700000000000, updatedAt: 1700000001000, order: 'high' } },
          { collection: 'tasks', id: 'bad-blockers', rev: 2, deleted: false, data: { id: 'bad-blockers', title: 'Bad blockers', status: 'active', createdAt: 1700000000000, updatedAt: 1700000001000, blockedBy: 't1' } },
          { collection: 'tasks', id: 'bad-pinned', rev: 3, deleted: false, data: { id: 'bad-pinned', title: 'Bad pinned', status: 'active', createdAt: 1700000000000, updatedAt: 1700000001000, pinned: 1 } },
        ], rev: 3 },
        { changes: [], rev: 3 },
      ],
    });
    const r = await syncNow(settings);
    expect(r.pulled).toBe(0);
    expect(r.skipped).toBe(3);
    expect(tables.get('tasks')!.size ?? 0).toBe(0);
    const q = await loadSyncQuarantine();
    expect(q.map((e) => e.id).sort()).toEqual(['bad-blockers', 'bad-order', 'bad-pinned']);
    expect(q.find((e) => e.id === 'bad-order')!.reason).toContain('order');
    expect(q.find((e) => e.id === 'bad-blockers')!.reason).toContain('blockedBy');
    expect(q.find((e) => e.id === 'bad-pinned')!.reason).toContain('pinned');
  });

  it('applies a fully specified task verbatim, supplied nulls and values intact', async () => {
    const full = {
      id: 'full-1', title: 'Full task', note: 'a note', noteDoc: null, projectId: 'inbox',
      parentId: null, goalId: null, noteId: null, status: 'done', pinned: true, priority: 1,
      dueDate: null, dueTime: null, plannedDate: null, plannedTime: null, durationMinutes: null,
      recurrence: null, skippedDates: ['2026-01-01'], blockedBy: [], tags: ['x'], order: 42,
      seriesId: null, createdAt: 1700000000000, updatedAt: 1700000001000, completedAt: 1700000002000,
    };
    mockFetch({
      changesResponses: [
        { changes: [{ collection: 'tasks', id: 'full-1', rev: 1, deleted: false, data: full }], rev: 1 },
        { changes: [], rev: 1 },
      ],
    });
    const r = await syncNow(settings);
    expect(r.pulled).toBe(1);
    expect(r.skipped ?? 0).toBe(0);
    expect(tables.get('tasks')!.get('full-1')).toEqual(full);
    expect(await loadSyncQuarantine()).toHaveLength(0);
  });

  it('treats a store-level put failure as transient: cursor stays, nothing is lost, retry recovers', async () => {
    const responses = () => [
      { changes: [
        { collection: 'tasks', id: 'simulated-dexie-error', rev: 1, deleted: false, data: { id: 'simulated-dexie-error', title: 'Broken row', status: 'active' , createdAt: 1700000000000, updatedAt: 1700000001000 } },
        { collection: 'tasks', id: 'after', rev: 2, deleted: false, data: { id: 'after', title: 'Later valid', status: 'active' , createdAt: 1700000000000, updatedAt: 1700000001000 } },
      ], rev: 2 },
      { changes: [], rev: 2 },
    ];
    mockFetch({ changesResponses: responses() });
    // The put failure aborts the pull BEFORE the cursor advances: the
    // failing entity and everything after it stay covered by the cursor.
    await expect(syncNow(settings)).rejects.toThrow('simulated DataError');
    expect(meta.get('cursor') ?? 0).toBe(0);
    expect(tables.get('tasks')!.has('after')).toBe(false);
    // Nothing was quarantined: this was not a malformed payload.
    expect(await loadSyncQuarantine()).toHaveLength(0);
    // The store fault clears (id renamed as if the row were fixed) and the
    // next sync retries and applies both entities - no silent loss.
    mockFetch({ changesResponses: [
      { changes: [
        { collection: 'tasks', id: 'simulated-dexie-error', rev: 1, deleted: true, data: {} },
        { collection: 'tasks', id: 'after', rev: 2, deleted: false, data: { id: 'after', title: 'Later valid', status: 'active' , createdAt: 1700000000000, updatedAt: 1700000001000 } },
      ], rev: 2 },
      { changes: [], rev: 2 },
    ] });
    const r2 = await syncNow(settings);
    // Both re-fetched entities apply: the tombstone (delete counts as
    // applied) and the valid row that was previously stuck behind it.
    expect(r2.pulled).toBe(2);
    expect(tables.get('tasks')!.has('simulated-dexie-error')).toBe(false);
    expect(tables.get('tasks')!.get('after')).toMatchObject({ title: 'Later valid' });
    expect(meta.get('cursor')).toBe(2);
    expect(loadSyncStatus()?.ok).toBe(true);
  });
});

describe('quarantine bounds', () => {
  it('caps the quarantine at 20, evicts oldest first, and tallies overflow with the last reason', async () => {
    const changes = [];
    for (let i = 1; i <= 23; i++) {
      changes.push({ collection: 'tasks', id: 'bad' + i, rev: i, deleted: false, data: { id: 'mismatch' + i, title: 'Bad ' + i } });
    }
    mockFetch({ changesResponses: [{ changes, rev: 23 }, { changes: [], rev: 23 }] });
    const r = await syncNow(settings);
    expect(r.skipped).toBe(23);
    const q = await loadSyncQuarantine();
    expect(q).toHaveLength(20);
    // Oldest three (bad1..bad3) evicted; newest kept.
    expect(q.some((e) => e.id === 'bad1')).toBe(false);
    expect(q.some((e) => e.id === 'bad3')).toBe(false);
    expect(q.some((e) => e.id === 'bad23')).toBe(true);
    const ov = await loadSyncQuarantineOverflow();
    expect(ov).not.toBeNull();
    expect(ov!.count).toBe(3);
    expect(ov!.lastReason).toContain('id mismatch');
    expect(ov!.lastId).toBe('bad23');
  });

  it('stores oversized payloads truncated with their byte size, not the whole blob', async () => {
    const big = 'x'.repeat(70 * 1024);
    mockFetch({
      changesResponses: [
        { changes: [{ collection: 'tasks', id: 'big1', rev: 1, deleted: false, data: { id: 'other', title: big } }], rev: 1 },
        { changes: [], rev: 1 },
      ],
    });
    await syncNow(settings);
    const q = await loadSyncQuarantine();
    expect(q).toHaveLength(1);
    expect(q[0].data).toMatchObject({ truncated: true });
    expect((q[0].data as { bytes: number }).bytes).toBeGreaterThan(70 * 1024);
    // The status must not claim the payload is kept whole.
    expect(loadSyncStatus()?.summary).toContain('1 skipped (recorded by size only)');
    expect(loadSyncStatus()?.summary).not.toContain('kept for review');
  });

  it('distinguishes kept vs size-only records in a mixed batch', async () => {
    const big = 'y'.repeat(70 * 1024);
    mockFetch({
      changesResponses: [
        { changes: [
          { collection: 'tasks', id: 'small-bad', rev: 1, deleted: false, data: { id: 'nope', title: 'Small bad' } },
          { collection: 'tasks', id: 'big-bad', rev: 2, deleted: false, data: { id: 'alsono', title: big } },
        ], rev: 2 },
        { changes: [], rev: 2 },
      ],
    });
    await syncNow(settings);
    expect(loadSyncStatus()?.summary).toContain('2 skipped (1 kept for review, 1 recorded by size only)');
  });
});

describe('prompt attachment upload ordering', () => {
  const att = () => ({ id: 'att-1', taskId: 'task-1', name: 'pixel.png', blob: new Blob(['px'], { type: 'image/png' }) });

  it('does not upload immediately when the task is not synced yet (avoids the predictable 422)', async () => {
    mockFetch({ changesResponses: [] });
    const attempted = await promptAttachmentUploadIfTaskSynced(att());
    expect(attempted).toBe(false);
    expect(blobUploads).toHaveLength(0);
  });

  it('uploads promptly when the task already has a server rev', async () => {
    mockFetch({ changesResponses: [] });
    meta.set('rev:tasks:task-1', 5);
    const attempted = await promptAttachmentUploadIfTaskSynced(att());
    expect(attempted).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(blobUploads).toHaveLength(1);
    expect(blobUploads[0]).toMatchObject({ id: 'att-1', taskId: 'task-1' });
  });
});

describe('restore-rollback guard (fail closed on a backward server counter)', () => {
  // Setup shared by these tests: the client was synced up to rev 5; the
  // server was then restored from an older backup whose counter is 2.
  // Approved behavior (John, 2026-11-02): pause sync with a clear warning;
  // never overwrite or merge automatically. Limited guard: detection fires
  // only while the server counter is still below the client cursor.

  it('detects a LOWER counter: cursor never regresses, sync halts with a visible warning', async () => {
    meta.set('cursor', 5);
    mockFetch({ changesResponses: [{ changes: [], rev: 2 }, { changes: [], rev: 2 }] });
    await expect(syncNow(settings)).rejects.toThrow('sync rollback detected');
    expect(meta.get('cursor')).toBe(5); // never moves backward
    expect(getSyncHalt()).toMatchObject({ cursor: 5, serverRev: 2 });
    const status = loadSyncStatus();
    expect(status?.ok).toBe(false);
    expect(status?.summary).toContain('Sync paused');
    expect(status?.summary).toContain('server rev 2');
    expect(status?.summary).toContain('this device rev 5');
    expect(status?.summary).toContain('no further changes are sent or merged');
    expect(status?.summary).not.toContain('Nothing was sent or overwritten');
  });

  it('while halted, sync makes no network calls at all', async () => {
    meta.set('cursor', 5);
    mockFetch({ changesResponses: [{ changes: [], rev: 2 }] });
    await expect(syncNow(settings)).rejects.toThrow('sync rollback detected');
    expect(getSyncHalt()).not.toBeNull();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(syncNow(settings)).rejects.toThrow('sync rollback detected');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(loadSyncStatus()?.summary).toContain('Sync paused');
  });

  it('detects a rollback on the post-push pull too, before any backfill upload runs', async () => {
    // Restore landing mid-sync: pull1 is healthy, the push goes out (the
    // documented residual - those writes are discarded by the restore
    // itself), and pull2 must still halt before the blob backfill writes.
    meta.set('cursor', 5);
    meta.set('dirty:tasks:t1', { deleted: false });
    tables.set('tasks', new Map([['t1', serverTask('t1', 'Edited locally')]]));
    tables.set('attachments', new Map([['att-1', { id: 'att-1', taskId: 't1', name: 'p.png', blob: new Blob(['px']), blobOnServer: false, createdAt: 1 }]]));
    mockFetch({
      changesResponses: [{ changes: [], rev: 5 }, { changes: [], rev: 2 }],
      pushResults: [{ collection: 'tasks', id: 't1', status: 'ok', rev: 6 }],
    });
    await expect(syncNow(settings)).rejects.toThrow('sync rollback detected');
    expect(getSyncHalt()).toMatchObject({ cursor: 5, serverRev: 2 });
    expect(blobUploads).toHaveLength(0); // backfill never ran
    // The push above already sent a write this sync, so the warning must
    // not claim nothing was sent: it only promises no FURTHER changes.
    const summary = loadSyncStatus()?.summary ?? '';
    expect(summary).toContain('no further changes are sent or merged');
    expect(summary).not.toContain('Nothing was sent or overwritten');
  });

  it('an equal counter does not halt (normal sync keeps working)', async () => {
    meta.set('cursor', 5);
    mockFetch({ changesResponses: [{ changes: [], rev: 5 }, { changes: [], rev: 5 }] });
    const r = await syncNow(settings);
    expect(r.cursor).toBe(5);
    expect(getSyncHalt()).toBeNull();
    expect(loadSyncStatus()?.ok).toBe(true);
  });

  it('disconnect/reconnect re-arms detection: a still-behind server re-halts', async () => {
    meta.set('cursor', 5);
    mockFetch({ changesResponses: [{ changes: [], rev: 2 }] });
    await expect(syncNow(settings)).rejects.toThrow('sync rollback detected');
    expect(getSyncHalt()).not.toBeNull();
    saveSyncSettings(null); // disconnect clears the halt
    expect(getSyncHalt()).toBeNull();
    saveSyncSettings(settings); // reconnect
    mockFetch({ changesResponses: [{ changes: [], rev: 2 }] });
    await expect(syncNow(settings)).rejects.toThrow('sync rollback detected');
    expect(getSyncHalt()).toMatchObject({ cursor: 5, serverRev: 2 });
  });

  it('an independent blob upload preflights the LIVE server and refuses to write (stale-session case)', async () => {
    // Long-lived tab: sync was healthy earlier, the server was restored
    // afterwards. The attach path must not trust the stale session - it
    // checks the live counter before writing, and the retry path then
    // reports 'halted' without talling a refusal.
    meta.set('cursor', 5);
    meta.set('rev:tasks:task-1', 5);
    tables.set('attachments', new Map([['att-1', { id: 'att-1', taskId: 'task-1', name: 'pixel.png', blob: new Blob(['px']), blobOnServer: false, createdAt: 1 }]]));
    mockFetch({ changesResponses: [{ changes: [], rev: 2 }] }); // preflight sees the rollback
    await promptAttachmentUploadIfTaskSynced({ id: 'att-1', taskId: 'task-1', name: 'pixel.png', blob: new Blob(['px'], { type: 'image/png' }) });
    await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget upload settle
    expect(blobUploads).toHaveLength(0);
    expect(getSyncHalt()).toMatchObject({ cursor: 5, serverRev: 2 });
    const outcome = await retryAttachmentUpload('att-1');
    expect(outcome).toBe('halted');
    expect(blobUploads).toHaveLength(0);
    expect(meta.get('blobfail:att-1')).toBeUndefined(); // a halt is not a refusal
  });

  it('prompt upload refuses immediately while halted', async () => {
    meta.set('cursor', 5);
    mockFetch({ changesResponses: [{ changes: [], rev: 2 }] });
    await expect(syncNow(settings)).rejects.toThrow('sync rollback detected');
    meta.set('rev:tasks:task-1', 5);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const attempted = await promptAttachmentUploadIfTaskSynced({ id: 'att-9', taskId: 'task-1', name: 'p.png', blob: new Blob(['px']) });
    expect(attempted).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a healthy preflight lets an independent upload through', async () => {
    meta.set('cursor', 5);
    tables.set('attachments', new Map([['att-1', { id: 'att-1', taskId: 'task-1', name: 'p.png', blob: new Blob(['px']), blobOnServer: false, createdAt: 1 }]]));
    mockFetch({ changesResponses: [{ changes: [], rev: 5 }] });
    const outcome = await retryAttachmentUpload('att-1');
    expect(outcome).toBe('ok');
    expect(blobUploads).toHaveLength(1);
    expect(getSyncHalt()).toBeNull();
  });

  it('a failed preflight defers the write: nothing is sent and no halt is recorded', async () => {
    // An unreachable server is not rollback evidence, but it is not
    // permission to skip the guard either: without a successful check the
    // write is deferred (retryable), never sent.
    meta.set('cursor', 5);
    tables.set('attachments', new Map([['att-1', { id: 'att-1', taskId: 'task-1', name: 'p.png', blob: new Blob(['px']), blobOnServer: false, createdAt: 1 }]]));
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/changes?')) throw new Error('network down');
      if (String(url).includes('/api/attachments?') && init?.method === 'POST') return { ok: true, json: async () => ({ rev: 6 }) } as Response;
      throw new Error(`unexpected fetch ${url}`);
    }));
    const outcome = await retryAttachmentUpload('att-1');
    expect(outcome).toBe('unverified');
    expect(blobUploads).toHaveLength(0);
    expect(getSyncHalt()).toBeNull();
    expect(meta.get('blobfail:att-1')).toBeUndefined(); // a deferral is not a refusal
  });

  it('an HTTP-error preflight defers the write the same way', async () => {
    meta.set('cursor', 5);
    tables.set('attachments', new Map([['att-1', { id: 'att-1', taskId: 'task-1', name: 'p.png', blob: new Blob(['px']), blobOnServer: false, createdAt: 1 }]]));
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/changes?')) return { ok: false, status: 503 } as Response;
      if (String(url).includes('/api/attachments?') && init?.method === 'POST') return { ok: true, json: async () => ({ rev: 6 }) } as Response;
      throw new Error(`unexpected fetch ${url}`);
    }));
    const outcome = await retryAttachmentUpload('att-1');
    expect(outcome).toBe('unverified');
    expect(blobUploads).toHaveLength(0);
    expect(getSyncHalt()).toBeNull();
  });

  it('backfill uploads ride the sync pulls - no extra preflight round-trip', async () => {
    tables.set('attachments', new Map([['att-1', { id: 'att-1', taskId: 'task-1', name: 'p.png', blob: new Blob(['px']), blobOnServer: false, createdAt: 1 }]]));
    let gets = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/changes?')) { gets++; return { ok: true, json: async () => ({ changes: [], rev: 1 }) } as Response; }
      if (String(url).endsWith('/api/changes') && init?.method === 'POST') return { ok: true, json: async () => ({ results: [] }) } as Response;
      if (String(url).includes('/api/attachments?') && init?.method === 'POST') {
        const u = new URL(String(url));
        blobUploads.push({ id: u.searchParams.get('id'), taskId: u.searchParams.get('task_id'), size: 2 });
        return { ok: true, json: async () => ({ rev: 7 }) } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    await syncNow(settings);
    expect(gets).toBe(2); // pull1 + pull2 only
    expect(blobUploads).toHaveLength(1);
    expect(loadSyncStatus()?.ok).toBe(true);
  });
});

describe('sync hooks - attachment bookkeeping writes', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('does not mark a row dirty for blob/blobOnServer-only bookkeeping writes', async () => {
    installSyncHooks();
    const updating = hooks['attachments:updating'];
    expect(typeof updating).toBe('function');
    // uploadAttachmentBlob's acknowledgement write
    updating({ blobOnServer: true }, 'att-1');
    // Attachments download path caching server bytes locally
    updating({ blob: {}, blobOnServer: true }, 'att-2');
    // Dexie strips unchanged keys: the same cache write arrives as { blob }
    // alone when the stored row already has blobOnServer: true.
    updating({ blob: {} }, 'att-3');
    updating({ blob: {}, blobOnServer: false }, 'att-4');
    await tick();
    for (const id of ['att-1', 'att-2', 'att-3', 'att-4']) expect(meta.has('dirty:attachments:' + id)).toBe(false);
  });

  it('still marks real attachment metadata edits dirty', async () => {
    installSyncHooks();
    const updating = hooks['attachments:updating'];
    updating({ name: 'renamed.pdf' }, 'att-5');
    updating({ name: 'renamed.pdf', blob: {} }, 'att-6'); // metadata edit that also touches blob
    await tick();
    expect(meta.get('dirty:attachments:att-5')).toEqual({ deleted: false });
    expect(meta.get('dirty:attachments:att-6')).toEqual({ deleted: false });
  });
});

describe('automatic sync triggers', () => {
  const realWindow = (globalThis as { window?: unknown }).window;
  const realDocument = (globalThis as { document?: unknown }).document;
  const hadNavigator = 'navigator' in globalThis;

  function stubDom() {
    const winListeners = new Map<string, ((ev?: unknown) => void)[]>();
    const docListeners = new Map<string, ((ev?: unknown) => void)[]>();
    const add = (m: Map<string, ((ev?: unknown) => void)[]>) => (t: string, fn: (ev?: unknown) => void) => {
      m.set(t, [...(m.get(t) ?? []), fn]);
    };
    (globalThis as { window?: unknown }).window = {
      dispatchEvent: () => true,
      clearTimeout: () => undefined,
      setTimeout: () => 0,
      setInterval: () => 0,
      addEventListener: add(winListeners),
      location: { search: '' },
    };
    (globalThis as { document?: unknown }).document = {
      visibilityState: 'visible',
      addEventListener: add(docListeners),
    };
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
    return { winListeners, docListeners };
  }

  function countPulls() {
    let pulls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/changes?')) { pulls += 1; return { ok: true, json: async () => ({ changes: [], rev: 0 }) } as Response; }
      if (String(url).endsWith('/api/changes')) return { ok: true, json: async () => ({ results: [] }) } as Response;
      throw new Error(`unexpected fetch ${url}`);
    }));
    return () => pulls;
  }

  afterEach(() => {
    (globalThis as { window?: unknown }).window = realWindow;
    (globalThis as { document?: unknown }).document = realDocument;
    if (!hadNavigator) delete (globalThis as { navigator?: unknown }).navigator;
  });

  it('syncs immediately on app start when connected', async () => {
    stubDom();
    vi.resetModules();
    const mod = await import('./sync');
    const pulls = countPulls();
    mod.saveSyncSettings(settings);
    mod.startAutoSync();
    await new Promise((r) => setTimeout(r, 20));
    expect(pulls()).toBeGreaterThan(0);
  });

  it('syncs when the app returns to a visible tab', async () => {
    const { docListeners } = stubDom();
    vi.resetModules();
    const mod = await import('./sync');
    const pulls = countPulls();
    mod.saveSyncSettings(settings);
    mod.startAutoSync();
    await new Promise((r) => setTimeout(r, 20));
    const afterStart = pulls();
    for (const fn of docListeners.get('visibilitychange') ?? []) fn();
    await new Promise((r) => setTimeout(r, 20));
    expect(pulls()).toBeGreaterThan(afterStart);
  });

  it('does not sync on start when no server is connected', async () => {
    stubDom();
    vi.resetModules();
    const mod = await import('./sync');
    const pulls = countPulls();
    localStorage.removeItem('lifedash-sync');
    mod.startAutoSync();
    await new Promise((r) => setTimeout(r, 20));
    expect(pulls()).toBe(0);
  });

  it('startup quarantines malformed data, keeps the following valid task, and foreground resumes from the cursor', async () => {
    const { docListeners } = stubDom();
    vi.resetModules();
    const mod = await import('./sync');
    const cursors: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!String(url).includes('/api/changes?')) throw new Error(`unexpected fetch ${url}`);
      cursors.push(new URL(String(url)).searchParams.get('since')!);
      const changes = cursors.length === 1 ? [
        { collection: 'tasks', id: 'broken', rev: 1, deleted: false, data: { ...serverTask('broken', 'bad tags'), tags: 'not-an-array' } },
        { collection: 'tasks', id: 'valid', rev: 2, deleted: false, data: serverTask('valid', 'survives automatic pull') },
      ] : [];
      return { ok: true, json: async () => ({ changes, rev: 2 }) } as Response;
    }));
    mod.saveSyncSettings(settings);
    mod.startAutoSync();
    await vi.waitFor(() => expect(mod.loadSyncStatus()?.summary).toContain('1 skipped'));
    expect(tables.get('tasks')?.has('broken')).toBe(false);
    expect(tables.get('tasks')?.get('valid')).toMatchObject({ title: 'survives automatic pull', parentId: null, tags: [] });
    expect(await mod.loadSyncQuarantine()).toHaveLength(1);
    expect(cursors).toEqual(['0', '2']);
    for (const fn of docListeners.get('visibilitychange') ?? []) fn();
    await vi.waitFor(() => expect(cursors).toHaveLength(4));
    await vi.waitFor(() => expect(mod.loadSyncStatus()?.summary).toBe('pushed 0, pulled 0'));
    expect(cursors).toEqual(['0', '2', '2', '2']);
    expect(await mod.loadSyncQuarantine()).toHaveLength(1);
    expect(meta.get('cursor')).toBe(2);
  });

  it('coalesces focus, reconnect and visibility triggers while a startup pull is in flight', async () => {
    const { winListeners, docListeners } = stubDom();
    vi.resetModules();
    const mod = await import('./sync');
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let pulls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!String(url).includes('/api/changes?')) throw new Error(`unexpected fetch ${url}`);
      pulls++;
      if (pulls === 1) await blocked;
      return { ok: true, json: async () => ({ changes: [], rev: 0 }) } as Response;
    }));
    mod.saveSyncSettings(settings);
    mod.startAutoSync();
    await vi.waitFor(() => expect(pulls).toBe(1));
    for (let i = 0; i < 5; i++) {
      for (const event of ['focus', 'online']) for (const fn of winListeners.get(event) ?? []) fn();
      for (const fn of docListeners.get('visibilitychange') ?? []) fn();
    }
    expect(pulls).toBe(1);
    release();
    await vi.waitFor(() => expect(mod.loadSyncStatus()?.ok).toBe(true));
    expect(pulls).toBe(2); // one initial pull plus the settling pull, not 16 syncs
    for (const fn of winListeners.get('focus') ?? []) fn();
    await vi.waitFor(() => expect(pulls).toBe(4)); // guard released for a later foreground event
  });

});
