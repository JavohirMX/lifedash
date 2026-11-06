import { useEffect, useRef, useState } from 'react';
import type { Task } from '../../types';
import { updateTask } from '../../repo';
import { planError, type PlanPatch } from '../../planning';

// Preserve exported PlanEditor for HomeView.tsx compatibility
const dirtyPlanEditors = new Set<string>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (dirtyPlanEditors.size) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}

export function PlanEditor({
  task,
  date,
  suggestedTime,
  close,
}: {
  task: Task;
  date: string;
  suggestedTime: string | null;
  close: () => void;
}) {
  const [workDate, setDate] = useState(suggestedTime !== null ? date : task.plannedDate || date);
  const [time, setTime] = useState(suggestedTime ?? task.plannedTime ?? '');
  const [duration, setDuration] = useState(
    task.durationMinutes ? String(task.durationMinutes) : ''
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    formRef.current?.scrollIntoView({ block: 'nearest' });
    formRef.current?.querySelector('input')?.focus();
  }, []);

  const initial = useRef({ workDate, time, duration });
  useEffect(() => {
    const dirty =
      workDate !== initial.current.workDate ||
      time !== initial.current.time ||
      duration !== initial.current.duration;
    if (dirty) dirtyPlanEditors.add(task.id);
    else dirtyPlanEditors.delete(task.id);
    return () => {
      dirtyPlanEditors.delete(task.id);
    };
  }, [workDate, time, duration, task.id]);

  async function save(patch: PlanPatch) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await updateTask(task.id, patch);
      close();
    } catch {
      setError('Plan was not saved. Your choices are kept; retry.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      ref={formRef}
      className="planner-editor"
      onSubmit={(e) => {
        e.preventDefault();
        const invalid = planError(workDate, time, duration);
        if (invalid) {
          setError(invalid);
          return;
        }
        void save({
          plannedDate: workDate || null,
          plannedTime: time || null,
          durationMinutes: duration ? Number(duration) : null,
        });
      }}
    >
      <fieldset disabled={busy}>
        <legend>Work plan for {task.title}</legend>
        <p>Saving changes only the work plan and estimate, never the deadline or calendar.</p>
        <label>
          Planned work date
          <input
            type="date"
            value={workDate}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          Planned start
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>
        <label>
          Estimate (minutes)
          <input
            type="number"
            min="1"
            max="1440"
            step="1"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>
        <div className="planner-toolbar">
          <button type="submit" className="btn-primary">
            {busy ? 'Saving…' : 'Save plan'}
          </button>
          <button
            type="button"
            className="btn-secondary planner-action"
            onClick={() =>
              void save({
                plannedDate: null,
                plannedTime: null,
                durationMinutes: task.durationMinutes ?? null,
              })
            }
          >
            Remove work plan
          </button>
          <button type="button" className="btn-secondary planner-action" onClick={close}>
            Cancel
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </fieldset>
    </form>
  );
}
