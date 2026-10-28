import { useEffect, useRef, useState } from 'react';
import { skipTask } from '../repo';
import type { Task } from '../types';
export default function TaskSkip({ task }: { task: Task }) {
  return <SkipButton key={task.id} task={task} />;
}
function SkipButton({ task }: { task: Task }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const writing = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function skip() {
    if (writing.current) return;
    writing.current = true; setBusy(true); setError('');
    try { await skipTask(task); }
    catch { if (mounted.current) setError("Couldn't skip this occurrence. Try Skip this occurrence again."); }
    finally { writing.current = false; if (mounted.current) setBusy(false); }
  }
  return <div aria-busy={busy}>
    <div className="field row"><button className="btn-secondary" disabled={busy} onClick={() => void skip()}>Skip this occurrence</button></div>
    {busy && <p className="sub-add-feedback" role="status">Skipping occurrence…</p>}
    {error && <p className="sub-add-feedback" role="alert">{error}</p>}
  </div>;
}
