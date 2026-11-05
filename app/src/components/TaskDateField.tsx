import { useEffect, useRef, useState } from 'react';
import { updateTask } from '../repo';
import { todayStr, addDays } from '../dates';

type Props = { id: string; field: 'dueDate' | 'dueTime'; value: string; label: string; type: 'date' | 'time' };

export default function TaskDateField(props: Props) {
  return <DateField key={`${props.id}:${props.field}`} {...props} />;
}

function nextMondayStr(): string {
  const today = todayStr();
  const day = new Date().getDay(); // 0 is Sun, 1 is Mon...
  const daysUntilNextMon = ((8 - day) % 7) || 7;
  return addDays(today, daysUntilNextMon);
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
      await updateTask(id, field === 'dueDate' ? (next ? { dueDate: next } : { dueDate: null, dueTime: null }) : { dueTime: next || null });
      failed.current = false;
    } catch {
      failed.current = true;
      if (mounted.current) setError(`${field === 'dueDate' ? 'Date' : 'Time'} wasn't saved. Your choice is kept here. Retry to save it.`);
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const today = todayStr();
  const tomorrow = addDays(today, 1);
  const nextMon = nextMondayStr();

  return (
    <div className={`date-field-container ${field}`} aria-busy={busy}>
      <div className="field">
        <div className="date-field-header">
          <span className="field-label">{label}</span>
          {field === 'dueDate' && value && (
            <button
              type="button"
              className="preset-chip clear"
              disabled={busy}
              onClick={() => void save('')}
            >
              Clear
            </button>
          )}
        </div>
        {field === 'dueDate' && (
          <div className="date-presets" role="group" aria-label="Quick date options">
            <button
              type="button"
              className={`preset-chip ${value === today ? 'active' : ''}`}
              disabled={busy}
              onClick={() => void save(today)}
            >
              Today
            </button>
            <button
              type="button"
              className={`preset-chip ${value === tomorrow ? 'active' : ''}`}
              disabled={busy}
              onClick={() => void save(tomorrow)}
            >
              Tomorrow
            </button>
            <button
              type="button"
              className={`preset-chip ${value === nextMon ? 'active' : ''}`}
              disabled={busy}
              onClick={() => void save(nextMon)}
            >
              Next Mon
            </button>
          </div>
        )}
        <input
          type={type}
          aria-label={label}
          value={value}
          readOnly={busy}
          aria-disabled={busy}
          onChange={(e) => void save(e.target.value)}
        />
      </div>
      {busy && <p className="sub-add-feedback" role="status">Saving {field === 'dueDate' ? 'date' : 'time'}…</p>}
      {error && (
        <div className="sub-add-feedback">
          <p role="alert">{error}</p>
          <button className="btn-secondary" onClick={() => void save(value)}>Retry {field === 'dueDate' ? 'date' : 'time'}</button>
        </div>
      )}
    </div>
  );
}
