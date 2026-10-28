import { useEffect, useId, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { db } from '../db';
import { addTask } from '../repo';
import { parseQuickAdd, describeRecurrence } from '../logic';
import { parseNatural } from '../natural';
import { todayStr, friendlyDate } from '../dates';

type CaptureJob = { id: number; raw: string; input: Parameters<typeof addTask>[0] };
const failedCaptures = new Map<string, CaptureJob[]>();
const retryingCaptures = new Set<CaptureJob>();
window.addEventListener('beforeunload', event => {
  if (retryingCaptures.size || [...failedCaptures.values()].some(items => items.length > 0)) {
    event.preventDefault(); event.returnValue = '';
  }
});
let captureId = 0;

export default function QuickAdd(props: { projectId: string; dueDate?: string | null; placeholder?: string }) {
  const [title, setTitle] = useState('');
  const fieldId = useId();
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [failed, setFailed] = useState<CaptureJob[]>(() => failedCaptures.get(db.name) ?? []);
  function rememberFailed(items: CaptureJob[]) { failedCaptures.set(db.name, items); setFailed(items); window.dispatchEvent(new Event('lifedash-capture-drafts')); }
  useEffect(() => {
    const refresh = () => setFailed(failedCaptures.get(db.name) ?? []);
    window.addEventListener('lifedash-capture-drafts', refresh);
    return () => {
      window.removeEventListener('lifedash-capture-drafts', refresh);
    };
  }, []);

  function enqueue(job: CaptureJob) {
    setPending((n) => n + 1);
    setStatus('');
    // A failed write must not prevent later captures from being saved.
    chain.current = chain.current.catch(() => undefined).then(async () => {
      try {
        await addTask(job.input);
        setStatus(`Added: ${job.input.title}`);
      } catch {
        rememberFailed([...(failedCaptures.get(db.name) ?? []), job]);
      } finally {
        retryingCaptures.delete(job);
        setPending((n) => n - 1);
      }
    });
  }

  function submit() {
    const raw = title.trim();
    if (!raw) return;
    const parsed = parseQuickAdd(raw);
    const nat = parseNatural(parsed.title);
    if (!nat.title) {
      setError('Add a task name as well as dates or tags. Your text is still here.');
      return;
    }
    setError('');
    enqueue({ id: ++captureId, raw, input: {
      title: nat.title, tags: parsed.tags, projectId: props.projectId,
      dueDate: nat.dueDate ?? props.dueDate ?? null,
      dueTime: nat.dueTime, recurrence: nat.recurrence, priority: nat.priority,
    } });
    setTitle('');
    inputRef.current?.focus();
  }

  const hint = (() => {
    if (!title.trim()) return null;
    const nat = parseNatural(parseQuickAdd(title).title);
    const bits: string[] = [];
    if (nat.dueDate) bits.push(friendlyDate(nat.dueDate, todayStr()));
    if (nat.dueTime) bits.push(nat.dueTime);
    if (nat.recurrence) bits.push(describeRecurrence(nat.recurrence));
    if (nat.priority) bits.push(`P${nat.priority}`);
    return bits.length ? bits.join(' · ') : null;
  })();

  return (
    <div className="quick-add">
      <form className="quick-add-row" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="quick-add-field">
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" className="quick-add-icon" />
          <label className="quick-add-label" htmlFor={fieldId}>New task</label>
          <input
            id={fieldId}
            ref={inputRef}
            value={title}
            placeholder={props.placeholder ?? 'Add a task'}
            aria-describedby={`${fieldId}-hint${error ? ` ${fieldId}-error` : ''}`}
            aria-invalid={error ? true : undefined}
            onChange={(e) => { setTitle(e.target.value); setError(''); setStatus(''); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
              if (e.key === 'Escape' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
            }}
          />
        </div>
        <button type="submit" className="mini quick-add-submit" disabled={!title.trim()}>Add</button>
      </form>
      <div id={`${fieldId}-hint`} className="quick-add-hint" aria-live="polite">
        {hint ?? 'Dates, times and #tags supported'}
      </div>
      {error && <p id={`${fieldId}-error`} className="quick-add-error" role="alert">{error}</p>}
      <div className="quick-add-status" role="status">{pending ? `Saving ${pending} ${pending === 1 ? 'task' : 'tasks'}…` : status}</div>
      {failed.map((job) => (
        <div className="quick-add-failed" key={job.id}>
          <p role="alert">Couldn't save this task. Your text is kept here:</p>
          <p className="quick-add-draft">{job.raw}</p>
          <button type="button" className="mini" onClick={() => {
            if (retryingCaptures.has(job)) return;
            retryingCaptures.add(job);
            rememberFailed((failedCaptures.get(db.name) ?? []).filter((item) => item.id !== job.id));
            enqueue(job);
          }}>Retry save</button>
        </div>
      ))}
    </div>
  );
}
