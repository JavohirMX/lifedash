import { SAMPLE_MODE } from '../dev/sampleMode';
import { useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { checkSyncUrl, syncFailureMessage } from '../syncFormFeedback';
import './SyncDialog.css';
import { ArrowLeft, X } from 'lucide-react';
import {
  loadSyncSettings,
  loadSyncStatus,
  login,
  logout,
  register,
  saveSyncSettings,
  syncNow,
  type SyncSettings,
} from '../sync';

export default function SyncDialog(props: { onClose: () => void; onBack?: () => void }) {
  const existing = loadSyncSettings();
  const [url, setUrl] = useState(existing?.url ?? '');
  const [username, setUsername] = useState(existing?.username ?? '');
  const [password, setPassword] = useState('');
  const [settings, setSettings] = useState<SyncSettings | null>(existing);
  const [status, setStatus] = useState('');
  const statusSource = useRef<'auth' | 'sync' | 'disconnect' | null>(null);
  const [localClearFailed, setLocalClearFailed] = useState(false);
  const revokedSession = useRef<string | null>(null);
  const [feedback, setFeedback] = useState<'status'|'error'>('status');
  const [urlError,setUrlError]=useState('');
  const [authAction,setAuthAction]=useState<'login'|'register'|null>(null);
  const urlInput=useRef<HTMLInputElement>(null);
  const [last, setLast] = useState(loadSyncStatus);
  useEffect(() => {
    const refresh = () => { setLast(loadSyncStatus()); if (statusSource.current === 'sync') setStatus(''); };
    window.addEventListener('lifedash-sync-status', refresh);
    return () => window.removeEventListener('lifedash-sync-status', refresh);
  }, []);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);

  const panel = useDialogFocus<HTMLDivElement>(props.onClose, existing ? undefined : 'input[type="url"]');

  const fail = (e: unknown, action:'login'|'register'|'sync') => { setFeedback('error'); setStatus(syncFailureMessage(e,action)); };

  async function doAuth(kind: 'login' | 'register') {
    if (working.current) return;
    const issue=checkSyncUrl(url);
    if(issue){setUrlError(issue);setFeedback('error');setStatus('');urlInput.current?.focus();return;}
    working.current = true;
    statusSource.current = 'auth';
    setUrlError('');setAuthAction(kind);setFeedback('status');
    setBusy(true);
    setStatus(kind==='login'?'Signing in…':'Creating account…');
    try {
      const fn = kind === 'login' ? login : register;
      const token = await fn(url.trim(), username.trim(), password);
      const s = { url:url.trim(), username:username.trim(), token };
      saveSyncSettings(s);
      setSettings(s);
      setPassword('');
      setStatus(kind === 'login' ? 'Signed in.' : 'Account created and signed in.');
    } catch (e) {
      fail(e,kind);
    } finally {
      working.current = false;setBusy(false);setAuthAction(null);
    }
  }

  async function doSync() {
    if (!settings || working.current) return;
    statusSource.current = 'sync';
    working.current = true;
    setBusy(true);
    setFeedback('status');setStatus('Syncing...');
    try {
      await syncNow(settings, { retryFailedUploads: true });
      // syncNow persists the notice-aware summary: it keeps the
      // unacknowledged server-wins conflict count even when this run
      // itself pushed/pulled nothing. Show exactly what was saved.
      const saved = loadSyncStatus();
      setStatus(saved && saved.ok ? `Done: ${saved.summary}.` : 'Done.');
    } catch (e) {
      fail(e,'sync');
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!settings || working.current) return;
    statusSource.current = 'disconnect';
    working.current = true;
    setBusy(true);setFeedback('status');
    try {
      const result = await logout(settings);
      const sessionKey = JSON.stringify([settings.url, settings.token]);
      if (result === 'revoked') revokedSession.current = sessionKey;
      const revoked = revokedSession.current === sessionKey;
      try {
        saveSyncSettings(null);
      } catch {
        setLocalClearFailed(true);
        setFeedback('error');
        setStatus(revoked
          ? 'The server ended the session, but this device could not clear its saved sync settings. Try Disconnect again to clear them.'
          : 'The server did not confirm logout, and this device could not clear its saved sync settings. Try Disconnect again. The saved token may still be valid on the server.');
        return;
      }
      setLocalClearFailed(false);
      setSettings(null);
      setStatus(
        revoked
          ? 'Disconnected - the server ended the session.'
          : 'Disconnected on this device. The server did not confirm logout, so the saved token may still be valid there.',
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  if (SAMPLE_MODE) return (
    <div className="palette-overlay" onClick={props.onClose}>
      <div ref={panel} className="import-panel sync-panel" role="dialog" aria-modal="true" aria-label="Sync" onClick={e => e.stopPropagation()}>
        <button className="icon-btn" aria-label="Close" onClick={props.onClose}><X size={18} /></button>
        {props.onBack && <button className="btn-secondary" onClick={props.onBack}>Back to Settings</button>}
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
          <div className="settings-child-title" style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>{props.onBack && <button className="icon-btn" aria-label="Back to Settings" onClick={props.onBack}><ArrowLeft size={18} /></button>}<h2>Sync</h2></div>
          <button className="icon-btn" aria-label="Close" onClick={props.onClose}><X size={18} strokeWidth={1.75} /></button>
        </div>
        {!settings ? (
          <>
            <p className="rule-note">
              Connect to your own Lifedash sync server. Registration closes after the first account by default.
            </p>
            <p className="rule-note"><a href="./selfhost.html" target="_blank" rel="noreferrer">Self-host setup guide (opens in a new tab)</a></p>
            <label className="field">
              <span>Server URL</span>
              <input ref={urlInput} aria-invalid={!!urlError} aria-describedby={urlError?'sync-url-error':undefined} type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" value={url} onChange={(e) => {setUrl(e.target.value);if(urlError)setUrlError('');}} placeholder="https://sync.example.com" />
            </label>
            {urlError && <p id="sync-url-error" className="sync-feedback-error" role="alert">{urlError}</p>}
            <form noValidate
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
                <button type="submit" className="btn-primary" disabled={busy || !url || !username || password.length < 8}>{authAction==='login'?'Signing in…':'Sign in'}</button>
                <button type="button" className="btn-secondary" disabled={busy || !url || !username || password.length < 8} onClick={() => void doAuth('register')}>{authAction==='register'?'Creating account…':'Create account'}</button>
              </div>
            </form>
          </>
        ) : (
          <>
            <p className="rule-note">
              {localClearFailed ? 'Saved sync settings for ' : 'Connected to '}<strong>{settings.url}</strong> as <strong>{settings.username}</strong>.
            </p>
            <div className="sync-actions">
              <button className="btn-primary" disabled={busy} onClick={() => void doSync()}>Sync now</button>
              <button className="btn-secondary" disabled={busy} onClick={() => void disconnect()}>Disconnect</button>
            </div>
          </>
        )}
        {status && <p className={`sync-status${feedback==='error'?' sync-feedback-error':''}`} role={feedback==='error'?'alert':'status'}>{status}</p>}
        {last?.persistenceFailed && <p className="sync-feedback-error" role="alert">The latest sync status could not be saved on this device. It is kept for this page only. This does not change the sync result.</p>}
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
