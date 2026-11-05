import { useRef, useState } from 'react';
import { Calendar, Check, Flag, Repeat } from 'lucide-react';
import type { Task } from '../types';
import { togglePin, updateTask } from '../repo';
import { requestComplete } from '../completionPrompt';
import { describeRecurrence, subtaskProgress, activeBlockers, normalizeTask } from '../logic';
import { addDays, friendlyDate, todayStr } from '../dates';
import { useSwipeGesture } from '../hooks/useSwipeGesture';

export default function TaskRow(props: {
  task: Task;
  allTasks: Task[];
  showDate?: boolean;
  projectLabel?: string;
  onOpen: (id: string) => void;
  onTag?: (tag: string) => void;
}) {
  const { task, allTasks } = props;
  const done = task.status === 'done';
  const today = todayStr();
  const overdue = !done && task.dueDate !== null && task.dueDate < today;
  const progress = subtaskProgress(allTasks, task.id);
  const rec = describeRecurrence(task.recurrence);
  const blockers = activeBlockers(allTasks.map(normalizeTask), normalizeTask(task));
  const blocked = !done && blockers.length > 0;
  const tags = task.tags ?? [];

  const pinning = useRef(false);
  const [pinBusy, setPinBusy] = useState(false), [pinError, setPinError] = useState('');
  async function onPin() {
    if (pinning.current) return;
    pinning.current = true; setPinBusy(true); setPinError('');
    try { await togglePin(task); }
    catch { setPinError("Couldn't change this task's pin. Try the pin button again."); }
    finally { pinning.current = false; setPinBusy(false); }
  }

  const completing = useRef(false);
  const [completeBusy, setCompleteBusy] = useState(false), [completeError, setCompleteError] = useState('');
  async function onCheck() {
    if (completing.current) return;
    completing.current = true; setCompleteBusy(true); setCompleteError('');
    try { await requestComplete(task); }
    catch { setCompleteError("Couldn't finish this change. Check the task's current state before trying its checkbox again."); }
    finally { completing.current = false; setCompleteBusy(false); }
  }

  const { onTouchStart, onTouchMove, onTouchEnd, offsetX } = useSwipeGesture({
    onSwipeRight: () => {
      void onCheck();
    },
    onSwipeLeft: () => {
      void updateTask(task.id, { dueDate: addDays(today, 1) });
    },
    threshold: 60,
  });

  return (
    <div
      className={`task-row task-row-pin-state ${done ? 'done' : ''} ${task.pinned ? 'pinned' : ''} ${blocked ? 'blocked' : ''}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        transform: offsetX !== 0 ? `translateX(${offsetX}px)` : undefined,
        transition: offsetX === 0 ? 'transform 0.15s ease' : 'none',
      }}
    >
      <button
        className={`checkbox ${done ? 'checked' : ''}`}
        aria-label={done ? 'Mark not done' : 'Mark done'}
        disabled={completeBusy}
        onClick={() => void onCheck()}
      >
        {done ? <Check size={13} strokeWidth={2.5} aria-hidden="true" /> : null}
      </button>
      <button className="task-main" onClick={() => props.onOpen(task.id)}>
        <span className="task-title">{task.title}</span>
        <span className="task-meta">
          {task.priority > 0 && (
            <Flag size={12} strokeWidth={2} aria-label={`Priority ${task.priority}`} className={`prio prio-${task.priority}`} />
          )}
          {task.dueTime && <span className="time-chip">{task.dueTime}</span>}
          {props.showDate && task.dueDate && (
            <span className={`due ${overdue ? 'overdue' : task.dueDate === today ? 'today' : ''}`}>
              {friendlyDate(task.dueDate, today)}
            </span>
          )}
          {rec && <span className="rec"><Repeat size={11} strokeWidth={1.75} aria-hidden="true" /> {rec}</span>}
          {blocked && (
            <span className="blocked-by">blocked by {blockers[0].title}{blockers.length > 1 ? ` +${blockers.length - 1}` : ''}</span>
          )}
          {props.projectLabel && <span className="tag">{props.projectLabel}</span>}
          {tags.map((t) =>
            props.onTag ? (
              <span
                key={t}
                className="tag tag-link"
                role="button"
                tabIndex={0}
                aria-label={`Search tag ${t}`}
                onClick={(e) => { e.stopPropagation(); props.onTag!(t); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); props.onTag!(t); }
                }}
              >
                #{t}
              </span>
            ) : (
              <span key={t} className="tag">#{t}</span>
            ),
          )}
          {progress.total > 0 && (
            <span className="subs">
              {progress.done}/{progress.total}
            </span>
          )}
        </span>
      </button>
      <button
        className={`pin ${task.pinned ? 'on' : ''}`}
        title={task.pinned ? 'Unpin' : 'Pin'}
        aria-label={task.pinned ? 'Unpin task' : 'Pin task'}
        disabled={pinBusy}
        onClick={() => void onPin()}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill={task.pinned ? 'currentColor' : 'none'}
             stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 17v5" />
          <path d="M9 3h6l-1 7 3 3v2H7v-2l3-3-1-7z" />
        </svg>
      </button>
      {completeBusy && <p className="sub-add-feedback task-row-pin-feedback" role="status">Updating task…</p>}
      {completeError && <p className="sub-add-feedback task-row-pin-feedback" role="alert">{completeError}</p>}
      {pinBusy && <p className="sub-add-feedback task-row-pin-feedback" role="status">Saving pin…</p>}
      {pinError && <p className="sub-add-feedback task-row-pin-feedback" role="alert">{pinError}</p>}
    </div>
  );
}
