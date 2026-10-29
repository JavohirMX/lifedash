import { useEffect, useId, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { db } from '../db';
import { addTask } from '../repo';
import { parseQuickAdd, describeRecurrence } from '../logic';
import { parseNatural } from '../natural';
import { todayStr, friendlyDate, addDays } from '../dates';
import type { Project } from '../types';

type CaptureJob = { id: number; raw: string; input: Parameters<typeof addTask>[0] };
const failedCaptures = new Map<string, CaptureJob[]>();
const retryingCaptures = new Set<CaptureJob>();
const pendingCaptures = new Set<CaptureJob>();
window.addEventListener('beforeunload', event => {
  if (pendingCaptures.size || retryingCaptures.size || [...failedCaptures.values()].some(items => items.length > 0)) {
    event.preventDefault(); event.returnValue = '';
  }
});
let captureId = 0;

export default function QuickAdd(props: { projectId: string; dueDate?: string | null; placeholder?: string; captureProjects?: Project[] }) {
  const [title, setTitle] = useState('');
  const [chosenProject, setChosenProject] = useState(props.projectId);
  // undefined means use natural-language parsing; null explicitly means no date.
  const [chosenDate, setChosenDate] = useState<string | null | undefined>(undefined);
  const projectId = props.captureProjects ? chosenProject : props.projectId;
  useEffect(() => {
    if (!props.captureProjects) return;
    const warn = (event: BeforeUnloadEvent) => { if (currentTitle.current.trim()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [props.captureProjects]);
  const currentTitle = useRef('');
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
    // Register synchronously, including jobs still waiting behind another write.
    pendingCaptures.add(job);
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
        pendingCaptures.delete(job);
        retryingCaptures.delete(job);
        setPending((n) => n - 1);
      }
    });
  }

  function submit() {
    const raw = currentTitle.current.trim();
    if (!raw) return;
    if (props.captureProjects && !props.captureProjects.some(project => project.id === projectId)) {
      setError('Choose an available project. Your text is still here.');
      return;
    }
    const parsed = parseQuickAdd(raw);
    const nat = parseNatural(parsed.title);
    if (!nat.title) {
      setError('Add a task name as well as dates or tags. Your text is still here.');
      return;
    }
    setError('');
    enqueue({ id: ++captureId, raw, input: {
      title: nat.title, tags: parsed.tags, projectId,
      dueDate: props.captureProjects && chosenDate !== undefined ? chosenDate : nat.dueDate ?? props.dueDate ?? null,
      dueTime: nat.dueTime, recurrence: nat.recurrence, priority: nat.priority,
    } });
    currentTitle.current = '';
    setTitle('');
    inputRef.current?.focus();
  }

  const parsed = parseQuickAdd(title);
  const natural = parseNatural(parsed.title);
  const finalDate = props.captureProjects && chosenDate !== undefined ? chosenDate : natural.dueDate ?? props.dueDate ?? null;
  const hint = (() => {
    if (!title.trim()) return null;
    const nat = natural;
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
          <label className="quick-add-label quick-add-label--sr" htmlFor={fieldId}>New task</label>
          <input
            id={fieldId}
            ref={inputRef}
            value={title}
            placeholder={props.placeholder ?? 'Add a task'}
            aria-describedby={`${fieldId}-${props.captureProjects ? 'preview' : 'hint'}${error ? ` ${fieldId}-error` : ''}`}
            aria-invalid={error ? true : undefined}
            onChange={(e) => { currentTitle.current = e.target.value; setTitle(e.target.value); setError(''); setStatus(''); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
              if (e.key === 'Escape' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
            }}
          />
        </div>
        <button type="submit" className="btn-primary quick-add-submit" disabled={!title.trim()}>Add</button>
      </form>
      <div hidden={Boolean(props.captureProjects)} id={`${fieldId}-hint`} className="quick-add-hint" aria-live="polite">
        {hint ?? 'Dates, times and #tags supported'}
      </div>
      {props.captureProjects && <>
        <fieldset className="capture-options">
          <legend>Save to</legend>
          <label>Project<select aria-label="Capture project" value={chosenProject} onChange={e => setChosenProject(e.target.value)}>
            {props.captureProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select></label>
          <label>Due date<input aria-label="Capture due date" type="date" value={finalDate ?? ''} onChange={e => setChosenDate(e.target.value || null)} /></label>
          <div className="capture-date-chips" role="group" aria-label="Quick due date">
            <button type="button" className="mini" aria-pressed={chosenDate === todayStr()} onClick={() => setChosenDate(todayStr())}>Today</button>
            <button type="button" className="mini" aria-pressed={chosenDate === addDays(todayStr(), 1)} onClick={() => setChosenDate(addDays(todayStr(), 1))}>Tomorrow</button>
            <button type="button" className="mini" aria-pressed={chosenDate === null} onClick={() => setChosenDate(null)}>No date</button>
            <button type="button" className="mini" aria-pressed={chosenDate === undefined} onClick={() => setChosenDate(undefined)}>Use parsed date</button>
          </div>
          <div className="capture-project-chips" role="group" aria-label="Quick project">
            {props.captureProjects.slice(0, 4).map(project => <button key={project.id} type="button" className="mini" aria-pressed={chosenProject === project.id} onClick={() => setChosenProject(project.id)}>{project.name}</button>)}
          </div>
        </fieldset>
        <div id={`${fieldId}-preview`} className="capture-preview" role="status" aria-label="Task preview">
          <strong>Will add</strong>
          <p>{title.trim() ? natural.title || 'Add a task name' : 'Your task name'}</p>
          <p>{props.captureProjects.find(project => project.id === projectId)?.name ?? 'Choose a project'} · {finalDate ? friendlyDate(finalDate, todayStr()) : 'No due date'}{natural.dueTime ? ` · ${natural.dueTime}` : ''}</p>
          {natural.recurrence && <p>{describeRecurrence(natural.recurrence)}</p>}
          {natural.priority > 0 && <p>Priority {natural.priority}</p>}
          {parsed.tags.length > 0 && <p>{parsed.tags.map(tag => `#${tag}`).join(' ')}</p>}
          {chosenDate !== undefined && natural.dueDate && <p>Selected date replaces the parsed date ({friendlyDate(natural.dueDate, todayStr())}).</p>}
        </div>
      </>}
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
