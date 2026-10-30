import { useEffect, useRef, useState } from 'react';
import { updateTask } from '../repo';
import { makeRecurrence, describeRecurrence, recurrenceChoice } from '../logic';
import { todayStr } from '../dates';
import type { Task } from '../types';

type RecChoice = 'none' | 'daily' | 'weekly' | 'monthly' | 'ndays' | 'invalid' | 'custom';

function savedDayInterval(task: Task): number {
  const match = /^Every (\d+) days$/.exec(describeRecurrence(task.recurrence));
  return match ? Number(match[1]) : 3;
}

export default function TaskRecurrence({ task }: { task: Task }) {
  return <RecurrenceField key={task.id} task={task} />;
}
function RecurrenceField({ task }: { task: Task }) {
  const [choice, setChoice] = useState<RecChoice>(() => recurrenceChoice(task.recurrence));
  const [nDays, setNDays] = useState(() => savedDayInterval(task));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const writing = useRef(false), failed = useRef(false), mounted = useRef(true);
  const attempt = useRef<{ recurrence: string | null; dueDate?: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (writing.current) deferred.current = true;
    else if (!failed.current) {
      setChoice(recurrenceChoice(task.recurrence)); setNDays(savedDayInterval(task));
    }
  }, [task.recurrence]);
  const deferred = useRef(false);
  useEffect(() => {
    if (!busy && deferred.current) {
      deferred.current = false;
      if (!failed.current) { setChoice(recurrenceChoice(task.recurrence)); setNDays(savedDayInterval(task)); }
    }
  }, [busy]);
  async function write(patch: { recurrence: string | null; dueDate?: string }) {
    if (writing.current) return;
    writing.current = true; deferred.current = false; attempt.current = patch; setBusy(true); setError('');
    try { await updateTask(task.id, patch); failed.current = false; }
    catch { failed.current = true; if (mounted.current) setError("Repeat wasn't saved. Your choice is kept here. Retry to save it."); }
    finally { writing.current = false; if (mounted.current) setBusy(false); }
  }
  async function setRecurrence(c: Exclude<RecChoice, 'invalid' | 'custom'>, interval = nDays) {
    if (writing.current) return;
    setChoice(c);
    const anchor = task.dueDate ?? todayStr();
    await write(c === 'none' ? { recurrence: null } : { dueDate: anchor, recurrence: makeRecurrence(c, anchor, interval) });
  }
  return <div aria-busy={busy}>
      <label className="field">
        <span>Repeats</span>
        <select aria-label="Repeats" disabled={busy} value={choice} onChange={(e) => void setRecurrence(e.target.value as Exclude<RecChoice, 'invalid' | 'custom'>)}>
          {choice === 'custom' && <option value="custom" disabled>Custom saved rule</option>}
          {choice === 'invalid' && <option value="invalid" disabled>Unreadable saved rule</option>}
          <option value="none">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly (same weekday)</option>
          <option value="monthly">Monthly (same day)</option>
          <option value="ndays">Every N days</option>
        </select>
      </label>
      {choice === 'custom' && task.recurrence && <details className="rule-note"><summary>Saved repeat rule</summary><code style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{task.recurrence}</code><p>Kept unchanged. Choose a repeat above to replace it.</p></details>}
      {choice === 'invalid' && task.recurrence && (
        <p className="rule-note invalid-rule-note" role="alert">
          This saved repeat rule can't be read, so completing the task won't schedule a next
          occurrence. Stored rule: <code>{task.recurrence}</code> Pick a repeat above to replace
          it, or choose "Does not repeat" to clear it.
        </p>
      )}
      {choice === 'ndays' && (
        <label className="field">
          <span>Every</span>
          <span className="ndays">
            <input
              type="number"
              aria-label="Repeat interval in days"
              readOnly={busy}
              aria-disabled={busy}
              min={1}
              max={365}
              value={nDays}
              onChange={(e) => {
                if (writing.current) return;
                const v = Math.max(1, Number(e.target.value) || 1);
                setNDays(v);
                void setRecurrence('ndays', v);
              }}
            />
            days
          </span>
        </label>
      )}
    {busy && <p className="sub-add-feedback" role="status">Saving repeat…</p>}
    {error && <div className="sub-add-feedback"><p role="alert">{error}</p><button className="btn-secondary" onClick={() => { if (attempt.current) void write(attempt.current); }}>Retry repeat</button></div>}
  </div>;
}
