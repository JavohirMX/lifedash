import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, INBOX_ID } from '../db';
import { addTask, deleteTask, toggleComplete, updateTask } from '../repo';
import { makeRecurrence, describeRecurrence } from '../logic';
import { todayStr } from '../dates';
import type { Task } from '../types';

type RecChoice = 'none' | 'daily' | 'weekly' | 'monthly' | 'ndays';

function currentChoice(t: Task): RecChoice {
  const d = describeRecurrence(t.recurrence);
  if (!d) return 'none';
  if (d === 'Daily') return 'daily';
  if (d === 'Weekly') return 'weekly';
  if (d === 'Monthly') return 'monthly';
  return 'ndays';
}

export default function TaskDetail(props: { taskId: string; onClose: () => void }) {
  const task = useLiveQuery(() => db.tasks.get(props.taskId), [props.taskId]);
  const projects = useLiveQuery(() => db.projects.orderBy('order').toArray(), []);
  const subtasks = useLiveQuery(
    () => db.tasks.where('parentId').equals(props.taskId).filter((t) => t.status !== 'archived').toArray(),
    [props.taskId],
  );
  const [newSub, setNewSub] = useState('');
  const [nDays, setNDays] = useState(3);

  if (!task || !projects) return null;
  const choice = currentChoice(task);

  async function setRecurrence(c: RecChoice, interval = nDays) {
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
    <aside className="detail">
      <div className="detail-head">
        <button className="close" onClick={props.onClose}>×</button>
      </div>
      <input
        className="detail-title"
        value={task.title}
        onChange={(e) => void updateTask(task.id, { title: e.target.value })}
      />
      <textarea
        className="detail-note"
        placeholder="Notes (plain text for now - rich text lands in Phase 2)"
        value={task.note}
        rows={5}
        onChange={(e) => void updateTask(task.id, { note: e.target.value })}
      />
      <label className="field">
        <span>Due date</span>
        <input
          type="date"
          value={task.dueDate ?? ''}
          onChange={(e) => void updateTask(task.id, { dueDate: e.target.value || null })}
        />
      </label>
      <label className="field">
        <span>Project</span>
        <select
          value={task.projectId}
          onChange={(e) => void updateTask(task.id, { projectId: e.target.value })}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Repeats</span>
        <select value={choice} onChange={(e) => void setRecurrence(e.target.value as RecChoice)}>
          <option value="none">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly (same weekday)</option>
          <option value="monthly">Monthly (same day)</option>
          <option value="ndays">Every N days</option>
        </select>
      </label>
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
      <label className="field row">
        <input
          type="checkbox"
          checked={task.pinned}
          onChange={(e) => void updateTask(task.id, { pinned: e.target.checked })}
        />
        <span>Pinned to top</span>
      </label>

      <div className="subs">
        <h3>Subtasks</h3>
        {(subtasks ?? []).map((s) => (
          <div key={s.id} className={`sub-row ${s.status === 'done' ? 'done' : ''}`}>
            <button
              className={`checkbox ${s.status === 'done' ? 'checked' : ''}`}
              onClick={() => void toggleComplete(s)}
            >
              {s.status === 'done' ? '✓' : ''}
            </button>
            <span>{s.title}</span>
          </div>
        ))}
        <div className="sub-add">
          <input
            value={newSub}
            placeholder="Add a subtask..."
            onChange={(e) => setNewSub(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newSub.trim()) {
                void addTask({ title: newSub, projectId: task.projectId || INBOX_ID, parentId: task.id, dueDate: task.dueDate });
                setNewSub('');
              }
            }}
          />
        </div>
      </div>

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
