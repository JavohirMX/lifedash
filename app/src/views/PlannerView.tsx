import './workflow.css';
import { useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { updateTask } from '../repo';
import TaskRow from '../components/TaskRow';
import { TASK_DRAG_MIME } from '../components/TaskList';
import { todayStr, friendlyDate, weekdayLabel } from '../dates';
import type { Task } from '../types';

type SchedulePatch = { dueDate?: string; dueTime: string | null };
const START_HOUR = 6;
const END_HOUR = 23;

// Day planner: today's tasks on a timeline. Tasks with a dueTime sit in
// their hour; the rest are "anytime". Drag an anytime task onto an hour
// to schedule it; drag a scheduled task onto Anytime to unschedule.
export default function PlannerView(props: { tasks: Task[]; onOpen: (id: string) => void; onTag?: (tag: string) => void }) {
  const today = todayStr();
  const nowHour = new Date().getHours();
  const [overHour, setOverHour] = useState<number | 'anytime' | null>(null);
  const [pickerId, setPickerId] = useState<string | null>(null);

  const writing = useRef(new Set<string>());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, { patch: SchedulePatch; title: string }>>({});
  async function schedule(id: string, patch: SchedulePatch) {
    if (writing.current.has(id)) return;
    writing.current.add(id); setPending(new Set(writing.current));
    setErrors(current => { const next = { ...current }; delete next[id]; return next; });
    const title = props.tasks.find(t => t.id === id)?.title || 'task';
    try {
      await updateTask(id, patch);
      setPickerId(current => current === id ? null : current);
      setDrafts(current => { const next = { ...current }; delete next[id]; return next; });
    } catch { setErrors(current => ({ ...current, [id]: { patch, title } })); }
    finally { writing.current.delete(id); setPending(new Set(writing.current)); }
  }
  const renderTask = (t: Task) => <PlanTask key={t.id} t={t} tasks={props.tasks} onOpen={props.onOpen} onTag={props.onTag}
    open={pickerId === t.id} togglePicker={() => setPickerId(current => current === t.id ? null : t.id)}
    closePicker={() => setPickerId(null)} busy={pending.has(t.id)} draft={drafts[t.id] ?? t.dueTime ?? ''}
    setDraft={value => setDrafts(current => ({ ...current, [t.id]: value }))} save={patch => schedule(t.id, patch)} error={errors[t.id]} />;

  const dueToday = props.tasks.filter((t) => t.status === 'active' && t.dueDate === today && t.parentId === null);
  const anytime = dueToday.filter((t) => !t.dueTime);
  const byHour = new Map<number, Task[]>();
  for (const t of dueToday) {
    if (!t.dueTime) continue;
    const h = Math.min(END_HOUR, Math.max(START_HOUR, Number(t.dueTime.slice(0, 2))));
    if (!byHour.has(h)) byHour.set(h, []);
    byHour.get(h)!.push(t);
  }

  const hours: number[] = [];
  for (let h = START_HOUR; h <= END_HOUR; h++) hours.push(h);

  function dropProps(hour: number | 'anytime') {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (e.dataTransfer.types.includes(TASK_DRAG_MIME)) {
          e.preventDefault();
          setOverHour(hour);
        }
      },
      onDragLeave: () => setOverHour((cur) => (cur === hour ? null : cur)),
      onDrop: (e: React.DragEvent) => {
        const id = e.dataTransfer.getData(TASK_DRAG_MIME);
        if (!id) return;
        e.preventDefault();
        setOverHour(null);
        void schedule(id, {
          dueDate: today,
          dueTime: hour === 'anytime' ? null : `${String(hour).padStart(2, '0')}:00`,
        });
      },
    };
  }

  return (
    <section>
      <h1>
        Planner <span className="date-sub">{friendlyDate(today, today)} · {weekdayLabel(today)}</span>
      </h1>

      {pending.size > 0 && <p className="workflow-hint" role="status">Scheduling…</p>}
      {Object.entries(errors).filter(([id]) => id !== pickerId).map(([id, error]) => <div key={id} className="sub-add-feedback">
        <p role="alert">Time wasn't saved for "{error.title}". Retry the failed change or choose another time.</p>
        <button className="btn-secondary" onClick={() => void schedule(id, error.patch)}>Retry time for {error.title}</button>
      </div>)}
      <div className={`anytime ${overHour === 'anytime' ? 'drop-hot' : ''}`} {...dropProps('anytime')}>
        <h2>Anytime</h2>
        {anytime.length === 0 && <p className="empty">No unscheduled tasks for today.</p>}
        {anytime.map(renderTask)}
      </div>
      <div className="timeline">
        {hours.map((h) => (
          <div key={h} className={`hour-row ${overHour === h ? 'drop-hot' : ''} ${h === nowHour ? 'now' : ''}`} {...dropProps(h)}>
            <span className="hour-label">{String(h).padStart(2, '0')}:00</span>
            <div className="hour-body">
              {(byHour.get(h) ?? []).map(renderTask)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PlanTask({ t, tasks, onOpen, onTag, open, togglePicker, closePicker, busy, draft, setDraft, save, error }: {
  error?: { patch: SchedulePatch; title: string };
  t: Task; tasks: Task[]; onOpen: (id: string) => void; onTag?: (tag: string) => void;
  open: boolean; togglePicker: () => void; closePicker: () => void; busy: boolean;
  draft: string; setDraft: (value: string) => void; save: (patch: SchedulePatch) => Promise<void>;
}) {
    return (
      <div className="plan-item">
        <div className="plan-row">
          <div
            className="plan-drag"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(TASK_DRAG_MIME, t.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
          >
            <TaskRow task={t} allTasks={tasks} onOpen={onOpen} onTag={onTag} />
          </div>
          <button
            className="icon-btn"
            aria-label={`Set time for ${t.title}`}
            title="Set time"
            onClick={togglePicker} disabled={busy}
          >
            <Clock size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        {open && (
          <div className="time-pop">
            <input
              type="time"
              aria-label="Task time"
              value={draft} readOnly={busy} aria-disabled={busy}
              onChange={(e) => {
                if (!e.target.value) return;
                setDraft(e.target.value);
                void save({ dueDate: todayStr(), dueTime: e.target.value });
              }}
            />
            {t.dueTime && (
              <button
                className="mini" disabled={busy}
                onClick={() => {
                  void save({ dueTime: null });
                }}
              >
                Anytime
              </button>
            )}
            <button className="mini" onClick={closePicker} disabled={busy}>Close</button>
          </div>
        )}
        {open && error && <div className="sub-add-feedback">
          <p role="alert">Time wasn't saved. Your choice is kept here. Retry or choose another time.</p>
          <button className="btn-secondary" onClick={() => void save(error.patch)}>Retry time for {t.title}</button>
        </div>}
      </div>
    );
  }

