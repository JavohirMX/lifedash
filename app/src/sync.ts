import { SAMPLE_MODE } from './dev/sampleMode';
import { syncFailureMessage } from './syncFormFeedback';
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

/** A pulled entity whose payload can never be applied as delivered
 * (contradictory or non-object data). Distinct from transient store
 * failures: malformed payloads are quarantined and skipped; anything
 * else aborts the pull so the cursor keeps covering it for retry. */
class MalformedEntityError extends Error {}

const QUARANTINE_PREFIX = 'quarantine:';
const QUARANTINE_MAX = 20;

export interface QuarantinedEntity {
  collection: string;
  id: string;
  rev: number;
  data: unknown;
  reason: string;
  at: number;
}

// Stored payloads are capped so one huge blob cannot crowd out everything
// else: over the limit the record keeps the size, not the bytes.
const QUARANTINE_PAYLOAD_MAX_BYTES = 64 * 1024;

export interface QuarantineOverflow {
  count: number;
  lastCollection: string;
  lastId: string;
  lastReason: string;
  lastAt: number;
}
const QUARANTINE_OVERFLOW_KEY = 'quarantine-overflow';

/** Eviction tally: how many quarantined entities were dropped to stay
 * within the cap, with the most recent reason. The overflow record is the
 * durable trace; the quarantine itself is a bounded recent-failure buffer,
 * not unlimited recovery. */
export async function loadSyncQuarantineOverflow(): Promise<QuarantineOverflow | null> {
  return ((await getMeta(QUARANTINE_OVERFLOW_KEY)) as QuarantineOverflow | undefined) ?? null;
}

async function quarantineEntity(col: Collection, e: ServerEntity, reason: string): Promise<boolean> {
  let data: unknown = e.deleted ? null : e.data;
  let truncated = false;
  if (data !== null) {
    const bytes = JSON.stringify(data)?.length ?? 0;
    if (bytes > QUARANTINE_PAYLOAD_MAX_BYTES) {
      truncated = true;
      data = { truncated: true, bytes, note: 'Payload too large to keep whole; only its size is recorded.' };
    }
  }
  await setMeta(QUARANTINE_PREFIX + col + ':' + e.id, {
    collection: col, id: e.id, rev: e.rev, data, reason, at: Date.now(),
  } satisfies QuarantinedEntity);
  // Bound the quarantine so a broken peer cannot grow storage without limit.
  const rows = await db.syncmeta.where('key').startsWith(QUARANTINE_PREFIX).toArray();
  if (rows.length > QUARANTINE_MAX) {
    const oldestFirst = rows
      .map((r) => ({ key: r.key as string, at: (r.value as QuarantinedEntity).at ?? 0 }))
      .sort((a, b) => a.at - b.at);
    const evicted = oldestFirst.slice(0, rows.length - QUARANTINE_MAX);
    for (const row of evicted) {
      await db.syncmeta.delete(row.key);
    }
    const prior = await loadSyncQuarantineOverflow();
    const lastRow = evicted[evicted.length - 1];
    await setMeta(QUARANTINE_OVERFLOW_KEY, {
      count: (prior?.count ?? 0) + evicted.length,
      lastCollection: col,
      lastId: e.id,
      lastReason: reason,
      lastAt: lastRow ? (rows.find((r) => r.key === lastRow.key)?.value as QuarantinedEntity)?.at ?? Date.now() : Date.now(),
    } satisfies QuarantineOverflow);
  }
  return truncated;
}

/** Pulled entities that could not be applied and were kept for review. */
export async function loadSyncQuarantine(): Promise<QuarantinedEntity[]> {
  const rows = await db.syncmeta.where('key').startsWith(QUARANTINE_PREFIX).toArray();
  return rows.map((r) => r.value as QuarantinedEntity);
}

/** Drop one quarantined entity, e.g. after it was re-expressed locally. */
export async function removeFromSyncQuarantine(collection: string, id: string): Promise<void> {
  await db.syncmeta.delete(QUARANTINE_PREFIX + collection + ':' + id);
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
    saveSyncStatus({ at: Date.now(), ok: true, summary: await summaryWithNotice(r) });
  } catch (e) {
    saveSyncStatus({ at: Date.now(), ok: false, summary: syncFailureMessage(e, 'sync') });
    console.warn('auto-sync failed', e);
  }
}

function summaryOf(r: SyncResult): string {
  const parts = [`pushed ${r.pushed}`, `pulled ${r.pulled}`];
  if (r.conflicts) parts.push(`${r.conflicts} conflict${r.conflicts === 1 ? '' : 's'} (server won)`);
  if (r.skipped) {
    const kept = r.skipped - (r.skippedTruncated ?? 0);
    if (kept === r.skipped) parts.push(`${r.skipped} skipped (kept for review)`);
    else if (kept === 0) parts.push(`${r.skipped} skipped (recorded by size only)`);
    else parts.push(`${r.skipped} skipped (${kept} kept for review, ${r.skippedTruncated} recorded by size only)`);
  }
  return parts.join(', ');
}

/**
 * Status-line summary for persisting. A later idle sync reports
 * "pushed 0, pulled 0"; saving that verbatim would erase awareness of a
 * still-unacknowledged server-wins conflict, so the summary keeps the
 * outstanding notice count until the user dismisses the banner. The
 * outstanding count is worded as earlier activity awaiting review so an
 * idle run never reads as if the conflict happened in that run
 * (product decision, 2026-10-30).
 */
async function summaryWithNotice(r: SyncResult): Promise<string> {
  const notice = await getConflictNotice();
  const outstanding = Math.max(0, (notice?.count ?? 0) - r.conflicts);
  const base = summaryOf(r);
  if (!outstanding) return base;
  return `${base}, ${outstanding} earlier conflict${outstanding === 1 ? '' : 's'} (server won) awaiting review`;
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
      // Gone task / conflicting bytes / invalid id need attention, not
      // automatic retry; auth hiccups and 5xx can heal by retrying.
      if (res.status === 404 || res.status === 409 || res.status === 422) return 'permanent';
      // 413 splits two ways: quota refusals heal when space frees (stay
      // transient), while per-file-size refusals need attention until the
      // server limit changes. Newer servers say which with a structured
      // reason; older servers send a plain-string detail, which stays
      // transient - never parse prose.
      if (res.status === 413 && await isFileTooLargeRefusal(res)) return 'permanent';
      return 'transient';
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

/**
 * Prompt blob upload at attach time, but only when the parent task is
 * already on the server. Attaching to a not-yet-synced task and uploading
 * immediately makes the server reject the blob with a 422 (unknown task):
 * the metadata-first completion path owns that case instead - the push
 * announces the metadata and the next sync backfill completes the upload.
 * Returns true when the prompt upload was attempted.
 */
export async function promptAttachmentUploadIfTaskSynced(att: Pick<Attachment, 'id' | 'taskId' | 'name'> & { blob: Blob }): Promise<boolean> {
  const taskSynced = (await getMeta(revKey('tasks', att.taskId))) !== undefined;
  if (!taskSynced) return false;
  void uploadAttachmentBlob(att);
  return true;
}

/** Structured per-file-size refusal from newer servers; anything else is not. */
async function isFileTooLargeRefusal(res: Response): Promise<boolean> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    return (body?.detail as { reason?: unknown } | undefined)?.reason === 'attachment_file_too_large';
  } catch {
    return false;
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

/**
 * Persist one refused upload attempt's classification. The backfill loop
 * and the manual per-file Retry both call this so a refused retry cannot
 * leave the row looking queued for guaranteed upload (product decision,
 * 2026-10-30).
 */
export async function recordAttachmentUploadFailure(id: string, outcome: 'transient' | 'permanent'): Promise<void> {
  const st = await blobFailState(id);
  await setMeta(BLOB_FAIL_KEY(id), {
    count: st.count + 1, lastAt: Date.now(), permanent: outcome === 'permanent' || undefined,
  });
}

/**
 * Manual per-file retry: clear the tally, re-attempt the upload, and
 * record a refusal so the row keeps its truthful failure state.
 * 'missing' means the row or its bytes are gone locally.
 */
export async function retryAttachmentUpload(id: string): Promise<BlobUploadOutcome | 'missing'> {
  await resetAttachmentUploadFailure(id);
  const row = await db.attachments.get(id);
  if (!row?.blob) return 'missing';
  const outcome = await uploadAttachmentBlob(row as Attachment & { blob: Blob });
  if (outcome !== 'ok' && outcome !== 'unconfigured') await recordAttachmentUploadFailure(id, outcome);
  return outcome;
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
  /** Pulled entities that could not be applied and were skipped. */
  skipped?: number;
  /** Of skipped: quarantined by size only because the payload was too large to keep whole. */
  skippedTruncated?: number;
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
    saveSyncStatus({ at: Date.now(), ok: true, summary: await summaryWithNotice(r) });
    return r;
  } catch (e) {
    // A thrown sync must not leave the last success standing as if current.
    saveSyncStatus({ at: Date.now(), ok: false, summary: syncFailureMessage(e, 'sync') });
    throw e;
  } finally {
    syncing = false;
  }
}

async function syncNowInner(settings: SyncSettings): Promise<SyncResult> {
  const base = settings.url.replace(/\/$/, '');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.token}` };

  // Pull first so base_revs are fresh.
  const pull1 = await pull(base, headers);
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
  const pull2 = await pull(base, headers);
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
        await recordAttachmentUploadFailure(a.id, outcome);
      }
    }
  } catch {
    /* older test doubles without an attachments table */
  }
  // Server-wins drops the conflicting local edits: keep a persistent notice
  // so an auto-sync cannot erase awareness before the user sees it.
  await recordConflicts(replaced);
  return { pushed, conflicts, pulled: pull1.applied + pull2.applied, skipped: pull1.skipped + pull2.skipped, skippedTruncated: pull1.skippedTruncated + pull2.skippedTruncated, cursor: await getCursor() };
}

async function pull(base: string, headers: Record<string, string>): Promise<{ applied: number; skipped: number; skippedTruncated: number }> {
  const since = await getCursor();
  const res = await fetch(`${base}/api/changes?since=${since}`, { headers });
  if (!res.ok) throw new Error(`pull failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { changes: ServerEntity[]; rev: number };
  let applied = 0;
  let skipped = 0;
  let skippedTruncated = 0;
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
    try {
      await applyRemote(col, e);
      applied += 1;
    } catch (err) {
      // Only a provably malformed payload is skipped: it is quarantined
      // with its payload for review and the cursor advances past it.
      // Anything else (quota, transient IndexedDB failure, ...) rethrows,
      // aborting the pull BEFORE the cursor advances, so the next sync
      // retries the entity instead of silently losing it.
      if (!(err instanceof MalformedEntityError)) throw err;
      skipped += 1;
      if (await quarantineEntity(col, e, err.message)) skippedTruncated += 1;
      console.warn('sync: quarantined an unreadable entity', col, e.id, err);
    }
  }
  await setMeta('cursor', body.rev);
  return { applied, skipped, skippedTruncated };
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
      // The server keys the blob externally; the local table keys rows by
      // their inline id. Realign a blob that lost its id, and refuse one
      // that contradicts its key or is not an object at all: those can
      // never apply as delivered, so the pull loop quarantines and skips
      // them instead of retrying forever.
      if (!data || typeof data !== 'object') {
        throw new MalformedEntityError(`sync: entity data is not an object (key ${e.id})`);
      }
      if (data.id === undefined) data = { ...data, id: e.id };
      else if (data.id !== e.id) throw new MalformedEntityError(`sync: entity id mismatch (key ${e.id}, data id ${String(data.id)})`);
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
