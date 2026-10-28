import Dexie from 'dexie';
import { db } from './db';
import { exportAutomation } from './automation';
import { hasProjectCycle } from './projects';
import type { Project } from './types';
import { SAMPLE_MODE } from './dev/sampleMode';

export const RECORD_TABLES = ['projects', 'tasks', 'habits', 'habitLogs', 'goals', 'notes', 'journal', 'focusSessions'] as const;
export const BACKUP_TABLES = [...RECORD_TABLES, 'attachments'] as const;
const MAX_BYTES = 100 * 1024 * 1024;
type Row = Record<string, unknown> & { id: string };
export type PortableData = Record<string, unknown> & { version: 3; format: 'lifedash-portable'; attachments: Row[] };
function fail(): never { throw new Error('Invalid or damaged portable backup. Nothing was restored.'); }
function bytesToBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
async function sha(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function decodePortable(data: Record<string, unknown>): Promise<Record<string, Row[]>> {
  if (data.version !== 3 || data.format !== 'lifedash-portable') fail();
  const automation = data.automation as { rules?: { rollover?: unknown; completeParent?: unknown }; userRules?: unknown[] } | undefined;
  if (!automation || typeof automation.rules?.rollover !== 'boolean' || typeof automation.rules.completeParent !== 'boolean' || !Array.isArray(automation.userRules)) fail();
  for (const rule of automation.userRules) {
    if (!rule || typeof rule !== 'object') fail();
    const r = rule as Record<string, any>;
    if (typeof r.id !== 'string' || !r.id || typeof r.title !== 'string' || !r.title.trim() || !Number.isFinite(r.createdAt) || !(r.lastFired === null || typeof r.lastFired === 'string') || !r.trigger
      || !(r.trigger.kind === 'tag' && typeof r.trigger.tag === 'string' && r.trigger.tag.trim() || r.trigger.kind === 'weekly' && Number.isInteger(r.trigger.weekday) && r.trigger.weekday >= 0 && r.trigger.weekday <= 6)) fail();
  }
  const records: Record<string, Row[]> = {};
  for (const table of BACKUP_TABLES) {
    const rows = data[table];
    if (!Array.isArray(rows)) fail();
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id || seen.has(row.id)) fail();
      seen.add(row.id);
    }
    records[table] = rows as Row[];
  }
  if (hasProjectCycle(records.projects as unknown as Project[])) fail();
  let total = 0;
  records.attachments = await Promise.all(records.attachments.map(async row => {
    if (typeof row.base64 !== 'string' || typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)
      || !Number.isSafeInteger(row.byteSize) || (row.byteSize as number) < 0 || typeof row.name !== 'string'
      || typeof row.mime !== 'string' || typeof row.taskId !== 'string') fail();
    total += row.byteSize as number;
    if (total > MAX_BYTES || row.base64.length > Math.ceil((row.byteSize as number) / 3) * 4) fail();
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(row.base64), c => c.charCodeAt(0)); } catch { fail(); }
    if (bytes.length !== row.byteSize || bytesToBase64(bytes) !== row.base64 || await sha(bytes) !== row.sha256) fail();
    const { base64: _base64, sha256: _sha, ...meta } = row;
    return { ...meta, blob: new Blob([bytes], { type: row.mime as string }) } as Row;
  }));
  return records;
}

/** Snapshot all data together. Encoding happens after IndexedDB releases the transaction. */
export async function createPortableBackup(): Promise<string> {
  const snapshot = await db.transaction('r', BACKUP_TABLES.map(t => db.table(t)), async () => {
    const entries = await Promise.all(BACKUP_TABLES.map(async t => [t, await db.table(t).toArray()] as const));
    return Object.fromEntries(entries);
  });
  const automation = exportAutomation();
  let total = 0;
  for (const row of snapshot.attachments) {
    if (!(row.blob instanceof Blob)) throw new Error('An attachment file is missing on this device. No complete backup was created.');
    total += row.blob.size;
    if (total > MAX_BYTES) throw new Error('Portable backup supports up to 100 MB of attachment files. No backup was created.');
  }
  const attachments = await Promise.all(snapshot.attachments.map(async ({ blob, ...meta }) => {
    const bytes = new Uint8Array(await (blob as Blob).arrayBuffer());
    if (bytes.length !== meta.byteSize) throw new Error('An attachment size does not match its saved record. No backup was created.');
    return { ...meta, base64: bytesToBase64(bytes), sha256: await sha(bytes) };
  }));
  const json = JSON.stringify({ ...snapshot, attachments, automation, version: 3, format: 'lifedash-portable', exportedAt: new Date().toISOString() });
  await verifyPortableBackup(json);
  return json;
}

/** Recover into a unique temporary database, read back every record/file, then remove it. */
export async function verifyPortableBackup(json: string): Promise<void> {
  const data = JSON.parse(json) as Record<string, unknown>;
  const decoded = await decodePortable(data);
  const recovery = new Dexie(`lifedash-recovery-check-${crypto.randomUUID()}`);
  recovery.version(1).stores({ ...Object.fromEntries(BACKUP_TABLES.map(t => [t, 'id'])), settings: 'id' });
  try {
    await recovery.transaction('rw', recovery.tables, async () => {
      for (const t of BACKUP_TABLES) await recovery.table(t).bulkPut(decoded[t]);
      await recovery.table('settings').put({ id: 'automation', value: data.automation ?? null });
    });
    if (JSON.stringify((await recovery.table('settings').get('automation')).value) !== JSON.stringify(data.automation ?? null)) throw new Error('Recovery check automation mismatch.');
    for (const t of BACKUP_TABLES) {
      const actual = await recovery.table(t).toArray();
      const expected = decoded[t];
      if (actual.length !== expected.length) throw new Error('Recovery check record count mismatch.');
      for (const row of expected) {
        const found = actual.find(a => a.id === row.id);
        if (!found) throw new Error('Recovery check record missing.');
        const { blob, ...meta } = row;
        const { blob: actualBlob, ...actualMeta } = found;
        if (JSON.stringify(meta) !== JSON.stringify(actualMeta)) throw new Error('Recovery check record mismatch.');
        if (blob instanceof Blob && (!(actualBlob instanceof Blob) || await sha(new Uint8Array(await blob.arrayBuffer())) !== await sha(new Uint8Array(await actualBlob.arrayBuffer())))) throw new Error('Recovery check attachment mismatch.');
      }
    }
  } finally { recovery.close(); await recovery.delete(); }
}
const STATUS_KEY = SAMPLE_MODE ? 'lifedash-sample-backup-status' : 'lifedash-backup-status';
export interface BackupStatus { at: number; verifiedAt: number; }
export function loadBackupStatus(): BackupStatus | null {
  try { const v = JSON.parse(localStorage.getItem(STATUS_KEY) ?? 'null'); return v && Number.isFinite(v.at) && Number.isFinite(v.verifiedAt) ? v : null; } catch { return null; }
}
export function recordBackupDownload(): boolean {
  try { const at = Date.now(); localStorage.setItem(STATUS_KEY, JSON.stringify({ at, verifiedAt: at })); return true; } catch { return false; }
}
