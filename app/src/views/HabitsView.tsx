import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { addHabit, archiveHabit, toggleHabitForDate } from '../repo';
import { currentStreak, weekGrid, logsByDate, isScheduledOn } from '../habits';
import { todayStr, weekdayLabel } from '../dates';

const COLORS = ['#6366f1', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#38bdf8'];
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function HabitsView() {
  const habits = useLiveQuery(() => db.habits.orderBy('order').toArray(), []);
  const logs = useLiveQuery(() => db.habitLogs.toArray(), []);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [weekdays, setWeekdays] = useState<number[] | null>(null); // null = daily

  const today = todayStr();
  const active = (habits ?? []).filter((h) => !h.archived);

  function toggleWd(d: number) {
    const cur = weekdays ?? [0, 1, 2, 3, 4, 5, 6];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort();
    setWeekdays(next.length === 7 ? null : next);
  }

  return (
    <section>
      <h1>
        Habits
        <button className="mini" style={{ marginLeft: 'auto' }} onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : '+ New habit'}
        </button>
      </h1>

      {adding && (
        <div className="habit-add">
          <input
            autoFocus
            value={name}
            placeholder="Habit name (e.g. Read 20 min)"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) {
                void addHabit(name, COLORS[active.length % COLORS.length], weekdays);
                setName('');
                setWeekdays(null);
                setAdding(false);
              }
            }}
          />
          <div className="wd-picker">
            {DAY_LETTERS.map((l, i) => {
              const on = (weekdays ?? [0, 1, 2, 3, 4, 5, 6]).includes(i);
              return (
                <button key={i} className={`wd ${on ? 'on' : ''}`} onClick={() => toggleWd(i)}>
                  {l}
                </button>
              );
            })}
            <span className="wd-hint">{weekdays === null ? 'every day' : 'custom days'}</span>
          </div>
        </div>
      )}

      {active.length === 0 && !adding && (
        <p className="empty">No habits yet. Add one - daily, or pick the weekdays.</p>
      )}

      {(logs !== undefined) &&
        active.map((h) => {
          const streak = currentStreak(h, logs, today);
          const grid = weekGrid(h, logs, today);
          const doneToday = logsByDate(logs, h.id).has(today);
          const scheduledToday = isScheduledOn(h, today);
          return (
            <div key={h.id} className="habit-card">
              <div className="habit-head">
                <span className="dot" style={{ background: h.color }} />
                <span className="habit-name">{h.name}</span>
                {streak >= 2 && <span className="streak">🔥 {streak}</span>}
                <button className="mini" title="Archive habit" onClick={() => void archiveHabit(h.id)}>
                  Archive
                </button>
              </div>
              <div className="habit-body">
                <div className="grid7">
                  {grid.map((c) => (
                    <div key={c.date} className="cell-wrap">
                      <div
                        className={`cell ${c.done ? 'done' : ''} ${!c.scheduled ? 'off' : ''} ${c.isToday ? 'today' : ''}`}
                        title={`${c.date}${c.scheduled ? '' : ' (not scheduled)'}`}
                      />
                      <span className="cell-label">{weekdayLabel(c.date)}</span>
                    </div>
                  ))}
                </div>
                {scheduledToday && (
                  <button
                    className={`habit-toggle ${doneToday ? 'done' : ''}`}
                    onClick={() => void toggleHabitForDate(h.id, today)}
                  >
                    {doneToday ? 'Done today ✓' : 'Mark done'}
                  </button>
                )}
                {!scheduledToday && <span className="att-size">not scheduled today</span>}
              </div>
            </div>
          );
        })}
    </section>
  );
}
