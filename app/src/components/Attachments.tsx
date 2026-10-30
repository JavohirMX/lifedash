import { X, Paperclip } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { addAttachment, deleteAttachment } from '../repo';
import { loadSyncSettings, attachmentUploadFailures, resetAttachmentUploadFailure, uploadAttachmentBlob } from '../sync';
import { SAMPLE_MODE } from '../dev/sampleMode';
import type { Attachment } from '../types';

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function Thumb(props: { att: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  useEffect(() => {
    if (!props.att.blob || !props.att.mime.startsWith('image/')) return;
    setUrl(null); setPreviewFailed(false);
    try {
      const u = URL.createObjectURL(props.att.blob);
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    } catch { setPreviewFailed(true); }
  }, [props.att]);
  if (!url || previewFailed) return <Paperclip size={16} strokeWidth={1.75} className="att-icon" aria-label={previewFailed ? "Image preview unavailable" : "File attachment"} />;
  return <img src={url} alt={props.att.name} className="att-thumb" onError={() => setPreviewFailed(true)} />;
}

async function downloadAttachment(a: Attachment): Promise<void> {
  let blob = a.blob;
  if (!blob) {
    // Row synced here without its bytes: fetch the blob from the server.
    const settings = loadSyncSettings();
    if (!settings) throw new Error('no sync account');
    const base = settings.url.replace(/\/$/, '');
    const res = await fetch(`${base}/api/attachments/${encodeURIComponent(a.id)}/content`,
      { headers: { Authorization: `Bearer ${settings.token}` } });
    if (!res.ok) throw new Error(`blob fetch failed: ${res.status}`);
    blob = await res.blob();
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = a.name;
  try { link.click(); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 10_000); }
}

export default function Attachments(props: { taskId: string }) {
  return <TaskAttachments key={props.taskId} taskId={props.taskId} />;
}

function TaskAttachments(props: { taskId: string }) {
  const atts = useLiveQuery(() => db.attachments.where('taskId').equals(props.taskId).toArray(), [props.taskId]);
  const failures = useLiveQuery(() => attachmentUploadFailures(), []);
  // Without a sync account every attachment is local by design: no warning.
  const syncConfigured = !SAMPLE_MODE && loadSyncSettings() !== null;
  const inputRef = useRef<HTMLInputElement>(null);
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failedFile, setFailedFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  async function attach(file: File) {
    if (writing.current) return;
    writing.current = true; setBusy(true); setError(''); setStatus(`Saving ${file.name}…`);
    try {
      await addAttachment(props.taskId, file);
      setFailedFile(null); setStatus(`Saved ${file.name} on this device.`);
    } catch {
      setFailedFile(file); setStatus('');
      setError(`Couldn't save ${file.name}. Retry while this task stays open, or choose the file again later.`);
    } finally { writing.current = false; setBusy(false); }
  }

  async function retryUpload(id: string) {
    setError(''); setStatus('Retrying upload…');
    await resetAttachmentUploadFailure(id);
    const row = await db.attachments.get(id);
    if (!row?.blob) { setStatus(''); setError('The file is not saved on this device.'); return; }
    const outcome = await uploadAttachmentBlob(row as typeof row & { blob: Blob });
    if (outcome === 'ok') setStatus(`Uploaded ${row.name} to your sync server.`);
    else if (outcome === 'unconfigured') { setStatus(''); setError('Set up sync in Settings to upload this file.'); }
    else { setStatus(''); setError(`Couldn't upload ${row.name} yet. It is still saved on this device; Sync now retries.`); }
  }

  async function remove(id: string, name: string) {
    if (writing.current) return;
    writing.current = true; setBusy(true); setError(''); setStatus(`Removing ${name}…`);
    try { await deleteAttachment(id); setStatus(`Removed ${name}.`); }
    catch { setStatus(''); setError(`Couldn't remove ${name}. The attachment is still listed; try Remove again.`); }
    finally { writing.current = false; setBusy(false); }
  }

  async function download(a: Attachment) {
    setError(''); setStatus('');
    try {
      await downloadAttachment(a);
      setStatus(`Download requested for ${a.name}. Check your browser's downloads.`);
    } catch {
      setError(`Couldn't start downloading ${a.name}. The attachment is still saved; try Download again.`);
    }
  }

  return (
    <div className="subs task-attachments" aria-busy={busy}>
      <h3>Attachments</h3>
      <p className="attachment-feedback" role="status">{status}</p>
      {error && <p className="attachment-feedback" role="alert">{error}</p>}
      {failedFile && <button className="mini" disabled={busy} onClick={() => void attach(failedFile)}>Retry attachment</button>}
      {(atts ?? []).map((a) => {
        // Honest storage state: nothing shown once the bytes are safely on
        // the sync server; local-only and failed uploads say so plainly.
        const failed = failures?.[a.id];
        const localOnly = syncConfigured && !!a.blob && a.blobOnServer !== true;
        return (
        <div key={a.id} className="att-row">
          <Thumb att={a} />
          <button className="att-name att-open" title={`Download ${a.name}`} aria-label={`Download ${a.name}`} onClick={() => download(a)}>{a.name}</button>
          <span className="att-size">{fmtSize(a.byteSize)}</span>
          <button className="mini" title="Remove" aria-label={`Remove ${a.name}`} disabled={busy} onClick={() => void remove(a.id, a.name)}><X size={13} strokeWidth={2} /></button>
          {localOnly && !failed?.permanent && <span className="att-state" role="note">On this device only - uploads on the next sync.</span>}
          {failed?.permanent && (
            <span className="att-state att-state-warn" role="note">
              Couldn't upload to the sync server; on this device only.
              <button className="mini" disabled={busy} onClick={() => void retryUpload(a.id)}>Retry</button>
            </span>
          )}
        </div>
        );
      })}
      {failedFile && <button className="mini" disabled={busy} onClick={() => { setFailedFile(null); setError(''); }}>Discard failed selection</button>}
      <input disabled={busy || failedFile !== null} aria-label="Attach files"
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void attach(f);
          e.target.value = '';
        }}
      />
      <button className="mini" disabled={busy || failedFile !== null} onClick={() => inputRef.current?.click()}>Attach a file</button>
    </div>
  );
}
