import { SAMPLE_MODE } from './dev/sampleMode';
import { db } from './db';
import { refreshAutomationFromSync } from './automation';
import { applyRemoteSettings, getDeviceId } from './deviceSettings';
import type { Attachment } from './types';

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
  persistenceFailed?: boolean;
}

const STATUS_KEY = 'lifedash-sync-status';
const SUCCESS_KEY = 'lifedash-sync-last-success';
export function loadLastSuccessfulSync(): number | null {
  if (SAMPLE_MODE) return null;
  try { const at = Number(localStorage.getItem(SUCCESS_KEY)); return at > 0 && Number.isFinite(at) ? at : null; } catch { return null; }
}
let unsavedSyncStatus: SyncStatus | null = null;

export function loadSyncStatus(): SyncStatus | null {
  if (SAMPLE_MODE) return null;
  if (unsavedSyncStatus) return unsavedSyncStatus;
  try {
    const raw = localStorage.getItem(STATUS_KEY);
    return raw ? (JSON.parse(raw) as SyncStatus) : null;
  } catch {
    return null;
  }
}

function saveSyncStatus(s: SyncStatus): void {
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify(s));
    if (s.ok) localStorage.setItem(SUCCESS_KEY, String(s.at));
    unsavedSyncStatus = null;
  } catch {
    unsavedSyncStatus = { ...s, persistenceFailed: true };
  }
  window.dispatchEvent(new Event('lifedash-sync-status'));
}

export interface SyncSettings {
  url: string;
  username: string;
  token: string;
}

const SETTINGS_KEY = 'lifedash-sync';
const COLLECTIONS = ['tasks', 'projects', 'habits', 'habitLogs', 'goals', 'notes', 'journal', 'focusSessions', 'attachments', 'automationRules', 'userRules', 'deviceSettings'] as const;
type Collection = (typeof COLLECTIONS)[number];

export function loadSyncSettings(): SyncSettings | null {
  if (SAMPLE_MODE) return null;
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
  if (SAMPLE_MODE) return;
  if (s) localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  else localStorage.removeItem(SETTINGS_KEY);
  // A new or removed sync account makes old upload-failure tallies stale.
  void resetAllAttachmentUploadFailures();
}

export async function register(url: string, username: string, password: string): Promise<string> {
  return authCall(url, 'register', username, password);
}

export async function login(url: string, username: string, password: string): Promise<string> {
  return authCall(url, 'login', username, password);
}

async function authCall(url: string, path: string, username: string, password: string): Promise<string> {
  if (SAMPLE_MODE) throw new Error('Sync is disabled in the sample-data sandbox.');
  const res = await fetch(`${url.replace(/\/$/, '')}/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

/** Best-effort server-side token revocation for Disconnect. Returns
 *  'revoked' only when the server confirmed it; 'unavailable' when the
 *  endpoint is missing (older server), the token was already invalid, or
 *  the server could not be reached - callers must still clear local
 *  settings and must not claim the session was ended. */
export async function logout(settings: SyncSettings): Promise<'revoked' | 'unavailable'> {
  if (SAMPLE_MODE) return 'unavailable';
  try {
    const res = await fetch(`${settings.url.replace(/\/$/, '')}/api/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.token}` },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? 'revoked' : 'unavailable';
  } catch {
    return 'unavailable';
  }
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
  if (SAMPLE_MODE) return;
  if (autoSyncStarted) return;
  autoSyncStarted = true;
  // A fresh launch is a natural retry point for stranded uploads.
  void resetAllAttachmentUploadFailures();
  installSyncHooks();
  window.addEventListener('focus', () => void runAutoSync());
  window.addEventListener('online', () => void runAutoSync());
  window.setInterval(() => void runAutoSync(), AUTO_INTERVAL_MS);
}

export function installSyncHooks(): void {
  if (SAMPLE_MODE) return;
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
        if (col === 'attachments') void resetAttachmentUploadFailure(id);
        scheduleSync();
      }, 0);
    };
    table.hook('creating', (_pk, obj) => mark((obj as { id: string }).id));
    table.hook('updating', (mods, pk) => {
      // uploadAttachmentBlob's blobOnServer:true write is bookkeeping; the
      // server already knows. Marking it dirty would push a redundant row.
      if (col === 'attachments' && Object.keys(mods as object).every((k) => k === 'blobOnServer')) return;
      mark(String(pk));
    });
    table.hook('deleting', (pk) => mark(String(pk), true));
  }
}

export async function dirtyCount(): Promise<number> {
  return db.syncmeta.where('key').startsWith('dirty:').count();
}

/**
 * Upload one attachment's blob to the server blob API, keyed by the Dexie
 * row id so both sides converge on one identity. Safe to retry: the server
 * answers an identical re-upload idempotently. Returns false offline or on
 * refusal; the row stays local and the next sync's backfill retries.
 */
export type BlobUploadOutcome = 'ok' | 'transient' | 'permanent' | 'unconfigured';

export async function uploadAttachmentBlob(att: Pick<Attachment, 'id' | 'taskId' | 'name'> & { blob: Blob }): Promise<BlobUploadOutcome> {
  if (SAMPLE_MODE) return 'unconfigured';
  try {
    const settings = loadSyncSettings();
    if (!settings) return 'unconfigured';
    const base = settings.url.replace(/\/$/, '');
    const q = `task_id=${encodeURIComponent(att.taskId)}&filename=${encodeURIComponent(att.name)}&id=${encodeURIComponent(att.id)}`;
    const res = await fetch(`${base}/api/attachments?${q}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.token}`, 'Content-Type': att.blob.type || 'application/octet-stream' },
      body: att.blob,
    });
    if (!res.ok) {
      // Gone task / conflicting bytes / invalid id never heal by retrying;
      // quota (413), auth hiccups and 5xx can.
      return (res.status === 404 || res.status === 409 || res.status === 422) ? 'permanent' : 'transient';
    }
    const body = (await res.json()) as { rev?: number };
    if (typeof body.rev === 'number') {
      await setMeta(revKey('attachments', att.id), body.rev);
      await db.syncmeta.delete(dirtyKey('attachments', att.id));
    }
    await db.attachments.update(att.id, { blobOnServer: true });
    return 'ok';
  } catch {
    return 'transient';
  }
}

interface BlobFailState { count: number; lastAt: number; permanent?: boolean }
const PERMANENT_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const BLOB_FAIL_KEY = (id: string) => `blobfail:${id}`;
/** Transient failures back off exponentially up to this gap between tries. */
const BLOB_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;

async function blobFailState(id: string): Promise<BlobFailState> {
  return ((await getMeta(BLOB_FAIL_KEY(id))) as BlobFailState | undefined) ?? { count: 0, lastAt: 0 };
}

/** Explicit retry path: a fresh local edit of the row clears its failure tally. */
export async function resetAttachmentUploadFailure(id: string): Promise<void> {
  await db.syncmeta.delete(BLOB_FAIL_KEY(id));
}

/** User-initiated retry: manual Sync now clears every upload-failure tally. */
export async function resetAllAttachmentUploadFailures(): Promise<void> {
  const rows = await db.syncmeta.where('key').startsWith('blobfail:').toArray();
  for (const r of rows) await db.syncmeta.delete(r.key);
}

/** Per-attachment upload state for honest UI (never trusted to the server). */
export async function attachmentUploadFailures(): Promise<Record<string, { permanent?: boolean }>> {
  const rows = await db.syncmeta.where('key').startsWith('blobfail:').toArray();
  const out: Record<string, { permanent?: boolean }> = {};
  for (const r of rows) out[r.key.slice('blobfail:'.length)] = (r.value as { permanent?: boolean }) ?? {};
  return out;
}

/** Blobs never ride the JSON sync protocol; metadata only. */
function pushData(col: Collection, data: unknown): unknown {
  if (col === 'attachments' && data && typeof data === 'object') {
    const { blob: _blob, ...rest } = data as Record<string, unknown>;
    return rest;
  }
  return data;
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

export async function syncNow(settings: SyncSettings, opts?: { retryFailedUploads?: boolean }): Promise<SyncResult> {
  if (SAMPLE_MODE) throw new Error('Sync is disabled in the sample-data sandbox.');
  installSyncHooks();
  if (opts?.retryFailedUploads) await resetAllAttachmentUploadFailures();
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
    changes.push({ collection: col, id, base_rev: baseRev, deleted: tomb, data: tomb ? {} : pushData(col, data) });
  }
  let pushed = 0;
  let conflicts = 0;
  let replaced = 0;
  // Stay below the server max of 1000; acknowledge each successful batch.
  for (let offset = 0; offset < changes.length; offset += 500) {
    const batch = changes.slice(offset, offset + 500);
    const res = await fetch(`${base}/api/changes`, { method: 'POST', headers, body: JSON.stringify({ changes: batch }) });
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
  // Blob backfill: locally created attachments carry bytes only in Dexie.
  // Upload a few per sync so agents and other devices can download them.
  // Failure handling: permanent refusals stop retrying (until the row is
  // edited, which clears the tally); transient failures back off
  // exponentially instead of burning every sync, and never strand the blob.
  try {
    const pending = await db.attachments
      .filter((a) => !!a.blob && a.blobOnServer !== true)
      .sortBy('createdAt');
    const eligible: (Attachment & { blob: Blob })[] = [];
    for (const a of pending) {
      const st = await blobFailState(a.id);
      if (st.permanent && Date.now() - st.lastAt < PERMANENT_RETRY_AFTER_MS) continue;
      const wait = Math.min(2 ** st.count * 60 * 1000, BLOB_BACKOFF_MAX_MS);
      if (st.count > 0 && Date.now() - st.lastAt < wait) continue;
      eligible.push(a as Attachment & { blob: Blob });
      if (eligible.length >= 5) break;
    }
    for (const a of eligible) {
      const outcome = await uploadAttachmentBlob(a);
      if (outcome === 'ok') {
        await db.syncmeta.delete(BLOB_FAIL_KEY(a.id));
      } else if (outcome !== 'unconfigured') {
        const st = await blobFailState(a.id);
        await setMeta(BLOB_FAIL_KEY(a.id), {
          count: st.count + 1, lastAt: Date.now(), permanent: outcome === 'permanent' || undefined,
        });
      }
    }
  } catch {
    /* older test doubles without an attachments table */
  }
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
    else {
      // Attachment metadata syncs without its blob; never let a pulled row
      // wipe the blob this device already holds.
      let data = e.data as Record<string, unknown>;
      if (col === 'attachments' && data.blob === undefined) {
        const existing = (await table.get(e.id)) as { blob?: unknown } | undefined;
        if (existing?.blob !== undefined) data = { ...data, blob: existing.blob };
      }
      await table.put(data as never);
    }
    await setMeta(revKey(col, e.id), e.rev);
    await db.syncmeta.delete(dirtyKey(col, e.id));
    if (col === 'automationRules' || col === 'userRules') {
      // Config lives in the localStorage cache the UI reads synchronously.
      await refreshAutomationFromSync();
    }
    if (col === 'deviceSettings' && !e.deleted && e.id === getDeviceId()) {
      // An agent (or another session) changed THIS device's settings.
      applyRemoteSettings(e.data as Record<string, unknown>);
    }
  } finally {
    applyingRemote = false;
  }
}
