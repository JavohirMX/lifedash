import { useEffect, useRef, useState, type ReactNode } from 'react';
import { startFocus, stopFocus } from '../repo';
export default function TaskFocus(props: { id: string; runningHere: boolean; running: boolean; clock?: ReactNode; children?: ReactNode }) {
  return <FocusControls key={props.id} {...props} />;
}
function FocusControls({ id, runningHere, running, clock, children }: { id: string; runningHere: boolean; running: boolean; clock?: ReactNode; children?: ReactNode }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const writing = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function change() {
    if (writing.current) return;
    const stopping = runningHere;
    writing.current = true; setBusy(true); setError('');
    try { if (stopping) await stopFocus(); else await startFocus(id); }
    catch { if (mounted.current) setError(stopping ? "Couldn't stop focus. Try Stop again." : "Couldn't start focus here. Try again."); }
    finally { writing.current = false; if (mounted.current) setBusy(false); }
  }
  return <div aria-busy={busy}>
    <div className="focus-section" aria-label="Focus timer">
      {clock}
      <button className="btn-secondary" disabled={busy} onClick={() => void change()}>{runningHere ? 'Stop' : running ? 'Switch focus here' : 'Start focus'}</button>
      {children}
    </div>
    {busy && <p className="sub-add-feedback" role="status">Saving focus timer…</p>}
    {error && <p className="sub-add-feedback" role="alert">{error}</p>}
  </div>;
}
