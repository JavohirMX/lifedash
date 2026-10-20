import { useState } from 'react';
import { updateTask } from '../repo';
import TaskRow from '../components/TaskRow';
import { TASK_DRAG_MIME } from '../components/TaskList';
import { todayStr, friendlyDate, weekdayLabel } from '../dates';
import type { Task } from '../types';

const START_HOUR = 6;
const END_HOUR = 23;

// Day planner: today's tasks on a timeline. Tasks with a dueTime sit in
// their hour; the rest are "anytime". Drag an anytime task onto an hour
// to schedule it; drag a scheduled task onto Anytime to unschedule.
export default function PlannerView(props: { tasks: Task[]; onOpen: (id: string) => void }) {
  const today = todayStr();
  const nowHour = new Date().getHours();
  const [overHour, setOverHour] = useState<number | 'anytime' | null>(null);

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
        void updateTask(id, {
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
      <div className={`anytime ${overHour === 'anytime' ? 'drop-hot' : ''}`} {...dropProps('anytime')}>
        <h2>Anytime</h2>
        {anytime.length === 0 && <p className="empty">No unscheduled tasks for today.</p>}
        {anytime.map((t) => (
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
      <div className="timeline">
        {hours.map((h) => (
          <div key={h} className={`hour-row ${overHour === h ? 'drop-hot' : ''} ${h === nowHour ? 'now' : ''}`} {...dropProps(h)}>
            <span className="hour-label">{String(h).padStart(2, '0')}:00</span>
            <div className="hour-body">
              {(byHour.get(h) ?? []).map((t) => (
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
          </div>
        ))}
      </div>
    </section>
  );
}
