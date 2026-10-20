import { useState } from 'react';
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

  // Monday of this week
  const dow = (parseLocalDate(today).getDay() + 6) % 7; // Mon=0
  const monday = addDays(today, -dow);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const active = props.tasks.filter((t) => t.status === 'active' && t.parentId === null);
  const byDay = new Map<string, Task[]>();
  for (const t of active) {
    if (!t.dueDate) continue;
    if (!byDay.has(t.dueDate)) byDay.set(t.dueDate, []);
    byDay.get(t.dueDate)!.push(t);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99') || a.order - b.order);
  }

  return (
    <section>
      <h1>Week</h1>
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
              void updateTask(id, { dueDate: day });
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
