import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { deriveTv } from '../tv';
import { todayStr, friendlyDate } from '../dates';

const CAP = 6;

// Read-only kiosk surface for a wall screen or homelab display.
// Always dark (Nexus palette), no editing affordances.
export default function TVDashboard() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const tasks = useLiveQuery(() => db.tasks.toArray(), []);
  const habits = useLiveQuery(() => db.habits.toArray(), []);
  const logs = useLiveQuery(() => db.habitLogs.toArray(), []);
  const journal = useLiveQuery(() => db.journal.toArray(), []);
  if (!tasks || !habits || !logs || !journal) return null;

  const today = todayStr(now);
  const tv = deriveTv(tasks, habits, logs, journal, today);
  const clock = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateLabel = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="tv-root">
      <header className="tv-head">
        <div className="tv-clock num">{clock}</div>
        <div className="tv-date">{dateLabel}</div>
      </header>
      <main className="tv-grid">
        {tv.highlight && (
          <section className="tv-card tv-highlight">
            <h2>Today's highlight</h2>
            <p className="tv-highlight-text">{tv.highlight}</p>
          </section>
        )}

        <section className="tv-card">
          <h2>Top task</h2>
          {tv.topTask ? (
            <>
              <p className="tv-top-title">{tv.topTask.title}</p>
              <p className="tv-top-meta">
                {tv.topTaskOverdueSince
                  ? `Overdue since ${friendlyDate(tv.topTaskOverdueSince, today)}`
                  : tv.topTask.dueTime
                    ? `Due ${tv.topTask.dueTime}`
                    : 'Due today'}
              </p>
            </>
          ) : (
            <p className="tv-empty">Nothing due. Enjoy the day.</p>
          )}
        </section>

        <section className="tv-card">
          <h2>Habits today</h2>
          {tv.habitsTotal > 0 ? (
            <>
              <p className="tv-big num">{tv.habitsDone} of {tv.habitsTotal}</p>
              <div className="tv-bar" role="img" aria-label={`${tv.habitsDone} of ${tv.habitsTotal} habits done`}>
                <div className="tv-bar-fill" style={{ width: `${tv.habitPct}%` }} />
              </div>
              <ul className="tv-list">
                {tv.habitsToday.slice(0, CAP).map((r) => (
                  <li key={r.habit.id} className={r.done ? 'tv-done' : ''}>{r.habit.name}</li>
                ))}
                {tv.habitsToday.length > CAP && <li className="tv-more">+{tv.habitsToday.length - CAP} more</li>}
              </ul>
            </>
          ) : (
            <p className="tv-empty">No habits scheduled today.</p>
          )}
        </section>

        <section className="tv-card">
          <h2>Habits this week</h2>
          {tv.weekPct !== null ? (
            <>
              <p className="tv-big num">{tv.weekPct}%</p>
              <div className="tv-bar" role="img" aria-label={`${tv.weekPct}% of scheduled check-ins done this week`}>
                <div className="tv-bar-fill" style={{ width: `${tv.weekPct}%` }} />
              </div>
              <p className="tv-sub">{tv.weekDone} of {tv.weekScheduled} scheduled check-ins, last 7 days</p>
            </>
          ) : (
            <p className="tv-empty">No habits yet.</p>
          )}
        </section>

        <section className="tv-card tv-wide">
          <h2>Due today</h2>
          {tv.dueToday.length > 0 ? (
            <ul className="tv-list tv-due">
              {tv.dueToday.slice(0, CAP).map((t) => (
                <li key={t.id} className={t.dueDate! < today ? 'tv-overdue' : ''}>
                  <span>{t.title}</span>
                  {t.dueTime && <span className="tv-time num">{t.dueTime}</span>}
                </li>
              ))}
              {tv.dueTodayTotal > CAP && <li className="tv-more">+{tv.dueTodayTotal - CAP} more</li>}
            </ul>
          ) : (
            <p className="tv-empty">Nothing due today.</p>
          )}
        </section>
      </main>
    </div>
  );
}
