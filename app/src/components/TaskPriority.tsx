import { useEffect, useRef, useState } from 'react';
import { updateTask } from '../repo';

export default function TaskPriority(props: { id: string; priority: number }) {
  return <PriorityField key={props.id} {...props} />;
}
function PriorityField({ id, priority }: { id: string; priority: number }) {
  const [value, setValue] = useState(priority);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const writing = useRef(false);
  const failed = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!writing.current && !failed.current) setValue(priority);
  }, [priority]);
  async function save(next: number) {
    if (writing.current) return;
    writing.current = true;
    setValue(next); setBusy(true); setError('');
    try {
      await updateTask(id, { priority: next });
      failed.current = false;
    } catch {
      failed.current = true;
      if (mounted.current) setError("Priority wasn't saved. Your selection is kept here. Retry to save it.");
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return <div aria-busy={busy}>
    <label className="field">
      <span>Priority</span>
      <select aria-label="Priority" value={value} disabled={busy} onChange={e => void save(Number(e.target.value))}>
        <option value={0}>None</option>
        <option value={1}>P1 - high</option>
        <option value={2}>P2 - medium</option>
        <option value={3}>P3 - low</option>
      </select>
    </label>
    {busy && <p className="sub-add-feedback" role="status">Saving priority…</p>}
    {error && <div className="sub-add-feedback"><p role="alert">{error}</p><button className="btn-secondary" onClick={() => void save(value)}>Retry priority</button></div>}
  </div>;
}
