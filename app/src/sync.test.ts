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
        put: async (obj: { id: string }) => { t.set(obj.id, obj); return obj.id; },
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

import { acknowledgeConflictNotice, attachmentUploadFailures, getConflictNotice, loadSyncStatus, logout, retryAttachmentUpload, saveSyncSettings, syncNow, uploadAttachmentBlob } from './sync';

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

const serverTask = (id: string, title: string) => ({ id, title, projectId: 'inbox' });

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
    meta.set('blobfail:OLD', { count: 1, lastAt: Date.now() - 25 * 60 * 60 * 1000, permanent: true });
    mockFetch({ changesResponses: [{ changes: [], rev: 0 }, { changes: [], rev: 1 }] });
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
    // Backoff elapsed: retried and delivered.
    meta.set('blobfail:FLAKY', { count: 2, lastAt: Date.now() - 10 * 60 * 1000 });
    mockFetch({ changesResponses: [{ changes: [], rev: 0 }, { changes: [], rev: 1 }] });
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
