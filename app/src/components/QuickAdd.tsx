import { useEffect, useId, useRef, useState } from 'react';
import { Plus, FileText, CheckCircle2, Check } from 'lucide-react';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { addTask } from '../repo';
import { parseQuickAdd, describeRecurrence, makeRecurrence } from '../logic';
import { parseNatural } from '../natural';
import { todayStr, friendlyDate, addDays } from '../dates';
import type { Project, Task } from '../types';

type CaptureJob = { id: number; raw: string; input: Parameters<typeof addTask>[0] };
const failedCaptures = new Map<string, CaptureJob[]>();
const retryingCaptures = new Set<CaptureJob>();
const pendingCaptures = new Set<CaptureJob>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (pendingCaptures.size || retryingCaptures.size || [...failedCaptures.values()].some((items) => items.length > 0)) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}
let captureId = 0;

export default function QuickAdd(props: {
  projectId: string;
  dueDate?: string | null;
  placeholder?: string;
  captureProjects?: Project[];
  onClose?: () => void;
}) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [chosenProject, setChosenProject] = useState(props.projectId);
  // undefined means use natural-language parsing; null explicitly means no date.
  const [chosenDate, setChosenDate] = useState<string | null | undefined>(undefined);
  const [chosenTime, setChosenTime] = useState<string | null | undefined>(undefined);
  const [chosenPriority, setChosenPriority] = useState<number | undefined>(undefined);
  const [chosenRecurrence, setChosenRecurrence] = useState<string | null | undefined>(undefined);
  const [extraTags, setExtraTags] = useState<string[]>([]);

  const projectId = props.captureProjects ? chosenProject : props.projectId;

  useEffect(() => {
    if (!props.captureProjects) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (currentTitle.current.trim() || currentNote.current.trim()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [props.captureProjects]);

  const currentTitle = useRef('');
  const currentNote = useRef('');
  const fieldId = useId();
  const noteFieldId = useId();
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [failed, setFailed] = useState<CaptureJob[]>(() => failedCaptures.get(db.name) ?? []);

  const existingTasks = useLiveQuery(
    () => (props.captureProjects ? db.tasks.toArray() : Promise.resolve([] as Task[])),
    [Boolean(props.captureProjects)],
  );
  const availableTags = Array.from(
    new Set(existingTasks?.flatMap((t) => t.tags ?? []) ?? []),
  )
    .filter((t) => t && t.trim().length > 0)
    .slice(0, 10);

  function rememberFailed(items: CaptureJob[]) {
    failedCaptures.set(db.name, items);
    setFailed(items);
    window.dispatchEvent(new Event('lifedash-capture-drafts'));
  }

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
    chain.current = chain.current
      .catch(() => undefined)
      .then(async () => {
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
    if (props.captureProjects && !props.captureProjects.some((project) => project.id === projectId)) {
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

    const curDate =
      props.captureProjects && chosenDate !== undefined
        ? chosenDate
        : nat.dueDate ?? props.dueDate ?? null;
    const curTime =
      props.captureProjects && chosenTime !== undefined ? chosenTime : nat.dueTime ?? null;
    const curPriority =
      props.captureProjects && chosenPriority !== undefined
        ? chosenPriority
        : nat.priority ?? 0;
    const curRecurrence =
      props.captureProjects && chosenRecurrence !== undefined
        ? chosenRecurrence
        : nat.recurrence ?? null;
    const curTags = Array.from(new Set([...parsed.tags, ...extraTags]));
    const curNote = note.trim();

    enqueue({
      id: ++captureId,
      raw,
      input: {
        title: nat.title,
        tags: curTags,
        projectId,
        dueDate: curDate,
        dueTime: curTime,
        recurrence: curRecurrence,
        priority: curPriority,
        note: curNote || undefined,
      },
    });

    currentTitle.current = '';
    setTitle('');
    currentNote.current = '';
    setNote('');
    setShowNote(false);
    setExtraTags([]);
    inputRef.current?.focus();
  }

  const parsed = parseQuickAdd(title);
  const natural = parseNatural(parsed.title);
  const finalDate =
    props.captureProjects && chosenDate !== undefined
      ? chosenDate
      : natural.dueDate ?? props.dueDate ?? null;
  const finalTime =
    props.captureProjects && chosenTime !== undefined ? chosenTime : natural.dueTime ?? null;
  const finalPriority =
    props.captureProjects && chosenPriority !== undefined
      ? chosenPriority
      : natural.priority ?? 0;
  const finalRecurrence =
    props.captureProjects && chosenRecurrence !== undefined
      ? chosenRecurrence
      : natural.recurrence ?? null;
  const finalTags = Array.from(new Set([...parsed.tags, ...extraTags]));

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

  const toggleExtraTag = (tag: string) => {
    setExtraTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  // Inline QuickAdd (used in Today, Home, Backlog, Projects)
  if (!props.captureProjects) {
    return (
      <div className="quick-add">
        <form
          className="quick-add-row"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="quick-add-field">
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" className="quick-add-icon" />
            <label className="quick-add-label quick-add-label--sr" htmlFor={fieldId}>
              New task
            </label>
            <input
              id={fieldId}
              ref={inputRef}
              value={title}
              placeholder={props.placeholder ?? 'Add a task'}
              aria-describedby={`${fieldId}-hint${error ? ` ${fieldId}-error` : ''}`}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                currentTitle.current = e.target.value;
                setTitle(e.target.value);
                setError('');
                setStatus('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
                if (e.key === 'Escape' && !e.nativeEvent.isComposing)
                  (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
          <button
            type="submit"
            className="btn-primary quick-add-submit"
            disabled={!title.trim()}
          >
            Add
          </button>
        </form>
        <div id={`${fieldId}-hint`} className="quick-add-hint" aria-live="polite">
          {hint ?? 'Dates, times and #tags supported'}
        </div>
        {error && (
          <p id={`${fieldId}-error`} className="quick-add-error" role="alert">
            {error}
          </p>
        )}
        <div className="quick-add-status" role="status">
          {pending ? `Saving ${pending} ${pending === 1 ? 'task' : 'tasks'}…` : status}
        </div>
        {failed.map((job) => (
          <div className="quick-add-failed" key={job.id}>
            <p role="alert">Couldn't save this task. Your text is kept here:</p>
            <p className="quick-add-draft">{job.raw}</p>
            <button
              type="button"
              className="mini"
              onClick={() => {
                if (retryingCaptures.has(job)) return;
                retryingCaptures.add(job);
                rememberFailed((failedCaptures.get(db.name) ?? []).filter((item) => item.id !== job.id));
                enqueue(job);
              }}
            >
              Retry save
            </button>
          </div>
        ))}
      </div>
    );
  }

  // Enhanced Capture Modal Mode
  return (
    <div className="quick-add capture-modal-content">
      <form
        className="capture-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="capture-main-input-group">
          <div className="quick-add-field capture-title-field">
            <Plus size={18} strokeWidth={2} aria-hidden="true" className="quick-add-icon" />
            <label className="quick-add-label quick-add-label--sr" htmlFor={fieldId}>
              New task
            </label>
            <input
              id={fieldId}
              ref={inputRef}
              className="capture-title-input"
              value={title}
              placeholder={props.placeholder ?? 'Add a task (e.g. Call dentist tomorrow 2pm #health p1)'}
              aria-describedby={`${fieldId}-preview${error ? ` ${fieldId}-error` : ''}`}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                currentTitle.current = e.target.value;
                setTitle(e.target.value);
                setError('');
                setStatus('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
                if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
          </div>

          {!showNote && !note && (
            <button
              type="button"
              className="capture-add-note-btn"
              onClick={() => setShowNote(true)}
            >
              <FileText size={14} aria-hidden="true" />
              <span>Add description or notes</span>
            </button>
          )}

          {(showNote || note) && (
            <div className="capture-note-wrap">
              <label htmlFor={noteFieldId} className="quick-add-label--sr">
                Task description
              </label>
              <textarea
                id={noteFieldId}
                className="capture-note-input"
                value={note}
                placeholder="Add details, notes, links, or context…"
                onChange={(e) => {
                  currentNote.current = e.target.value;
                  setNote(e.target.value);
                }}
                rows={2}
              />
            </div>
          )}
        </div>

        <fieldset className="capture-options">
          <legend>Save to</legend>

          <div className="capture-options-row">
            <label>
              Project
              <select
                aria-label="Capture project"
                value={chosenProject}
                onChange={(e) => setChosenProject(e.target.value)}
              >
                {props.captureProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Due date
              <input
                aria-label="Capture due date"
                type="date"
                value={finalDate ?? ''}
                onChange={(e) => setChosenDate(e.target.value || null)}
              />
            </label>
          </div>

          <div className="capture-date-chips" role="group" aria-label="Quick due date">
            <button
              type="button"
              className="mini"
              aria-pressed={chosenDate === todayStr()}
              onClick={() => setChosenDate(todayStr())}
            >
              Today
            </button>
            <button
              type="button"
              className="mini"
              aria-pressed={chosenDate === addDays(todayStr(), 1)}
              onClick={() => setChosenDate(addDays(todayStr(), 1))}
            >
              Tomorrow
            </button>
            <button
              type="button"
              className="mini"
              aria-pressed={chosenDate === null}
              onClick={() => setChosenDate(null)}
            >
              No date
            </button>
            <button
              type="button"
              className="mini"
              aria-pressed={chosenDate === undefined}
              onClick={() => setChosenDate(undefined)}
            >
              Use parsed date
            </button>
          </div>

          <div className="capture-project-chips" role="group" aria-label="Quick project">
            {props.captureProjects.slice(0, 5).map((project) => (
              <button
                key={project.id}
                type="button"
                className="mini"
                aria-pressed={chosenProject === project.id}
                onClick={() => setChosenProject(project.id)}
              >
                <span className="dot" style={{ background: project.color }} />
                {project.name}
              </button>
            ))}
          </div>

          <div className="capture-extra-options">
            <div className="capture-option-block">
              <span className="capture-option-label">Priority</span>
              <div className="capture-priority-chips" role="group" aria-label="Priority">
                <button
                  type="button"
                  className="mini priority-chip p1-chip"
                  aria-pressed={finalPriority === 1}
                  onClick={() => setChosenPriority(1)}
                  title="P1 High priority"
                >
                  <span className="p-dot p1-dot" aria-hidden="true" />
                  P1
                </button>
                <button
                  type="button"
                  className="mini priority-chip p2-chip"
                  aria-pressed={finalPriority === 2}
                  onClick={() => setChosenPriority(2)}
                  title="P2 Medium priority"
                >
                  <span className="p-dot p2-dot" aria-hidden="true" />
                  P2
                </button>
                <button
                  type="button"
                  className="mini priority-chip p3-chip"
                  aria-pressed={finalPriority === 3}
                  onClick={() => setChosenPriority(3)}
                  title="P3 Low priority"
                >
                  <span className="p-dot p3-dot" aria-hidden="true" />
                  P3
                </button>
                <button
                  type="button"
                  className="mini"
                  aria-pressed={finalPriority === 0}
                  onClick={() => setChosenPriority(0)}
                >
                  None
                </button>
                <button
                  type="button"
                  className="mini"
                  aria-pressed={chosenPriority === undefined}
                  onClick={() => setChosenPriority(undefined)}
                >
                  Use parsed
                </button>
              </div>
            </div>

            <div className="capture-option-block">
              <span className="capture-option-label">Time & Repeat</span>
              <div className="capture-time-chips" role="group" aria-label="Time and recurrence">
                <button
                  type="button"
                  className="mini"
                  aria-pressed={finalTime === '09:00'}
                  onClick={() => setChosenTime('09:00')}
                >
                  9:00 AM
                </button>
                <button
                  type="button"
                  className="mini"
                  aria-pressed={finalTime === '14:00'}
                  onClick={() => setChosenTime('14:00')}
                >
                  2:00 PM
                </button>
                <button
                  type="button"
                  className="mini"
                  aria-pressed={finalTime === '18:00'}
                  onClick={() => setChosenTime('18:00')}
                >
                  6:00 PM
                </button>
                <button
                  type="button"
                  className="mini"
                  aria-pressed={chosenRecurrence?.includes('FREQ=DAILY')}
                  onClick={() =>
                    setChosenRecurrence(
                      chosenRecurrence?.includes('FREQ=DAILY')
                        ? null
                        : makeRecurrence('daily', finalDate ?? todayStr()),
                    )
                  }
                >
                  Daily
                </button>
                <button
                  type="button"
                  className="mini"
                  aria-pressed={chosenRecurrence?.includes('FREQ=WEEKLY')}
                  onClick={() =>
                    setChosenRecurrence(
                      chosenRecurrence?.includes('FREQ=WEEKLY')
                        ? null
                        : makeRecurrence('weekly', finalDate ?? todayStr()),
                    )
                  }
                >
                  Weekly
                </button>
              </div>
            </div>

            {availableTags.length > 0 && (
              <div className="capture-option-block">
                <span className="capture-option-label">Tags</span>
                <div className="capture-tags-chips" role="group" aria-label="Tags">
                  {availableTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="mini tag-chip"
                      aria-pressed={finalTags.includes(tag)}
                      onClick={() => toggleExtraTag(tag)}
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </fieldset>

        <div id={`${fieldId}-preview`} className="capture-preview" role="status" aria-label="Task preview">
          <strong>Will add</strong>
          <p>{title.trim() ? natural.title || 'Add a task name' : 'Your task name'}</p>
          <p>
            {props.captureProjects.find((project) => project.id === projectId)?.name ?? 'Choose a project'} ·{' '}
            {finalDate ? friendlyDate(finalDate, todayStr()) : 'No due date'}
            {finalTime ? ` · ${finalTime}` : ''}
          </p>
          {finalRecurrence && <p>{describeRecurrence(finalRecurrence)}</p>}
          {finalPriority > 0 && <p>Priority {finalPriority}</p>}
          {finalTags.length > 0 && <p>{finalTags.map((tag) => `#${tag}`).join(' ')}</p>}
          {note.trim() && <p className="capture-preview-note">Note: {note.trim()}</p>}
          {chosenDate !== undefined && natural.dueDate && (
            <p>Selected date replaces the parsed date ({friendlyDate(natural.dueDate, todayStr())}).</p>
          )}
        </div>

        {error && (
          <p id={`${fieldId}-error`} className="quick-add-error" role="alert">
            {error}
          </p>
        )}

        {status && (
          <div className="quick-add-status capture-status-toast" role="status">
            <CheckCircle2 size={16} className="capture-status-icon" aria-hidden="true" />
            <span>{status}</span>
          </div>
        )}

        {pending > 0 && (
          <div className="quick-add-status" role="status">
            Saving {pending} {pending === 1 ? 'task' : 'tasks'}…
          </div>
        )}

        {failed.map((job) => (
          <div className="quick-add-failed" key={job.id}>
            <p role="alert">Couldn't save this task. Your text is kept here:</p>
            <p className="quick-add-draft">{job.raw}</p>
            <button
              type="button"
              className="mini"
              onClick={() => {
                if (retryingCaptures.has(job)) return;
                retryingCaptures.add(job);
                rememberFailed((failedCaptures.get(db.name) ?? []).filter((item) => item.id !== job.id));
                enqueue(job);
              }}
            >
              Retry save
            </button>
          </div>
        ))}

        <div className="capture-footer-bar">
          <div className="capture-footer-hint">
            <kbd>↵ Enter</kbd> to add · <kbd>Esc</kbd> to close
          </div>
          <div className="capture-footer-actions">
            {props.onClose && (
              <button
                type="button"
                className="btn-secondary capture-done-btn"
                onClick={props.onClose}
              >
                <Check size={14} strokeWidth={2.2} aria-hidden="true" />
                Done
              </button>
            )}
            <button
              type="submit"
              className="btn-primary quick-add-submit"
              disabled={!title.trim()}
            >
              <Plus size={15} strokeWidth={2.4} aria-hidden="true" />
              Add
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
