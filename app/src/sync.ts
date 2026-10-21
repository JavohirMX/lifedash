import { db } from './db';

/**
 * Sync client for the Lifedash self-hosted server (protocol v1,
 * server/docs/sync-protocol.md). Server wins on conflict in v1.
 * Syncs tasks, projects, habits and habit logs; attachment blobs
 * stay local until the protocol grows blob storage.
 */

export interface SyncStatus {
  at: number;
  ok: boolean;
  summary: string;
}

const STATUS_KEY = 'lifedash-sync-status';

export function loadSyncStatus(): SyncStatus | null {
  try {
    const raw = localStorage.getItem(STATUS_KEY);
    return raw ? (JSON.parse(raw) as SyncStatus) : null;
  } catch {
    return null;
  }
}

function saveSyncStatus(s: SyncStatus): void {
  localStorage.setItem(STATUS_KEY, JSON.stringify(s));
  window.dispatchEvent(new Event('lifedash-sync-status'));
}

export interface SyncSettings {
  url: string;
  username: string;
  token: string;
}

const SETTINGS_KEY = 'lifedash-sync';
const COLLECTIONS = ['tasks', 'projects', 'habits', 'habitLogs', 'goals', 'notes', 'journal'] as const;
type Collection = (typeof COLLECTIONS)[number];

export function loadSyncSettings(): SyncSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SyncSettings;
    return s.url && s.token ? s : null;
  } catch {
    return null;
  }
}

export function saveSyncSettings(s: SyncSettings | null): void {
  if (s) localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  else localStorage.removeItem(SETTINGS_KEY);
}

export async function register(url: string, username: string, password: string): Promise<string> {
  return authCall(url, 'register', username, password);
}

export async function login(url: string, username: string, password: string): Promise<string> {
  return authCall(url, 'login', username, password);
}

async function authCall(url: string, path: string, username: string, password: string): Promise<string> {
  const res = await fetch(`${url.replace(/\/$/, '')}/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

/* ---------- local state (syncmeta table) ---------- */

const revKey = (col: Collection, id: string) => `rev:${col}:${id}`;
const dirtyKey = (col: Collection, id: string) => `dirty:${col}:${id}`;

async function getMeta(key: string): Promise<unknown> {
  const row = await db.syncmeta.get(key);
  return row?.value;
}

async function setMeta(key: string, value: unknown): Promise<void> {
  await db.syncmeta.put({ key, value });
}

async function getCursor(): Promise<number> {
  return ((await getMeta('cursor')) as number | undefined) ?? 0;
}

export interface ConflictNotice {
  count: number;
  at: number;
}

const CONFLICT_NOTICE_KEY = 'sync:conflict-notice';

/** Unacknowledged server-wins conflict count, persisted across sessions. */
export async function getConflictNotice(): Promise<ConflictNotice | null> {
  return ((await getMeta(CONFLICT_NOTICE_KEY)) as ConflictNotice | undefined) ?? null;
}

export async function acknowledgeConflictNotice(): Promise<void> {
  await db.syncmeta.delete(CONFLICT_NOTICE_KEY);
}

async function recordConflicts(conflicts: number): Promise<void> {
  if (conflicts <= 0) return;
  const prior = await getConflictNotice();
  await setMeta(CONFLICT_NOTICE_KEY, { count: (prior?.count ?? 0) + conflicts, at: Date.now() });
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('lifedash:sync-conflict'));
}

/* ---------- dirty tracking via Dexie hooks ---------- */

let applyingRemote = false;
let hooksInstalled = false;
let autoSyncStarted = false;
let syncing = false;
let debounceTimer: number | undefined;

const AUTO_INTERVAL_MS = 5 * 60 * 1000;
const EDIT_DEBOUNCE_MS = 4 * 1000;

function scheduleSync(): void {
  if (!loadSyncSettings()) return;
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => void runAutoSync(), EDIT_DEBOUNCE_MS);
}

async function runAutoSync(): Promise<void> {
  const settings = loadSyncSettings();
  if (!settings || syncing || !navigator.onLine) return;
  try {
    const r = await syncNow(settings); // syncNow owns the in-flight guard
    saveSyncStatus({ at: Date.now(), ok: true, summary: summaryOf(r) });
  } catch (e) {
    saveSyncStatus({ at: Date.now(), ok: false, summary: e instanceof Error ? e.message : String(e) });
    console.warn('auto-sync failed', e);
  }
}

function summaryOf(r: SyncResult): string {
  const parts = [`pushed ${r.pushed}`, `pulled ${r.pulled}`];
  if (r.conflicts) parts.push(`${r.conflicts} conflict${r.conflicts === 1 ? '' : 's'} (server won)`);
  return parts.join(', ');
}

/** Focus/online/interval sync plus debounced push after local edits. */
export function startAutoSync(): void {
  if (autoSyncStarted) return;
  autoSyncStarted = true;
  installSyncHooks();
  window.addEventListener('focus', () => void runAutoSync());
  window.addEventListener('online', () => void runAutoSync());
  window.setInterval(() => void runAutoSync(), AUTO_INTERVAL_MS);
}

export function installSyncHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  for (const col of COLLECTIONS) {
    const table = db.table(col);
    const mark = (id: string, deleted = false) => {
      if (applyingRemote || !id) return;
      // Hooks fire inside the source transaction's zone; writing syncmeta
      // there makes Dexie join that transaction, which does not include
      // the syncmeta store. Escape the zone, then write.
      setTimeout(() => {
        void setMeta(dirtyKey(col, id), { deleted });
        scheduleSync();
      }, 0);
    };
    table.hook('creating', (_pk, obj) => mark((obj as { id: string }).id));
    table.hook('updating', (_mods, pk) => mark(String(pk)));
    table.hook('deleting', (pk) => mark(String(pk), true));
  }
}

export async function dirtyCount(): Promise<number> {
  return db.syncmeta.where('key').startsWith('dirty:').count();
}

/* ---------- push / pull ---------- */

interface ServerEntity {
  collection: string;
  id: string;
  rev: number;
  deleted: boolean;
  data: unknown;
}

export interface SyncResult {
  pushed: number;
  conflicts: number;
  pulled: number;
  cursor: number;
}

export async function syncNow(settings: SyncSettings): Promise<SyncResult> {
  installSyncHooks();
  if (syncing) return { pushed: 0, conflicts: 0, pulled: 0, cursor: await getCursor() };
  syncing = true;
  try {
    const r = await syncNowInner(settings);
    saveSyncStatus({ at: Date.now(), ok: true, summary: summaryOf(r) });
    return r;
  } finally {
    syncing = false;
  }
}

async function syncNowInner(settings: SyncSettings): Promise<SyncResult> {
  const base = settings.url.replace(/\/$/, '');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.token}` };

  // Pull first so base_revs are fresh.
  const pulled1 = await pull(base, headers);
  // Push all dirty entities.
  const dirtyRows = await db.syncmeta.where('key').startsWith('dirty:').toArray();
  const changes = [];
  for (const row of dirtyRows) {
    const [, colRaw, ...rest] = row.key.split(':');
    const col = colRaw as Collection;
    const id = rest.join(':'); // habitLog ids contain a colon (habitId:date)
    const tomb = (row.value as { deleted?: boolean }).deleted === true;
    const data = tomb ? null : await db.table(col).get(id);
    const baseRev = ((await getMeta(revKey(col, id))) as number | undefined) ?? 0;
    if (!tomb && !data) {
      // Dirty but gone locally (deleted before ever synced): send a tombstone.
      changes.push({ collection: col, id, base_rev: baseRev, deleted: true, data: {} });
      continue;
    }
    changes.push({ collection: col, id, base_rev: baseRev, deleted: tomb, data: tomb ? {} : data });
  }
  let pushed = 0;
  let conflicts = 0;
  let replaced = 0;
  if (changes.length > 0) {
    const res = await fetch(`${base}/api/changes`, { method: 'POST', headers, body: JSON.stringify({ changes }) });
    if (!res.ok) throw new Error(`push failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      results: {
        id: string;
        collection: string;
        status: string;
        rev?: number;
        current?: { rev: number; deleted: boolean; data: unknown };
      }[];
    };
    for (const r of body.results) {
      const col = r.collection as Collection;
      if (r.status === 'ok' && r.rev !== undefined) {
        await setMeta(revKey(col, r.id), r.rev);
        await db.syncmeta.delete(dirtyKey(col, r.id));
        pushed += 1;
      } else if (r.status === 'conflict' && r.current) {
        // Server wins: take the server's version, drop our local edit.
        conflicts += 1;
        // A conflict whose local content is identical to the server's
        // (e.g. the default Inbox seeded on first join) loses nothing, so
        // it must not count as a replaced edit in the persistent notice.
        const ch = changes.find((c) => c.collection === col && c.id === r.id);
        if (ch && JSON.stringify(ch.data) !== JSON.stringify(r.current.data)) replaced += 1;
        await applyRemote(col, {
          collection: r.collection,
          id: r.id,
          rev: r.current.rev,
          deleted: r.current.deleted,
          data: r.current.data,
        });
      }
    }
  }
  // Final pull to settle on anything the server applied.
  const pulled2 = await pull(base, headers);
  // Server-wins drops the conflicting local edits: keep a persistent notice
  // so an auto-sync cannot erase awareness before the user sees it.
  await recordConflicts(replaced);
  return { pushed, conflicts, pulled: pulled1 + pulled2, cursor: await getCursor() };
}

async function pull(base: string, headers: Record<string, string>): Promise<number> {
  const since = await getCursor();
  const res = await fetch(`${base}/api/changes?since=${since}`, { headers });
  if (!res.ok) throw new Error(`pull failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { changes: ServerEntity[]; rev: number };
  let applied = 0;
  for (const e of body.changes) {
    const col = e.collection as Collection;
    if (!COLLECTIONS.includes(col)) continue;
    const isDirty = (await db.syncmeta.get(dirtyKey(col, e.id))) !== undefined;
    if (isDirty) {
      // Locally edited: keep BOTH the local data and the old base_rev.
      // The push must go out with the stale base_rev so the server can
      // answer "conflict" with its version (server-wins MVP). Refreshing
      // base_rev here would make the push match and silently clobber the
      // server's newer version - the bug this comment replaces.
      continue;
    }
    await applyRemote(col, e);
    applied += 1;
  }
  await setMeta('cursor', body.rev);
  return applied;
}

async function applyRemote(col: Collection, e: ServerEntity): Promise<void> {
  applyingRemote = true;
  try {
    const table = db.table(col);
    if (e.deleted) await table.delete(e.id);
    else await table.put(e.data as never);
    await setMeta(revKey(col, e.id), e.rev);
    await db.syncmeta.delete(dirtyKey(col, e.id));
  } finally {
    applyingRemote = false;
  }
}
