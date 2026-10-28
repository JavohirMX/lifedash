import { useEffect, useRef, useState } from 'react';
import { RRule, Frequency } from 'rrule';
import { updateTask } from '../repo';
import { makeRecurrence, describeRecurrence, isRecurrenceValid } from '../logic';
import { todayStr } from '../dates';
import type { Task } from '../types';

type RecChoice = 'none' | 'daily' | 'weekly' | 'monthly' | 'ndays' | 'invalid' | 'custom';

function currentChoice(t: Task): RecChoice {
  if (t.recurrence && !isRecurrenceValid(t.recurrence)) return 'invalid';
  if (t.recurrence) {
    const o = RRule.fromString(t.recurrence).origOptions;
    const keys = Object.keys(o);
    if (!o.dtstart || keys.some(key => !['freq', 'interval', 'dtstart', 'byweekday', 'bymonthday'].includes(key))) return 'custom';
    const n = o.interval ?? 1;
    if (!Number.isInteger(n) || n < 1) return 'custom';
    if (o.freq === Frequency.DAILY) {
      if (o.byweekday || o.bymonthday) return 'custom';
    } else if (o.freq === Frequency.WEEKLY) {
      const days = Array.isArray(o.byweekday) ? o.byweekday : o.byweekday != null ? [o.byweekday] : [];
      const day = days[0];
      const weekday = typeof day === 'number' ? day : typeof day === 'object' ? day.weekday : undefined;
      if (n !== 1 || o.bymonthday || days.length !== 1 || (typeof day === 'object' && day.n != null) || weekday !== (o.dtstart.getUTCDay() + 6) % 7) return 'custom';
    } else if (o.freq === Frequency.MONTHLY) {
      const days = Array.isArray(o.bymonthday) ? o.bymonthday : o.bymonthday != null ? [o.bymonthday] : [];
      if (n !== 1 || o.byweekday || days.length !== 1 || days[0] !== o.dtstart.getUTCDate()) return 'custom';
    } else return 'custom';
  }
  const d = describeRecurrence(t.recurrence);
  if (!d) return 'none';
  if (d === 'Daily') return 'daily';
  if (d === 'Weekly') return 'weekly';
  if (d === 'Monthly') return 'monthly';
  return 'ndays';
}

function savedDayInterval(task: Task): number {
  const match = /^Every (\d+) days$/.exec(describeRecurrence(task.recurrence));
  return match ? Number(match[1]) : 3;
}

export default function TaskRecurrence({ task }: { task: Task }) {
  return <RecurrenceField key={task.id} task={task} />;
}
function RecurrenceField({ task }: { task: Task }) {
  const [choice, setChoice] = useState<RecChoice>(() => currentChoice(task));
  const [nDays, setNDays] = useState(() => savedDayInterval(task));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const writing = useRef(false), failed = useRef(false), mounted = useRef(true);
  const attempt = useRef<{ recurrence: string | null; dueDate?: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!writing.current && !failed.current) {
      setChoice(currentChoice(task)); setNDays(savedDayInterval(task));
    }
  }, [task.recurrence]);
  async function write(patch: { recurrence: string | null; dueDate?: string }) {
    if (writing.current) return;
    writing.current = true; attempt.current = patch; setBusy(true); setError('');
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
