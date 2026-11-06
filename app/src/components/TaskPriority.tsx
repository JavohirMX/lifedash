import { useEffect, useRef, useState } from 'react';
import { Flag } from 'lucide-react';
import { updateTask } from '../repo';

const PRIORITY_OPTIONS = [
  { value: 0, label: 'None', desc: 'No priority' },
  { value: 1, label: 'P1', desc: 'High priority' },
  { value: 2, label: 'P2', desc: 'Medium priority' },
  { value: 3, label: 'P3', desc: 'Low priority' },
] as const;

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
    if (writing.current) deferred.current = true;
    else if (!failed.current) setValue(priority);
  }, [priority]);
  const deferred = useRef(false);
  useEffect(() => {
    if (!busy && deferred.current) {
      deferred.current = false;
      if (!failed.current) { setValue(priority); }
    }
  }, [busy]);

  async function save(next: number) {
    if (writing.current) return;
    writing.current = true; deferred.current = false;
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

  return (
    <div className="task-priority-control" aria-busy={busy}>
      <label className="field-label" id={`priority-label-${id}`}>Priority</label>
      <div
        className="priority-segmented"
        role="radiogroup"
        aria-labelledby={`priority-label-${id}`}
      >
        {PRIORITY_OPTIONS.map((opt) => {
          const isSelected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={opt.desc}
              disabled={busy}
              className={`priority-seg-btn ${isSelected ? 'selected' : ''} prio-opt-${opt.value}`}
              onClick={() => void save(opt.value)}
            >
              {opt.value > 0 && (
                <Flag
                  size={12}
                  strokeWidth={2}
                  className={`prio prio-${opt.value}`}
                  aria-hidden="true"
                />
              )}
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>
      {busy && <p className="sub-add-feedback" role="status">Saving priority…</p>}
      {error && (
        <div className="sub-add-feedback">
          <p role="alert">{error}</p>
          <button className="btn-secondary" onClick={() => void save(value)}>Retry priority</button>
        </div>
      )}
    </div>
  );
}
