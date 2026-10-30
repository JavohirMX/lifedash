import { useEffect, useRef, useState, type ReactNode } from 'react';
import { stopFocus } from '../repo';
export default function HomeFocusStop({ children }: { children: ReactNode }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const writing = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function stop() {
    if (writing.current) return;
    writing.current = true; setBusy(true); setError('');
    try { await stopFocus(); }
    catch { if (mounted.current) setError("Couldn't stop focus. Try Stop again."); }
    finally { writing.current = false; if (mounted.current) setBusy(false); }
  }
  return <div aria-busy={busy}>
    <div className="focus-task">{children}<button className="btn-secondary focus-stop" disabled={busy} onClick={() => void stop()}>Stop</button></div>
    {busy && <p className="sub-add-feedback" role="status">Stopping focus…</p>}
    {error && <p className="sub-add-feedback" role="alert">{error}</p>}
  </div>;
}
