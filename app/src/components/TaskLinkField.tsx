import { useEffect, useRef, useState, type ReactNode } from 'react';
import { updateTask } from '../repo';

type Props = { id: string; field: 'projectId' | 'goalId'; value: string; label: string; children: ReactNode };
export default function TaskLinkField(props: Props) {
  return <LinkField key={`${props.id}:${props.field}`} {...props} />;
}
function LinkField({ id, field, value: saved, label, children }: Props) {
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
      await updateTask(id, field === 'goalId' ? { goalId: next || null } : { projectId: next });
      failed.current = false;
    } catch {
      failed.current = true;
      if (mounted.current) setError(`${label} wasn't saved. Your choice is kept here. Retry to save it.`);
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return <div aria-busy={busy}>
    <label className="field">
      <span>{label}</span>
      <select aria-label={label} value={value} disabled={busy} onChange={e => void save(e.target.value)}>{children}</select>
    </label>
    {busy && <p className="sub-add-feedback" role="status">Saving {label.toLowerCase()}…</p>}
    {error && <div className="sub-add-feedback"><p role="alert">{error}</p><button className="btn-secondary" onClick={() => void save(value)}>Retry {label.toLowerCase()}</button></div>}
  </div>;
}
