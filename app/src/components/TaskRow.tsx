import type { Task } from '../types';
import { toggleComplete, togglePin } from '../repo';
import { describeRecurrence, subtaskProgress, activeBlockers, normalizeTask } from '../logic';
import { friendlyDate, todayStr } from '../dates';

export default function TaskRow(props: {
  task: Task;
  allTasks: Task[];
  showDate?: boolean;
  onOpen: (id: string) => void;
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

  function onCheck() {
    if (!done && blocked) {
      const names = blockers.map((b) => `"${b.title}"`).join(', ');
      if (!window.confirm(`This task is blocked by ${names}. Complete it anyway?`)) return;
    }
    void toggleComplete(task);
  }

  return (
    <div className={`task-row ${done ? 'done' : ''} ${task.pinned ? 'pinned' : ''} ${blocked ? 'blocked' : ''}`}>
      <button
        className={`checkbox ${done ? 'checked' : ''}`}
        aria-label={done ? 'Mark not done' : 'Mark done'}
        onClick={onCheck}
      >
        {done ? '✓' : ''}
      </button>
      <button className="task-main" onClick={() => props.onOpen(task.id)}>
        <span className="task-title">{task.title}</span>
        <span className="task-meta">
          {props.showDate && task.dueDate && (
            <span className={`due ${overdue ? 'overdue' : task.dueDate === today ? 'today' : ''}`}>
              {friendlyDate(task.dueDate, today)}
            </span>
          )}
          {rec && <span className="rec">↻ {rec}</span>}
          {blocked && (
            <span className="blocked-by">blocked by {blockers[0].title}{blockers.length > 1 ? ` +${blockers.length - 1}` : ''}</span>
          )}
          {tags.map((t) => (
            <span key={t} className="tag">#{t}</span>
          ))}
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
