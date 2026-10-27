import './workflow.css';
import { requestComplete } from '../completionPrompt';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { todayStr, addDays, friendlyDate, weekdayLabel } from '../dates';
import type { Task } from '../types';

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // YYYY-MM
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function shiftMonth(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Monday-first grid cells covering the month, padded with neighbor-month
// days - same week start as the Week view.
export function monthCells(key: string): string[] {
  const [y, m] = key.split('-').map(Number);
  const first = `${key}-01`;
  const startOffset = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells: string[] = [];
  for (let i = startOffset; i > 0; i--) cells.push(addDays(first, -i));
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${key}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7 !== 0) cells.push(addDays(cells[cells.length - 1], 1));
  return cells;
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export default function CalendarView(props: { tasks: Task[]; onOpen: (id: string) => void }) {
  const today = todayStr();
  const [month, setMonth] = useState(monthKey(today));
  const [day, setDay] = useState<string | null>(null);

  const dayDetails = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (day !== null) dayDetails.current?.scrollIntoView({ block: 'nearest' });
  }, [day]);

  const byDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of props.tasks) {
      if (t.dueDate === null || t.status === 'archived' || t.parentId !== null) continue;
      const list = map.get(t.dueDate) ?? [];
      list.push(t);
      map.set(t.dueDate, list);
    }
    return map;
  }, [props.tasks]);

  const cells = monthCells(month);

  return (
    <section>
      <h1>
        Calendar
        <span className="date-sub">
          <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft size={15} strokeWidth={2} />
          </button>
          <strong className="cal-month">{monthLabel(month)}</strong>
          <button className="icon-btn" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight size={15} strokeWidth={2} />
          </button>
          {month !== monthKey(today) && (
            <button className="mini" onClick={() => setMonth(monthKey(today))}>Today</button>
          )}
        </span>
      </h1>
      <p className="workflow-hint">Top-level tasks by due date, including completed tasks. Choose a day number to see its full list below the calendar.</p>
      <div className="cal-grid" role="grid" aria-label={monthLabel(month)}>
        {WEEKDAYS.map((d) => (
          <div key={d} className="cal-weekday">{d}</div>
        ))}
        {cells.map((date) => {
          const inMonth = monthKey(date) === month;
          const dayTasks = byDate.get(date) ?? [];
          return (
            <div
              key={date}
              role="gridcell"
              className={`cal-cell${inMonth ? '' : ' outside'}${date === today ? ' today' : ''}${day === date ? ' selected' : ''}`}
            >
              <button
                className="cal-day num"
                aria-label={`${dayTasks.length} due ${weekdayLabel(date)} ${date}`}
                aria-pressed={day === date}
                onClick={() => setDay(day === date ? null : date)}
              >
                {Number(date.slice(8))}
              </button>
              <div className="cal-tasks">
                {dayTasks.slice(0, 3).map((t) => (
                  <button
                    key={t.id}
                    className={`cal-task${t.status === 'done' ? ' done' : ''}`}
                    title={t.title}
                    onClick={() => props.onOpen(t.id)}
                  >
                    {t.title}
                  </button>
                ))}
                {dayTasks.length > 3 && (
                  <button className="cal-more num" onClick={() => setDay(day === date ? null : date)}>
                    +{dayTasks.length - 3} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {day !== null && (
        <div ref={dayDetails} className="load-drill cal-drill" role="region" aria-label="Selected day tasks">
          <p className="widget-meta num">{weekdayLabel(day)} · {friendlyDate(day, today)} · {(byDate.get(day) ?? []).length} due</p>
          {(byDate.get(day) ?? []).length === 0 ? (
            <p className="widget-empty">Nothing due.</p>
          ) : (
            <ul className="widget-list">
              {(byDate.get(day) ?? []).map((t) => (
                <li key={t.id}>
                  <button
                    className={`checkbox ${t.status === 'done' ? 'checked' : ''}`}
                    aria-label={t.status === 'done' ? 'Mark not done' : 'Mark done'}
                    onClick={() => void requestComplete(t)}
                  >
                    {t.status === 'done' ? <Check size={13} strokeWidth={2.5} aria-hidden="true" /> : null}
                  </button>
                  <button className={`widget-task ${t.status === 'done' ? 'done' : ''}`} onClick={() => props.onOpen(t.id)}>{t.title}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
