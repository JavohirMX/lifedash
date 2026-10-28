import { requestComplete } from '../completionPrompt';
import { X, Check, StickyNote } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import NoteEditor from './NoteEditor';
import Attachments from './Attachments';
import SubtaskAdd from './SubtaskAdd';
import TaskTitle from './TaskTitle';
import TaskTags from './TaskTags';
import TaskBlockers from './TaskBlockers';
import TaskDelete from './TaskDelete';
import TaskPriority from './TaskPriority';
import TaskPin from './TaskPin';
import TaskLinkField from './TaskLinkField';
import TaskDateField from './TaskDateField';
import TaskRecurrence from './TaskRecurrence';
import TaskSkip from './TaskSkip';
import TaskFocus from './TaskFocus';
import { useLiveQuery } from 'dexie-react-hooks';
import { runningSession, sessionSeconds, focusTotals, formatClock, formatDuration } from '../focus';
import { db, INBOX_ID } from '../db';
import { addTask, updateTask } from '../repo';
import { todayStr } from '../dates';
import { projectTree } from '../projects';

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


  return (
    <aside ref={panel} className="detail" aria-label="Task details">
      <div className="detail-head">
        <button className="close" aria-label="Close task details" onClick={props.onClose}><X size={16} strokeWidth={2} /></button>
      </div>
      <TaskTitle id={task.id} title={task.title} />
      <TaskFocus id={task.id} runningHere={Boolean(runningHere)} running={Boolean(running)} clock={runningHere && running && <span className="focus-clock num">{formatClock(sessionSeconds(running, focusNow))}</span>}>
        {focusSessions && focusTotals(focusSessions, todayStr(), focusNow).perTask.get(task.id) ? (
          <span className="focus-total num">
            {formatDuration(focusTotals(focusSessions, todayStr(), focusNow).perTask.get(task.id) ?? 0)} total
          </span>
        ) : null}
      </TaskFocus>
      <NoteEditor collection="tasks" key={task.id} docKey={task.id} note={task.note} noteDoc={task.noteDoc} onSave={(doc, text) => updateTask(task.id, { noteDoc: doc, note: text })} />
      {task.noteId && sourceNote && (
        <button className="note-source" onClick={() => props.onOpenNote(task.noteId!)}>
          <StickyNote size={13} strokeWidth={2} aria-hidden="true" />
          From note: {sourceNote.title || 'Untitled'}
        </button>
      )}
      <TaskDateField id={task.id} field="dueDate" value={task.dueDate ?? ''} label="Due date" type="date" />
      {task.dueDate && <TaskDateField id={task.id} field="dueTime" value={task.dueTime ?? ''} label="Time (optional - shows in Planner)" type="time" />}
      <TaskLinkField id={task.id} field="projectId" value={task.projectId} label="Project">
          {projectTree(projects).map(({ project: p, depth }) => (
            <option key={p.id} value={p.id}>{' '.repeat(depth)}{depth > 0 ? '– ' : ''}{p.name}</option>
          ))}
      </TaskLinkField>
      <TaskPriority id={task.id} priority={task.priority} />
      <TaskLinkField id={task.id} field="goalId" value={task.goalId ?? ''} label="Goal">
          <option value="">No goal</option>
          {(goals ?? []).filter((g) => g.status === 'active').map((g) => (
            <option key={g.id} value={g.id}>{g.title}</option>
          ))}
          {task.goalId && !(goals ?? []).some((g) => g.id === task.goalId && g.status === 'active') && (
            <option value={task.goalId} disabled>
              {(goals ?? []).find((g) => g.id === task.goalId)?.title ?? 'Linked goal'} (archived)
            </option>
          )}
      </TaskLinkField>
      <TaskRecurrence task={task} />
      {task.recurrence && task.dueDate && task.status !== 'done' && <TaskSkip task={task} />}
      {(task.skippedDates?.length ?? 0) > 0 && (
        <p className="date-sub">Skipped: {(task.skippedDates ?? []).join(', ')}</p>
      )}
      <TaskPin id={task.id} pinned={task.pinned} />

      <div className="subs">
        <h3>Blocked by</h3>
        <TaskBlockers task={task} tasks={allTasks ?? []} />
      </div>

      <div className="subs">
        <h3>Tags</h3>
        <TaskTags taskId={task.id} tags={task.tags ?? []} />
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

      <TaskDelete task={task} onClose={props.onClose} />
    </aside>
  );
}
