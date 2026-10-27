import { SAMPLE_MODE } from '../dev/sampleMode';
import { useState } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { X } from 'lucide-react';
import {
  loadSyncSettings,
  loadSyncStatus,
  login,
  logout,
  register,
  saveSyncSettings,
  syncNow,
  type SyncResult,
  type SyncSettings,
} from '../sync';

export default function SyncDialog(props: { onClose: () => void }) {
  const existing = loadSyncSettings();
  const [url, setUrl] = useState(existing?.url ?? '');
  const [username, setUsername] = useState(existing?.username ?? '');
  const [password, setPassword] = useState('');
  const [settings, setSettings] = useState<SyncSettings | null>(existing);
  const [status, setStatus] = useState('');
  const last = loadSyncStatus();
  const [busy, setBusy] = useState(false);

  const panel = useDialogFocus<HTMLDivElement>(props.onClose, existing ? undefined : 'input[type="url"]');

  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    setStatus(msg === 'Failed to fetch' ? "Couldn't reach the server - check the URL and that it's running." : msg);
  };

  async function doAuth(kind: 'login' | 'register') {
    setBusy(true);
    setStatus('');
    try {
      const fn = kind === 'login' ? login : register;
      const token = await fn(url, username, password);
      const s = { url, username, token };
      saveSyncSettings(s);
      setSettings(s);
      setPassword('');
      setStatus(kind === 'login' ? 'Signed in.' : 'Account created and signed in.');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function doSync() {
    if (!settings) return;
    setBusy(true);
    setStatus('Syncing...');
    try {
      const r: SyncResult = await syncNow(settings);
      const parts = [`pushed ${r.pushed}`, `pulled ${r.pulled}`];
      if (r.conflicts) parts.push(`${r.conflicts} conflict${r.conflicts === 1 ? '' : 's'} (server won)`);
      setStatus(`Done: ${parts.join(', ')}.`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!settings) return;
    setBusy(true);
    try {
      const result = await logout(settings);
      setStatus(
        result === 'revoked'
          ? 'Disconnected - the server ended the session.'
          : 'Disconnected on this device. The server did not confirm logout (older server or unreachable), so the token stays valid there - tokens do not expire in v1.',
      );
    } finally {
      saveSyncSettings(null);
      setSettings(null);
      setBusy(false);
    }
  }

  if (SAMPLE_MODE) return (
    <div className="overlay" onClick={props.onClose}>
      <div className="import-panel sync-panel" role="dialog" aria-modal="true" aria-label="Sync" onClick={e => e.stopPropagation()}>
        <button className="icon-btn" aria-label="Close" onClick={props.onClose}><X size={18} /></button>
        <h2>Sample-data sandbox</h2>
        <p>Automatic sync is disabled in the sample-data sandbox, and the sandbox never uses your real sync account.</p>
        <p className="rule-note">Export and AI tools remain available. Only use fictional test content here.</p>
      </div>
    </div>
  );

  return (
    <div className="palette-overlay" onClick={props.onClose}>
      <div ref={panel} className="import-panel sync-panel" role="dialog" aria-modal="true" aria-label="Sync" onClick={(e) => e.stopPropagation()}>
        <div className="import-head">
          <h2>Sync</h2>
          <button className="icon-btn" aria-label="Close" onClick={props.onClose}><X size={18} strokeWidth={1.75} /></button>
        </div>
        {!settings ? (
          <>
            <p className="rule-note">
              Connect to a self-hosted Lifedash sync server. Your tasks, projects and habits stay on your own server; registration closes after the first account.
            </p>
            <label className="field">
              <span>Server URL</span>
              <input type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://sync.example.com" />
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy && url && username && password.length >= 8) void doAuth('login');
              }}
            >
              <label className="field">
                <span>Username</span>
                <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
              </label>
              <label className="field">
                <span>Password (8+ characters)</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </label>
              <div className="sync-actions">
                <button type="submit" className="btn-primary" disabled={busy || !url || !username || password.length < 8}>Sign in</button>
                <button type="button" className="btn-secondary" disabled={busy || !url || !username || password.length < 8} onClick={() => void doAuth('register')}>Create account</button>
              </div>
            </form>
          </>
        ) : (
          <>
            <p className="rule-note">
              Connected to <strong>{settings.url}</strong> as <strong>{settings.username}</strong>.
            </p>
            <div className="sync-actions">
              <button className="btn-primary" disabled={busy} onClick={() => void doSync()}>Sync now</button>
              <button className="btn-secondary" disabled={busy} onClick={() => void disconnect()}>Disconnect</button>
            </div>
          </>
        )}
        {status && <p className="sync-status" role="status">{status}</p>}
        {!status && last && (
          <p className="sync-status">
            Last synced {new Date(last.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            {last.ok ? ` - ${last.summary}` : ` - failed: ${last.summary}`}
          </p>
        )}
      </div>
    </div>
  );
}
