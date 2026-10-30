import { useEffect, useRef, useState } from 'react';
import { updateTask } from '../repo';

type Props = { id: string; field: 'dueDate' | 'dueTime'; value: string; label: string; type: 'date' | 'time' };
export default function TaskDateField(props: Props) {
  return <DateField key={`${props.id}:${props.field}`} {...props} />;
}
function DateField({ id, field, value: saved, label, type }: Props) {
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const writing = useRef(false), failed = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (writing.current) deferred.current = true; else if (!failed.current) setValue(saved); }, [saved]);
  const deferred = useRef(false);
  useEffect(() => {
    if (!busy && deferred.current) {
      deferred.current = false;
      if (!failed.current) { setValue(saved); }
    }
  }, [busy]);
  async function save(next: string) {
    if (writing.current) return;
    writing.current = true; deferred.current = false; setValue(next); setBusy(true); setError('');
    try {
      await updateTask(id, field === 'dueDate' ? { dueDate: next || null } : { dueTime: next || null });
      failed.current = false;
    } catch {
      failed.current = true;
      if (mounted.current) setError(`${field === 'dueDate' ? 'Date' : 'Time'} wasn't saved. Your choice is kept here. Retry to save it.`);
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return <div aria-busy={busy}>
    <label className="field">
      <span>{label}</span>
      <input type={type} aria-label={label} value={value} readOnly={busy} aria-disabled={busy} onChange={e => void save(e.target.value)} />
    </label>
    {busy && <p className="sub-add-feedback" role="status">Saving {field === 'dueDate' ? 'date' : 'time'}…</p>}
    {error && <div className="sub-add-feedback"><p role="alert">{error}</p><button className="btn-secondary" onClick={() => void save(value)}>Retry {field === 'dueDate' ? 'date' : 'time'}</button></div>}
  </div>;
}
