import { Flag, Check, Repeat } from 'lucide-react';
import type { Task } from '../types';
import { togglePin } from '../repo';
import { requestComplete } from '../completionPrompt';
import { describeRecurrence, subtaskProgress, activeBlockers, normalizeTask } from '../logic';
import { friendlyDate, todayStr } from '../dates';

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

  function onCheck() { void requestComplete(task); }

  return (
    <div className={`task-row ${done ? 'done' : ''} ${task.pinned ? 'pinned' : ''} ${blocked ? 'blocked' : ''}`}>
      <button
        className={`checkbox ${done ? 'checked' : ''}`}
        aria-label={done ? 'Mark not done' : 'Mark done'}
        onClick={onCheck}
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
        onClick={() => void togglePin(task)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill={task.pinned ? 'currentColor' : 'none'}
             stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 17v5" />
          <path d="M9 3h6l-1 7 3 3v2H7v-2l3-3-1-7z" />
        </svg>
      </button>
    </div>
  );
}
