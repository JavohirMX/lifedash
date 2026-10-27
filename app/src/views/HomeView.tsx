import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Check, Flame, ArrowRight, Target, SlidersHorizontal, Zap } from 'lucide-react';
import { db } from '../db';
import { toggleComplete, toggleHabitForDate } from '../repo';
import { todayTasks, upcomingTasks, suggestedTask, upNextGroups } from '../logic';
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
  const widgetPref = useLiveQuery(() => db.syncmeta.get('home.widgets'), []);
  const hidden: string[] = (widgetPref?.value as string[] | undefined) ?? [];
  const [customizing, setCustomizing] = useState(false);
  const [drillDate, setDrillDate] = useState<string | null>(null);
  const toggleWidget = (id: string) => {
    const next = hidden.includes(id) ? hidden.filter((w) => w !== id) : [...hidden, id];
    void db.syncmeta.put({ key: 'home.widgets', value: next });
  };
  const logs = useLiveQuery(() => db.habitLogs.toArray(), []);
  const goals = useLiveQuery(() => db.goals.orderBy('order').toArray(), []);
  const today = todayStr();
  const suggestion = suggestedTask(props.tasks, today);
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
  const dayTasks = (d: string): Task[] =>
    d === today
      ? [...dueTodayAll].sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0))
      : (upcoming.get(d) ?? []);

  const sug = upNextGroups(props.tasks, today, now.getTime());
  const sugRows = [
    { id: 'overdue', count: sug.overdue.length, text: 'overdue', go: () => props.onSelect('upcoming') },
    { id: 'dueSoon', count: sug.dueSoon.length, text: 'due in the next 2 days', go: () => props.onSelect('upcoming') },
    { id: 'stale', count: sug.staleBacklog.length, text: 'untouched 14+ days in Backlog', go: () => props.onSelect('backlog') },
    { id: 'broken', count: sug.brokenRules.length, text: sug.brokenRules.length === 1 ? 'broken repeat rule' : 'broken repeat rules', go: () => props.onOpen(sug.brokenRules[0].id) },
  ].filter((r) => r.count > 0);

  const upNext = Array.from(upcoming.entries())
    .filter(([d]) => d > today)
    .flatMap(([d, ts]) => ts.map((t) => ({ d, t })))
    .slice(0, 5);

  return (
    <section className="home">
      <header className="home-head">
        <div>
          <h1>{greeting(now.getHours())}</h1>
          <p className="home-date">{weekdayLabel(today)} · {now.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</p>
        </div>
        <button
          className={`icon-btn${customizing ? ' active' : ''}`}
          aria-label="Customize widgets"
          aria-expanded={customizing}
          title="Customize widgets"
          onClick={() => setCustomizing(!customizing)}
        >
          <SlidersHorizontal size={18} strokeWidth={1.75} />
        </button>
      </header>
      {customizing && (
        <div className="widget-settings" role="group" aria-label="Show or hide widgets">
          {[
            ['focus', 'Focus'],
            ['upnext', 'Up next'],
            ['today', 'Today'],
            ['habits', 'Habits'],
            ['week', 'This week'],
            ['goals', 'Goals'],
            ['upcoming', 'Upcoming'],
          ].map(([id, label]) => (
            <label key={id} className="widget-toggle">
              <input type="checkbox" checked={!hidden.includes(id)} onChange={() => toggleWidget(id)} />
              {label}
            </label>
          ))}
        </div>
      )}

      <div className="widget-grid">
        {!hidden.includes('focus') && suggestion && (
        <div className="widget focus-widget">
          <div className="widget-head">
            <h2><Zap size={14} strokeWidth={2} aria-hidden="true" className="focus-icon" /> Focus next</h2>
            <span className="focus-reason">{suggestion.reason}</span>
          </div>
          <div className="focus-task">
            <button
              className="checkbox"
              aria-label={`Mark ${suggestion.task.title} done`}
              onClick={() => void toggleComplete(suggestion.task)}
            />
            <button className="focus-title" onClick={() => props.onOpen(suggestion.task.id)}>
              {suggestion.task.title}
            </button>
          </div>
        </div>
        )}
        {!hidden.includes('upnext') && sugRows.length > 0 && (
        <div className="widget">
          <div className="widget-head">
            <h2>Up next</h2>
          </div>
          <ul className="widget-list">
            {sugRows.map((r) => (
              <li key={r.id}>
                <button className="widget-task upnext-row" onClick={r.go}>
                  <span className="num upnext-count">{r.count}</span>
                  <span>{r.text}</span>
                  <ArrowRight size={13} strokeWidth={2} aria-hidden="true" className="upnext-arrow" />
                </button>
              </li>
            ))}
          </ul>
        </div>
        )}

        {!hidden.includes('today') && (
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
              <div
                className="progress"
                role="progressbar"
                aria-valuenow={doneToday}
                aria-valuemin={0}
                aria-valuemax={todays.length}
                aria-label="Tasks done today"
              >
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
        )}

        {!hidden.includes('habits') && (
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
        )}

        {!hidden.includes('week') && (
        <div className="widget">
          <div className="widget-head">
            <h2>This week</h2>
            <button className="widget-link" onClick={() => props.onSelect('week')}>
              Open <ArrowRight size={13} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <div className="load-chart" role="group" aria-label="Tasks due per day this week">
            {weekLoad.map((d, i) => (
              <button key={d.date} type="button"
                className={`load-col ${i === 0 ? 'today' : ''} ${drillDate === d.date ? 'selected' : ''}`}
                aria-pressed={drillDate === d.date}
                aria-label={`${d.count} due ${weekdayLabel(d.date)}`}
                onClick={() => setDrillDate(drillDate === d.date ? null : d.date)}>
                <div className="load-bar" style={{ height: `${Math.max(6, (d.count / maxLoad) * 56)}px` }} />
                <span className="load-label">{d.label}</span>
              </button>
            ))}
          </div>
          {drillDate !== null && (
            <div className="load-drill">
              <p className="widget-meta num">{friendlyDate(drillDate, today)} · {dayTasks(drillDate).length} due</p>
              {dayTasks(drillDate).length === 0 ? (
                <p className="widget-empty">Nothing due.</p>
              ) : (
                <ul className="widget-list">
                  {dayTasks(drillDate).map((t) => (
                    <li key={t.id}>
                      <button className={`checkbox ${t.status === 'done' ? 'checked' : ''}`} aria-label={t.status === 'done' ? 'Mark not done' : 'Mark done'} onClick={() => void toggleComplete(t)}>
                        {t.status === 'done' ? <Check size={13} strokeWidth={2.5} aria-hidden="true" /> : null}
                      </button>
                      <button className={`widget-task ${t.status === 'done' ? 'done' : ''}`} onClick={() => props.onOpen(t.id)}>{t.title}</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        )}

        {!hidden.includes('goals') && (
        <div className="widget">
          <div className="widget-head">
            <h2>Goals</h2>
            <button className="widget-link" onClick={() => props.onSelect('goals')}>
              Open <ArrowRight size={13} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          {(goals ?? []).filter((g) => g.status === 'active').length === 0 ? (
            <p className="widget-empty">No active goals. Set one from the Goals view.</p>
          ) : (
            <ul className="widget-list">
              {(goals ?? []).filter((g) => g.status === 'active').slice(0, 3).map((g) => {
                const linked = props.tasks.filter((t) => t.goalId === g.id && t.status !== 'archived');
                const gd = linked.filter((t) => t.status === 'done').length;
                const pct = linked.length ? Math.round((gd / linked.length) * 100) : 0;
                return (
                  <li key={g.id}>
                    <Target size={13} strokeWidth={1.75} aria-hidden="true" className="widget-goal-icon" />
                    <span className="widget-task">{g.title}</span>
                    <span className="widget-when num">{linked.length ? `${pct}%` : 'new'}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        )}

        {!hidden.includes('upcoming') && (
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
        )}
      </div>
    </section>
  );
}
