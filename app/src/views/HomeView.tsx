import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Flame, ArrowRight } from 'lucide-react';
import { db } from '../db';
import { toggleComplete, toggleHabitForDate } from '../repo';
import { todayTasks, upcomingTasks } from '../logic';
import { currentStreak, isScheduledOn, logsByDate } from '../habits';
import { todayStr, addDays, friendlyDate, weekdayLabel } from '../dates';
import type { Task } from '../types';

function greeting(hour: number): string {
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeView(props: { tasks: Task[]; onSelect: (kind: string) => void; onOpen: (id: string) => void }) {
  const habits = useLiveQuery(() => db.habits.orderBy('order').toArray(), []);
  const logs = useLiveQuery(() => db.habitLogs.toArray(), []);
  const today = todayStr();
  const now = new Date();

  // todayTasks() is active-only; the progress count needs the done ones too.
  const dueTodayAll = props.tasks.filter((t) => t.parentId === null && t.dueDate !== null && t.dueDate <= today && t.status !== 'archived');
  const doneToday = dueTodayAll.filter((t) => t.status === 'done').length;
  const todays = dueTodayAll;
  const next = todayTasks(props.tasks, today).slice(0, 3);

  const todaysHabits = (habits ?? []).filter((h) => !h.archived && isScheduledOn(h, today));
  const habitsDone = todaysHabits.filter((h) => logsByDate(logs ?? [], h.id).has(today)).length;

  const upcoming = upcomingTasks(props.tasks, today, 7);
  const weekLoad = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, i);
    const count = i === 0 ? dueTodayAll.filter((t) => t.status === 'active').length : (upcoming.get(d) ?? []).length;
    return { date: d, label: weekdayLabel(d).slice(0, 2), count };
  });
  const maxLoad = Math.max(1, ...weekLoad.map((d) => d.count));

  const upNext = Array.from(upcoming.entries())
    .filter(([d]) => d > today)
    .flatMap(([d, ts]) => ts.map((t) => ({ d, t })))
    .slice(0, 5);

  return (
    <section className="home">
      <header className="home-head">
        <h1>{greeting(now.getHours())}</h1>
        <p className="home-date">{weekdayLabel(today)} · {now.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</p>
      </header>

      <div className="widget-grid">
        <div className="widget">
          <div className="widget-head">
            <h2>Today</h2>
            <button className="widget-link" onClick={() => props.onSelect('today')}>
              Open <ArrowRight size={13} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          {todays.length === 0 ? (
            <p className="widget-empty">Nothing due today. Pull something in from Backlog.</p>
          ) : (
            <>
              <div className="progress">
                <div className="progress-fill" style={{ width: `${todays.length ? (doneToday / todays.length) * 100 : 0}%` }} />
              </div>
              <p className="widget-meta num">{doneToday} of {todays.length} done</p>
              <ul className="widget-list">
                {next.map((t) => (
                  <li key={t.id}>
                    <button className="checkbox" aria-label={`Complete ${t.title}`} onClick={() => void toggleComplete(t)} />
                    <button className="widget-task" onClick={() => props.onOpen(t.id)}>{t.title}</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="widget">
          <div className="widget-head">
            <h2>Habits</h2>
            <button className="widget-link" onClick={() => props.onSelect('habits')}>
              Open <ArrowRight size={13} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          {todaysHabits.length === 0 ? (
            <p className="widget-empty">No habits scheduled today.</p>
          ) : (
            <>
              <p className="widget-meta num">{habitsDone} of {todaysHabits.length} done</p>
              <ul className="widget-list">
                {todaysHabits.map((h) => {
                  const done = logsByDate(logs ?? [], h.id).has(today);
                  const streak = currentStreak(h, logs ?? [], today);
                  return (
                    <li key={h.id}>
                      <button
                        className={`checkbox ${done ? 'checked' : ''}`}
                        aria-label={`${done ? 'Uncheck' : 'Check'} ${h.name} for today`}
                        onClick={() => void toggleHabitForDate(h.id, today)}
                      >
                        {done && <Check size={12} strokeWidth={2.5} aria-hidden="true" />}
                      </button>
                      <span className={`widget-task ${done ? 'done' : ''}`}>{h.name}</span>
                      {streak >= 2 && (
                        <span className="widget-streak num">
                          <Flame size={12} strokeWidth={2} aria-hidden="true" /> {streak}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <div className="widget">
          <div className="widget-head">
            <h2>This week</h2>
            <button className="widget-link" onClick={() => props.onSelect('week')}>
              Open <ArrowRight size={13} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <div className="load-chart" role="img" aria-label={`Tasks due per day this week: ${weekLoad.map((d) => `${d.label} ${d.count}`).join(', ')}`}>
            {weekLoad.map((d, i) => (
              <div key={d.date} className={`load-col ${i === 0 ? 'today' : ''}`}>
                <div className="load-bar" style={{ height: `${Math.max(6, (d.count / maxLoad) * 56)}px` }} title={`${d.count} due`} />
                <span className="load-label">{d.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="widget">
          <div className="widget-head">
            <h2>Upcoming</h2>
            <button className="widget-link" onClick={() => props.onSelect('upcoming')}>
              Open <ArrowRight size={13} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          {upNext.length === 0 ? (
            <p className="widget-empty">Nothing scheduled for the rest of the week.</p>
          ) : (
            <ul className="widget-list">
              {upNext.map(({ d, t }) => (
                <li key={t.id}>
                  <button className="widget-task" onClick={() => props.onOpen(t.id)}>{t.title}</button>
                  <span className="widget-when">{friendlyDate(d, today)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
