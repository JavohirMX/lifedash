import './DataBackupDialog.css';
import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { createPortableBackup, loadBackupStatus, recordBackupDownload, verifyPortableBackup } from '../portableBackup';
import { loadSyncSettings, loadSyncStatus, loadLastSuccessfulSync } from '../sync';
import { SAMPLE_MODE } from '../dev/sampleMode';

export default function DataBackupDialog({ onClose }: { onClose: () => void }) {
  const panel = useDialogFocus<HTMLDivElement>(onClose);
  const writing = useRef(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [status, setStatus] = useState(loadBackupStatus);
  const sync = loadSyncSettings(), last = loadSyncStatus(), success = loadLastSuccessfulSync() ?? (last?.ok ? last.at : null);
  async function download() {
    if (writing.current) return;
    writing.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const json = await createPortableBackup();
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `lifedash-portable-${new Date().toISOString().slice(0,10)}.json`;
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      const remembered = recordBackupDownload(); setStatus(loadBackupStatus());
      setMessage(`Recovery check passed. Download requested; keep the file outside this browser.${remembered ? '' : ' Backup status could not be saved on this device.'}`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Backup could not be created.'); }
    finally { writing.current = false; setBusy(false); }
  }
  async function check(file: File) {
    if (writing.current) return;
    writing.current = true; setBusy(true); setError(''); setMessage('');
    try { await verifyPortableBackup(await file.text()); setMessage('File recovery check passed in a separate temporary database. Your current data and automation were not changed.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Recovery check failed.'); }
    finally { writing.current = false; setBusy(false); }
  }
  return <div className="palette-overlay" onClick={onClose}><div ref={panel} className="import-panel data-backup-panel" style={{gap: 0}} role="dialog" aria-modal="true" aria-label="Data & backups" onClick={e => e.stopPropagation()}>
    <div className="import-head"><h2>Data &amp; backups</h2><button className="icon-btn" aria-label="Close data and backups" onClick={onClose}><X size={18}/></button></div>
    <h3>This device</h3>
    <p>{SAMPLE_MODE ? 'Fictional sample data only.' : 'Records and files are stored in this browser. Clearing browser data can remove them.'}</p>
    <p>{sync ? 'Self-hosted sync is configured.' : 'Sync is not configured on this device.'} {last ? `Last sync attempt: ${new Date(last.at).toLocaleString()} - ${last.ok ? 'successful' : 'failed'}.` : 'No sync result recorded.'} {success ? `Last recorded successful sync: ${new Date(success).toLocaleString()}.` : 'No successful sync recorded on this device.'}</p>
    <p className="settings-help">Sync shares tasks, projects, habits, habit logs, goals, notes and journal. Attachment files, focus history and automation stay on this device.</p>
    <h3>Portable backup</h3>
    <p>Includes records, attachment files, focus history and automation. Excludes sign-ins, appearance and browser preferences. Up to 100 MB of files.</p>
    <p className="settings-help">{status ? `Last download requested: ${new Date(status.at).toLocaleString()}. Its generated contents passed an isolated recovery check.` : 'No portable backup download recorded on this device.'} A download request does not prove the file was saved.</p>
    <button className="btn-primary" disabled={busy} onClick={() => void download()}>{busy ? 'Checking…' : 'Download portable backup'}</button>
    <label className="field" style={{marginTop:16}}><span>Check an existing portable backup</span><input aria-label="Check portable backup" type="file" accept=".json" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void check(file); e.target.value = ''; }}/></label>
    <p className="settings-help">Checks restore into a temporary database and remove it afterward. To merge into this device, use Restore backup.</p>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="form-save-error">{error}</p>}
  </div></div>;
}
