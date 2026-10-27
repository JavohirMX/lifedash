import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyncSettings } from '../sync';
import { SAMPLE_MODE } from '../dev/sampleMode';
import {
  GOOGLE_SCOPE_COPY,
  GoogleCalendarError,
  googleConnectUrl,
  googleDisconnect,
  googleStatus,
  type GoogleStatus,
} from '../googleCalendar';

/**
 * Optional Google Calendar connection preparation. Not mounted anywhere yet: the owner of the
 * combined app chooses where it lives. It talks only to the user's own sync server.
 */
export type PanelState =
  | { kind: 'sample' }
  | { kind: 'signed_out' }
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'disconnected' }
  | { kind: 'connected'; connectedAt: string | null }
  | { kind: 'reconnect' }
  | { kind: 'error'; message: string };

export function stateFromStatus(s: GoogleStatus): PanelState {
  if (!s.available) return { kind: 'unavailable' };
  if (s.connected) return { kind: 'connected', connectedAt: s.connectedAt };
  return { kind: 'disconnected' };
}

export function stateFromError(e: unknown): PanelState {
  if (e instanceof GoogleCalendarError) {
    if (e.kind === 'reconnect') return { kind: 'reconnect' };
    if (e.kind === 'unavailable') return { kind: 'unavailable' };
    return { kind: 'error', message: e.message };
  }
  return { kind: 'error', message: 'Something went wrong.' };
}

function since(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : ` since ${d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`;
}

export function GoogleCalendarView(props: {
  state: PanelState;
  busy?: boolean;
  notice?: string | null;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onRetry?: () => void;
}) {
  const { state, busy = false, notice = null } = props;
  return (
    <section className="gcal-panel" aria-label="Google Calendar">
      <h3>Google Calendar (optional, read-only)</h3>
      {state.kind === 'sample' && <p className="rule-note">Turned off in the sample-data sandbox. It never uses a real account here.</p>}
      {state.kind === 'signed_out' && <p className="rule-note">Sign in to your sync server first. Google Calendar runs through your own server.</p>}
      {state.kind === 'loading' && <p className="rule-note" role="status">Checking your server…</p>}
      {state.kind === 'unavailable' && (
        <p className="rule-note">Not set up on your sync server. The server owner has to add their own Google credentials first (see google-calendar.md in the server docs). Nothing is sent to Google until then.</p>
      )}
      {(state.kind === 'disconnected' || state.kind === 'connected' || state.kind === 'reconnect') && (
        <>
          <p className="rule-note">Connection preparation for your primary Google calendar, read-only. Event display is not wired into Lifedash yet.</p>
          <ul className="gcal-limits">
            {GOOGLE_SCOPE_COPY.limits.filter(l => !l.startsWith('Not a sync.')).map((l) => <li key={l}>{l}</li>)}
          </ul>
        </>
      )}
      {state.kind === 'connected' && <p className="rule-note" role="status">Connected{since(state.connectedAt)}.</p>}
      {state.kind === 'reconnect' && <p className="rule-note" role="alert">Google access has expired or was removed. Connect again to restore read-only access.</p>}
      {state.kind === 'error' && <p className="rule-note" role="alert">{state.message}</p>}
      {notice && <p className="rule-note" role="status">{notice}</p>}
      <div className="sync-actions">
        {(state.kind === 'disconnected' || state.kind === 'reconnect') && (
          <button className="btn-primary" disabled={busy} onClick={props.onConnect}>{state.kind === 'reconnect' ? 'Reconnect Google' : 'Connect Google (read-only)'}</button>
        )}
        {state.kind === 'connected' && <button className="btn-secondary" disabled={busy} onClick={props.onDisconnect}>Disconnect Google</button>}
        {state.kind === 'error' && <button className="btn-secondary" disabled={busy} onClick={props.onRetry}>Try again</button>}
      </div>
    </section>
  );
}

export default function GoogleCalendarPanel(props: { settings: SyncSettings | null }) {
  const { settings } = props;
  const [state, setState] = useState<PanelState>(SAMPLE_MODE ? { kind: 'sample' } : settings ? { kind: 'loading' } : { kind: 'signed_out' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const refresh = useCallback(async () => {
    if (SAMPLE_MODE) return;
    if (!settings) return setState({ kind: 'signed_out' });
    setState({ kind: 'loading' });
    try {
      const s = await googleStatus(settings);
      if (live.current) setState(stateFromStatus(s));
    } catch (e) {
      if (live.current) setState(stateFromError(e));
    }
  }, [settings]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function connect() {
    if (SAMPLE_MODE || !settings) return;
    setBusy(true);
    setNotice(null);
    try {
      const url = await googleConnectUrl(settings);
      window.location.assign(url); // consent happens on accounts.google.com; the server finishes the link
    } catch (e) {
      setState(stateFromError(e));
      setBusy(false);
    }
  }

  async function disconnect() {
    if (SAMPLE_MODE || !settings) return;
    setBusy(true);
    try {
      const r = await googleDisconnect(settings);
      setNotice(
        r.revoked
          ? 'Disconnected, and Google confirmed access was removed.'
          : 'Disconnected from LifeDash. Google did not confirm, so also remove LifeDash in your Google Account under Third-party access.',
      );
      setState({ kind: 'disconnected' });
    } catch (e) {
      setState(stateFromError(e));
    } finally {
      if (live.current) setBusy(false);
    }
  }

  return <GoogleCalendarView state={state} busy={busy} notice={notice} onConnect={() => void connect()} onDisconnect={() => void disconnect()} onRetry={() => void refresh()} />;
}
