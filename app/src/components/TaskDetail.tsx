import { Check } from 'lucide-react';
import { useState } from 'react';
import NoteEditor from './NoteEditor';
import Attachments from './Attachments';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, INBOX_ID } from '../db';
import { addTask, deleteTask, toggleComplete, updateTask, addBlocker, removeBlocker, addTag, removeTag } from '../repo';
import { makeRecurrence, describeRecurrence, blockersOf, normalizeTask } from '../logic';
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
  const goals = useLiveQuery(() => db.goals.orderBy('order').toArray(), []);
  const subtasks = useLiveQuery(
    () => db.tasks.where('parentId').equals(props.taskId).filter((t) => t.status !== 'archived').toArray(),
    [props.taskId],
  );
  const allTasks = useLiveQuery(() => db.tasks.toArray(), []);
  const [newSub, setNewSub] = useState('');
  const [nDays, setNDays] = useState(3);
  const [blockerPick, setBlockerPick] = useState('');
  const [blockerError, setBlockerError] = useState('');
  const [newTag, setNewTag] = useState('');

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
        <button className="close" aria-label="Close task details" onClick={props.onClose}>×</button>
      </div>
      <input
        className="detail-title"
        aria-label="Task title"
        value={task.title}
        onChange={(e) => void updateTask(task.id, { title: e.target.value })}
      />
      <NoteEditor key={task.id} task={task} />
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
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
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
        <h3>Blocked by</h3>
        {blockersOf((allTasks ?? []).map(normalizeTask), normalizeTask(task)).map((b) => (
          <div key={b.id} className={`sub-row ${b.status === 'done' ? 'done' : ''}`}>
            <span className={`dep-dot ${b.status}`} />
            <span style={{ flex: 1 }}>{b.title}</span>
            <button className="mini" onClick={() => void removeBlocker(task.id, b.id)}>×</button>
          </div>
        ))}
        <div className="dep-add">
          <select aria-label="Add a blocker" value={blockerPick} onChange={(e) => setBlockerPick(e.target.value)}>
            <option value="">Add a blocker...</option>
            {(allTasks ?? [])
              .filter((t) => t.status === 'active' && t.id !== task.id && !(task.blockedBy ?? []).includes(t.id))
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
              <button onClick={() => void removeTag(task.id, t)}>×</button>
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
              onClick={() => void toggleComplete(s)}
            >
              {s.status === 'done' ? <Check size={12} strokeWidth={2.5} aria-hidden="true" /> : null}
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
