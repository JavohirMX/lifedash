import { requestComplete } from '../completionPrompt';
import { X, Check, StickyNote } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import NoteEditor from './NoteEditor';
import Attachments from './Attachments';
import SubtaskAdd from './SubtaskAdd';
import TaskTitle from './TaskTitle';
import { useLiveQuery } from 'dexie-react-hooks';
import { runningSession, sessionSeconds, focusTotals, formatClock, formatDuration } from '../focus';
import { startFocus, stopFocus } from '../repo';
import { db, INBOX_ID } from '../db';
import { addTask, deleteTask, skipTask, updateTask, addBlocker, removeBlocker, addTag, removeTag } from '../repo';
import { makeRecurrence, describeRecurrence, isRecurrenceValid, blockersOf, blockerCandidates, normalizeTask } from '../logic';
import { todayStr } from '../dates';
import { projectTree } from '../projects';
import type { Task } from '../types';

type RecChoice = 'none' | 'daily' | 'weekly' | 'monthly' | 'ndays' | 'invalid';

function currentChoice(t: Task): RecChoice {
  if (t.recurrence && !isRecurrenceValid(t.recurrence)) return 'invalid';
  const d = describeRecurrence(t.recurrence);
  if (!d) return 'none';
  if (d === 'Daily') return 'daily';
  if (d === 'Weekly') return 'weekly';
  if (d === 'Monthly') return 'monthly';
  return 'ndays';
}

export default function TaskDetail(props: { taskId: string; onClose: () => void; onOpenNote: (noteId: string) => void }) {
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement;
    return () => { if (opener.current?.isConnected) opener.current.focus(); };
  }, []);
  const task = useLiveQuery(() => db.tasks.get(props.taskId), [props.taskId]);
  const projects = useLiveQuery(() => db.projects.orderBy('order').toArray(), []);
  const goals = useLiveQuery(() => db.goals.orderBy('order').toArray(), []);
  const subtasks = useLiveQuery(
    () => db.tasks.where('parentId').equals(props.taskId).filter((t) => t.status !== 'archived').toArray(),
    [props.taskId],
  );
  const allTasks = useLiveQuery(() => db.tasks.toArray(), []);
  const focusSessions = useLiveQuery(() => db.focusSessions.toArray(), []);
  const [focusNow, setFocusNow] = useState(() => Date.now());
  const running = focusSessions ? runningSession(focusSessions) : null;
  const runningHere = running?.taskId === props.taskId;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setFocusNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running?.id]);
  const sourceNote = useLiveQuery(
    () => (task?.noteId ? db.notes.get(task.noteId) : undefined),
    [task?.noteId],
  );
  const [nDays, setNDays] = useState(3);
  const [blockerPick, setBlockerPick] = useState('');
  const [blockerError, setBlockerError] = useState('');
  const [newTag, setNewTag] = useState('');

  useEffect(() => {
    if (task) panel.current?.querySelector<HTMLInputElement>('.detail-title')?.focus();
  }, [task?.id]);

  // Esc closes the panel - but not when it was pressed inside a dialog or
  // the palette on top (those handle Escape themselves; by the time the
  // event reaches window, their React handler may have already unmounted
  // the overlay, so we check the event target, not the live DOM).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.target instanceof HTMLElement && e.target.closest('.palette-overlay, [role=dialog], dialog[open]')) return;
      props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!task || !projects) return null;
  const choice = currentChoice(task);

  async function setRecurrence(c: Exclude<RecChoice, 'invalid'>, interval = nDays) {
    if (!task) return;
    if (c === 'none') {
      await updateTask(task.id, { recurrence: null });
      return;
    }
    const anchor = task.dueDate ?? todayStr();
    await updateTask(task.id, {
      dueDate: anchor,
      recurrence: makeRecurrence(c, anchor, interval),
    });
  }

  return (
    <aside ref={panel} className="detail" aria-label="Task details">
      <div className="detail-head">
        <button className="close" aria-label="Close task details" onClick={props.onClose}><X size={16} strokeWidth={2} /></button>
      </div>
      <TaskTitle id={task.id} title={task.title} />
      <div className="focus-section" aria-label="Focus timer">
        {runningHere && running ? (
          <>
            <span className="focus-clock num">{formatClock(sessionSeconds(running, focusNow))}</span>
            <button className="btn-secondary" onClick={() => void stopFocus()}>Stop</button>
          </>
        ) : (
          <button className="btn-secondary" onClick={() => void startFocus(task.id)}>
            {running ? 'Switch focus here' : 'Start focus'}
          </button>
        )}
        {focusSessions && focusTotals(focusSessions, todayStr(), focusNow).perTask.get(task.id) ? (
          <span className="focus-total num">
            {formatDuration(focusTotals(focusSessions, todayStr(), focusNow).perTask.get(task.id) ?? 0)} total
          </span>
        ) : null}
      </div>
      <NoteEditor collection="tasks" key={task.id} docKey={task.id} note={task.note} noteDoc={task.noteDoc} onSave={(doc, text) => updateTask(task.id, { noteDoc: doc, note: text })} />
      {task.noteId && sourceNote && (
        <button className="note-source" onClick={() => props.onOpenNote(task.noteId!)}>
          <StickyNote size={13} strokeWidth={2} aria-hidden="true" />
          From note: {sourceNote.title || 'Untitled'}
        </button>
      )}
      <label className="field">
        <span>Due date</span>
        <input
          type="date"
          value={task.dueDate ?? ''}
          onChange={(e) => void updateTask(task.id, { dueDate: e.target.value || null })}
        />
      </label>
      {task.dueDate && (
        <label className="field">
          <span>Time (optional - shows in Planner)</span>
          <input
            type="time"
            value={task.dueTime ?? ''}
            onChange={(e) => void updateTask(task.id, { dueTime: e.target.value || null })}
          />
        </label>
      )}
      <label className="field">
        <span>Project</span>
        <select
          value={task.projectId}
          onChange={(e) => void updateTask(task.id, { projectId: e.target.value })}
        >
          {projectTree(projects).map(({ project: p, depth }) => (
            <option key={p.id} value={p.id}>{' '.repeat(depth)}{depth > 0 ? '– ' : ''}{p.name}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Priority</span>
        <select
          aria-label="Priority"
          value={task.priority}
          onChange={(e) => void updateTask(task.id, { priority: Number(e.target.value) })}
        >
          <option value={0}>None</option>
          <option value={1}>P1 - high</option>
          <option value={2}>P2 - medium</option>
          <option value={3}>P3 - low</option>
        </select>
      </label>
      <label className="field">
        <span>Goal</span>
        <select
          aria-label="Goal"
          value={task.goalId ?? ''}
          onChange={(e) => void updateTask(task.id, { goalId: e.target.value || null })}
        >
          <option value="">No goal</option>
          {(goals ?? []).filter((g) => g.status === 'active').map((g) => (
            <option key={g.id} value={g.id}>{g.title}</option>
          ))}
          {task.goalId && !(goals ?? []).some((g) => g.id === task.goalId && g.status === 'active') && (
            <option value={task.goalId} disabled>
              {(goals ?? []).find((g) => g.id === task.goalId)?.title ?? 'Linked goal'} (archived)
            </option>
          )}
        </select>
      </label>
      <label className="field">
        <span>Repeats</span>
        <select value={choice} onChange={(e) => void setRecurrence(e.target.value as Exclude<RecChoice, 'invalid'>)}>
          {choice === 'invalid' && <option value="invalid" disabled>Unreadable saved rule</option>}
          <option value="none">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly (same weekday)</option>
          <option value="monthly">Monthly (same day)</option>
          <option value="ndays">Every N days</option>
        </select>
      </label>
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
              min={1}
              max={365}
              value={nDays}
              onChange={(e) => {
                const v = Math.max(1, Number(e.target.value) || 1);
                setNDays(v);
                void setRecurrence('ndays', v);
              }}
            />
            days
          </span>
        </label>
      )}
      {task.recurrence && task.dueDate && task.status !== 'done' && (
        <div className="field row">
          <button className="btn-secondary" onClick={() => void skipTask(task)}>
            Skip this occurrence
          </button>
        </div>
      )}
      {(task.skippedDates?.length ?? 0) > 0 && (
        <p className="date-sub">Skipped: {(task.skippedDates ?? []).join(', ')}</p>
      )}
      <label className="field row">
        <input
          type="checkbox"
          checked={task.pinned}
          onChange={(e) => void updateTask(task.id, { pinned: e.target.checked })}
        />
        <span>Pinned to top</span>
      </label>

      <div className="subs">
        <h3>Blocked by</h3>
        {blockersOf((allTasks ?? []).map(normalizeTask), normalizeTask(task)).map((b) => (
          <div key={b.id} className={`sub-row ${b.status === 'done' ? 'done' : ''}`}>
            <span className={`dep-dot ${b.status}`} />
            <span style={{ flex: 1 }}>{b.title}</span>
            <button className="mini" aria-label={`Remove blocker ${b.title}`} onClick={() => void removeBlocker(task.id, b.id)}><X size={13} strokeWidth={2} /></button>
          </div>
        ))}
        <div className="dep-add">
          <select aria-label="Add a blocker" value={blockerPick} onChange={(e) => setBlockerPick(e.target.value)}>
            <option value="">Add a blocker...</option>
            {blockerCandidates(allTasks ?? [], task)
              .slice(0, 200)
              .map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
          </select>
          <button
            className="mini"
            disabled={!blockerPick}
            onClick={() => {
              void addBlocker(task.id, blockerPick).then((r) => {
                setBlockerError(r.ok ? '' : (r.reason ?? 'Could not add blocker.'));
                if (r.ok) setBlockerPick('');
              });
            }}
          >
            Add
          </button>
        </div>
        {blockerError && <p className="dep-error">{blockerError}</p>}
      </div>

      <div className="subs">
        <h3>Tags</h3>
        <div className="chips">
          {(task.tags ?? []).map((t) => (
            <span key={t} className="chip">
              #{t}
              <button aria-label={`Remove tag ${t}`} onClick={() => void removeTag(task.id, t)}><X size={12} strokeWidth={2} /></button>
            </span>
          ))}
          <input
            className="chip-input"
            value={newTag}
            placeholder="Add tag"
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newTag.trim()) {
                void addTag(task.id, newTag);
                setNewTag('');
              }
            }}
          />
        </div>
      </div>

      <div className="subs">
        <h3>Subtasks</h3>
        {(subtasks ?? []).map((s) => (
          <div key={s.id} className={`sub-row ${s.status === 'done' ? 'done' : ''}`}>
            <button
              className={`checkbox ${s.status === 'done' ? 'checked' : ''}`}
              onClick={() => void requestComplete(s)}
            >
              {s.status === 'done' ? <Check size={12} strokeWidth={2.5} aria-hidden="true" /> : null}
            </button>
            <span>{s.title}</span>
          </div>
        ))}
        <SubtaskAdd task={task} />
      </div>

      <Attachments taskId={task.id} />

      <button
        className="danger"
        onClick={() => {
          void deleteTask(task).then(props.onClose);
        }}
      >
        Delete task
      </button>
    </aside>
  );
}
