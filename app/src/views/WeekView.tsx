import './workflow.css';
import { useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { updateTask } from '../repo';
import TaskRow from '../components/TaskRow';
import { TASK_DRAG_MIME } from '../components/TaskList';
import { todayStr, addDays, parseLocalDate, friendlyDate } from '../dates';
import type { Task } from '../types';

// Week view: Monday-Sunday columns, tasks by due date. Drag between
// columns to reschedule. Days with habits/planner relevance stay in
// their own views - this is purely the task week.
export default function WeekView(props: { tasks: Task[]; onOpen: (id: string) => void }) {
  const today = todayStr();
  const [overDay, setOverDay] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);

  const writing = useRef(new Set<string>());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, { date: string; title: string }>>({});
  async function schedule(id: string, date: string) {
    if (writing.current.has(id)) return;
    writing.current.add(id); setPending(new Set(writing.current));
    setErrors(current => { const next = { ...current }; delete next[id]; return next; });
    const title = props.tasks.find(t => t.id === id)?.title || 'task';
    try { await updateTask(id, { dueDate: date }); }
    catch { setErrors(current => ({ ...current, [id]: { date, title } })); }
    finally { writing.current.delete(id); setPending(new Set(writing.current)); }
  }

  // Monday of the shown week (weekOffset 0 = this week)
  const dow = (parseLocalDate(today).getDay() + 6) % 7; // Mon=0
  const monday = addDays(today, -dow + weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const active = props.tasks.filter((t) => t.status === 'active' && t.parentId === null);
  // Overdue tasks only belong to the current week; past weeks are history,
  // future weeks haven't happened.
  const overdue = weekOffset === 0
    ? active.filter((t) => t.dueDate !== null && t.dueDate < today)
    : [];
  const byDay = new Map<string, Task[]>();
  for (const t of active) {
    if (!t.dueDate) continue;
    // On the current week, overdue tasks live in the overdue strip, not
    // their (past) day column.
    if (weekOffset === 0 && t.dueDate < today) continue;
    if (!byDay.has(t.dueDate)) byDay.set(t.dueDate, []);
    byDay.get(t.dueDate)!.push(t);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99') || a.order - b.order);
  }

  // Explicit short dates, not friendly names: "Yesterday - Oct 25" is confusing.
  const fmtDay = (d: string) => {
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    if (d.slice(0, 4) !== today.slice(0, 4)) opts.year = 'numeric';
    return parseLocalDate(d).toLocaleDateString('en-US', opts);
  };
  const rangeLabel = `${fmtDay(monday)} - ${fmtDay(addDays(monday, 6))}`;

  return (
    <section>
      <h1>
        Week <span className="date-sub">{rangeLabel}</span>
        <span className="week-nav">
          <button className="icon-btn" aria-label="Previous week" title="Previous week" onClick={() => setWeekOffset((w) => w - 1)}>
            <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
          </button>
          {weekOffset !== 0 && (
            <button className="mini" onClick={() => setWeekOffset(0)}>Today</button>
          )}
          <button className="icon-btn" aria-label="Next week" title="Next week" onClick={() => setWeekOffset((w) => w + 1)}>
            <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </span>
      </h1>

      {pending.size > 0 && <p className="workflow-hint" role="status">Scheduling…</p>}
      {Object.entries(errors).map(([id, error]) => <div key={id} className="sub-add-feedback">
        <p role="alert">Date wasn't saved for "{error.title}". Retry to schedule it for {error.date}.</p>
        <button className="btn-secondary" onClick={() => void schedule(id, error.date)}>Retry schedule for {error.title}</button>
      </div>)}
      {overdue.length > 0 && (
        <div
          className={`week-overdue ${overDay === 'overdue' ? 'drop-hot' : ''}`}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(TASK_DRAG_MIME)) e.preventDefault();
          }}
          onDrop={(e) => {
            // Dropping here is a no-op target so dropping a task back is safe;
            // overdue tasks leave this strip as soon as they get a new date.
            e.preventDefault();
          }}
        >
          <h2>Overdue <span className="date-sub num">{overdue.length}</span></h2>
          {overdue.map((t) => (
            <div key={t.id} className="backlog-row">
              <div
                className="backlog-task"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(TASK_DRAG_MIME, t.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
              >
                <TaskRow task={t} allTasks={props.tasks} onOpen={props.onOpen} />
              </div>
              <button className="mini" disabled={pending.has(t.id)} onClick={() => void schedule(t.id, today)}>
                <ArrowRight size={12} strokeWidth={1.75} aria-hidden="true" /> Today
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="week-grid">
        {days.map((day) => (
          <div
            key={day}
            className={`week-col ${day === today ? 'today-col' : ''} ${overDay === day ? 'drop-hot' : ''}`}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(TASK_DRAG_MIME)) {
                e.preventDefault();
                setOverDay(day);
              }
            }}
            onDragLeave={() => setOverDay((cur) => (cur === day ? null : cur))}
            onDrop={(e) => {
              const id = e.dataTransfer.getData(TASK_DRAG_MIME);
              if (!id) return;
              e.preventDefault();
              setOverDay(null);
              void schedule(id, day);
            }}
          >
            <div className="week-head">
              <span className="week-dayname">{parseLocalDate(day).toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <span className={`week-date ${day === today ? 'today' : ''}`}>{friendlyDate(day, today) === day ? day.slice(8) : friendlyDate(day, today)}</span>
            </div>
            {(byDay.get(day) ?? []).map((t) => (
              <div
                key={t.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(TASK_DRAG_MIME, t.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
              >
                <TaskRow task={t} allTasks={props.tasks} onOpen={props.onOpen} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
