import { useEffect, useRef, useState } from 'react';
import { startFocus } from '../repo';
export default function HomeFocusStart({ taskId }: { taskId: string }) {
  const lock = useRef(false), mounted = useRef(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function start() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await startFocus(taskId); }
    catch { if (mounted.current) setError("Couldn't start focus. Try Start focus again."); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <div aria-busy={busy}><button className="btn-primary" disabled={busy} onClick={() => void start()}>{busy ? 'Starting…' : 'Start focus'}</button>{error && <p role="alert">{error}</p>}</div>;
}
