import { useEffect, useRef, useState } from 'react';
import { updateTask } from '../repo';

export default function TaskPin(props: { id: string; pinned: boolean }) {
  return <PinField key={props.id} {...props} />;
}
function PinField({ id, pinned }: { id: string; pinned: boolean }) {
  const [value, setValue] = useState(pinned);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const writing = useRef(false);
  const failed = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (writing.current) deferred.current = true;
    else if (!failed.current) setValue(pinned);
  }, [pinned]);
  const deferred = useRef(false);
  useEffect(() => {
    if (!busy && deferred.current) {
      deferred.current = false;
      if (!failed.current) { setValue(pinned); }
    }
  }, [busy]);
  async function save(next: boolean) {
    if (writing.current) return;
    writing.current = true; deferred.current = false;
    setValue(next); setBusy(true); setError('');
    try {
      await updateTask(id, { pinned: next });
      failed.current = false;
    } catch {
      failed.current = true;
      if (mounted.current) setError("Pin change wasn't saved. Your choice is kept here. Retry to save it.");
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return <div aria-busy={busy}>
    <label className="field row">
      <input type="checkbox" checked={value} disabled={busy} onChange={e => void save(e.target.checked)} />
      <span>Pinned to top</span>
    </label>
    {busy && <p className="sub-add-feedback" role="status">Saving pin…</p>}
    {error && <div className="sub-add-feedback"><p role="alert">{error}</p><button className="btn-secondary" onClick={() => void save(value)}>Retry pin</button></div>}
  </div>;
}
