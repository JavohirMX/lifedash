import './home.css';
import CompletionButton from '../components/CompletionButton';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Check, ArrowRight, Target, SlidersHorizontal, Zap } from 'lucide-react';
import QuickAdd from '../components/QuickAdd';
import { db } from '../db';
import { saveWidgetVisibility } from '../widgetPreferences';
import HomeHabitCheck from '../components/HomeHabitCheck';
import HomeFocusStop from '../components/HomeFocusStop';
import { runningSession, sessionSeconds, focusTotals, formatClock, formatDuration } from '../focus';
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
  const widgetSavingRef = useRef(false);
  const [widgetSaving, setWidgetSaving] = useState(false);
  const [widgetSaveFailed, setWidgetSaveFailed] = useState(false);
  const toggleWidget = async (id: string) => {
    if (widgetSavingRef.current) return;
    widgetSavingRef.current = true; setWidgetSaving(true); setWidgetSaveFailed(false);
    const visible = hidden.includes(id);
    try { await saveWidgetVisibility(id, visible); }
    catch { setWidgetSaveFailed(true); }
    finally { widgetSavingRef.current = false; setWidgetSaving(false); }
  };
  const logs = useLiveQuery(() => db.habitLogs.toArray(), []);
  const goals = useLiveQuery(() => db.goals.orderBy('order').toArray(), []);
  const today = todayStr();
  const suggestion = suggestedTask(props.tasks, today);
  const now = new Date();
  const focusSessions = useLiveQuery(() => db.focusSessions.toArray(), []);
  const [focusNow, setFocusNow] = useState(() => Date.now());
  const running = focusSessions ? runningSession(focusSessions) : null;
  const runningTask = running ? (props.tasks.find((t) => t.id === running.taskId) ?? null) : null;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setFocusNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running?.id]);
  const focusedToday = focusSessions ? focusTotals(focusSessions, today, focusNow).todayTotal : 0;

  // todayTasks() is active-only; the progress count needs the done ones too.
  const dueTodayAll = props.tasks.filter((t) => t.parentId === null && t.dueDate !== null && t.dueDate <= today && t.status !== 'archived');
  const doneToday = dueTodayAll.filter((t) => t.status === 'done').length;
  const todays = dueTodayAll;
  const next = todayTasks(props.tasks, today).slice(0, 3);
  const scheduled = todayTasks(props.tasks, today).filter(t => t.dueDate === today && t.dueTime).sort((a,b) => a.dueTime!.localeCompare(b.dueTime!));

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
    { id: 'overdue', count: sug.overdue.length, text: 'overdue', go: () => props.onSelect('today') },
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
          <SlidersHorizontal aria-hidden="true" size={18} strokeWidth={1.75} />
        </button>
      </header>
      {customizing && (
        <div className="widget-settings" role="group" aria-label="Show or hide widgets" aria-busy={widgetSaving}>
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
              <input type="checkbox" checked={!hidden.includes(id)} disabled={widgetSaving} onChange={() => void toggleWidget(id)} />
              {label}
            </label>
          ))}
        </div>
      )}

      {widgetSaveFailed && <p className="form-save-error" role="alert">Could not save widget visibility. Your previous choices are unchanged. Try the checkbox again.</p>}
      <QuickAdd projectId="inbox" dueDate={null} placeholder="Capture a task..." />
      <div className="widget-grid home-cockpit">
<div className="home-primary">        {!hidden.includes('focus') && running && (
        <div className="widget focus-widget home-focus">
          <div className="widget-head">
            <h2><Zap size={14} strokeWidth={2} aria-hidden="true" className="focus-icon" /> Focusing</h2>
            <span className="focus-reason num">{formatClock(sessionSeconds(running, focusNow))}</span>
          </div>
          <HomeFocusStop key={running.id}>
            <button className="focus-title" onClick={() => runningTask && props.onOpen(runningTask.id)}>
              {runningTask?.title ?? 'Task'}
            </button>
          </HomeFocusStop>
          {focusedToday > 0 && <p className="widget-meta num">Focused today: {formatDuration(focusedToday)}</p>}
        </div>
        )}
        {!hidden.includes('focus') && !running && suggestion && (
        <div className="widget focus-widget home-focus">
          <div className="widget-head">
            <h2><Zap size={14} strokeWidth={2} aria-hidden="true" className="focus-icon" /> Focus next</h2>
            <span className="focus-reason">{suggestion.reason}</span>
          </div>
          <div className="focus-task">
            <CompletionButton task={suggestion.task} className="checkbox home-check" label={`Mark ${suggestion.task.title} done`} />
            <button className="focus-title" onClick={() => props.onOpen(suggestion.task.id)}>
              {suggestion.task.title}
            </button>
          </div>
        </div>
        )}
        {!hidden.includes('today') && (
        <div className="widget home-today">
          <div className="widget-head">
            <h2>Today <span className="home-widget-count num">{todayTasks(props.tasks, today).length} open</span></h2>
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
                aria-label="Due and overdue tasks completed"
              >
                <div className="progress-fill" style={{ width: `${todays.length ? (doneToday / todays.length) * 100 : 0}%` }} />
              </div>
              <p className="widget-meta num">{doneToday} of {todays.length} done <span className="home-progress-context">· Due today or earlier</span></p>
              <ul className="widget-list">
                {next.map((t) => (
                  <li key={t.id}>
                    <CompletionButton task={t} className="checkbox home-check" label={`Complete ${t.title}`} />
                    <div className="home-task-copy"><button className="widget-task" onClick={() => props.onOpen(t.id)}>{t.title}</button><span className="home-task-meta">{t.dueDate && t.dueDate < today ? 'Overdue' : t.dueTime ?? 'Anytime'}{(t.blockedBy ?? []).some(id => props.tasks.some(b => b.id === id && b.status === 'active')) ? ' · Blocked' : ''}{t.recurrence ? ' · Repeats' : ''}</span></div>
                  </li>
                ))}
              </ul>
              {todayTasks(props.tasks, today).length > next.length && <button className="home-more-tasks" onClick={() => props.onSelect('today')}>View all {todayTasks(props.tasks, today).length} open tasks <ArrowRight size={14} aria-hidden="true" /></button>}
            </>
          )}
        </div>
        )}

        {!hidden.includes('today') && scheduled.length > 0 && <div className="widget home-schedule"><div className="widget-head"><h2>Scheduled today</h2><button className="widget-link" onClick={() => props.onSelect('planner')}>Planner <ArrowRight size={13} aria-hidden="true" /></button></div><ul className="widget-list">{scheduled.map(t => <li key={t.id}><time className="home-time num">{t.dueTime}</time><button className="widget-task" onClick={() => props.onOpen(t.id)}>{t.title}</button></li>)}</ul></div>}
</div><div className="home-support">        {!hidden.includes('upnext') && sugRows.length > 0 && (
        <div className="widget home-signals">
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

        {!hidden.includes('habits') && (
        <div className="widget home-habits">
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
              <p className="widget-meta num">
                {habitsDone} of {todaysHabits.length} done
                {!running && focusedToday > 0 && <> · Focused today: {formatDuration(focusedToday)}</>}
              </p>
              <ul className="widget-list">
                {todaysHabits.map((h) => {
                  const done = logsByDate(logs ?? [], h.id).has(today);
                  const streak = currentStreak(h, logs ?? [], today);
                  return (
                    <HomeHabitCheck key={`${h.id}:${today}`} id={h.id} name={h.name} date={today} done={done} streak={streak} />
                  );
                })}
              </ul>
            </>
          )}
        </div>
        )}

        {!hidden.includes('week') && (
        <div className="widget home-week">
          <div className="widget-head">
            <h2>This week</h2>
            <button className="widget-link" onClick={() => props.onSelect('week')}>
              Open <ArrowRight size={13} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <p className="widget-meta">Open tasks · today and the next 6 days</p>
          <div className="load-chart" role="group" aria-label="Open tasks due today and the next six days">
            {weekLoad.map((d, i) => (
              <button key={d.date} type="button"
                className={`load-col ${i === 0 ? 'today' : ''} ${drillDate === d.date ? 'selected' : ''}`}
                aria-pressed={drillDate === d.date}
                aria-label={`${d.count} open ${i === 0 ? 'due today or overdue' : `due ${weekdayLabel(d.date)}`}`}
                onClick={() => setDrillDate(drillDate === d.date ? null : d.date)}>
                <span className="home-load-count num">{d.count}</span>
                <div className="load-bar" style={{ height: `${Math.max(6, (d.count / maxLoad) * 56)}px` }} />
                <span className="load-label">{i === 0 ? 'Today' : d.label}</span>
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
                      <CompletionButton task={t} className={`checkbox home-check ${t.status === 'done' ? 'checked' : ''}`} label={t.status === 'done' ? 'Mark not done' : 'Mark done'}>
                        {t.status === 'done' ? <Check size={13} strokeWidth={2.5} aria-hidden="true" /> : null}
                      </CompletionButton>
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
        <div className="widget home-goals">
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
        <div className="widget home-upcoming">
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
        )}</div>
      </div>
    </section>
  );
}
