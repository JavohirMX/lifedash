import './home.css';
import { PlanEditor } from './PlannerView';
import HomeFocusStart from '../components/HomeFocusStart';
import WeeklyReview from '../components/WeeklyReview';
import type { Selection } from '../components/Sidebar';
import { minutes, validDate } from '../planning';
import { goalsWithoutNextAction } from '../review';
import CompletionButton from '../components/CompletionButton';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, SlidersHorizontal, Target, Zap } from 'lucide-react';
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

export default function HomeView(props: { tasks: Task[]; onSelect: (kind: string) => void; onOpen: (id: string) => void; onNavigate: (selection: Selection) => void }) {
  const habits = useLiveQuery(() => db.habits.orderBy('order').toArray(), []);
  const widgetPref = useLiveQuery(() => db.syncmeta.get('home.widgets'), []);
  const hidden: string[] = (widgetPref?.value as string[] | undefined) ?? [];
  const [editingPlan, setEditingPlan] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
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
  const journalEntry = useLiveQuery(() => db.journal.get(today), [today]);
  const suggestion = suggestedTask(props.tasks, today);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const now = new Date(clock);
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
  const openToday = todayTasks(props.tasks, today);
  const doneToday = dueTodayAll.filter((t) => t.status === 'done').length;
  const commitments = props.tasks.filter(t => t.status === 'active' && t.parentId === null).flatMap(t => {
    const rows: { task: Task; date: string; time: string; kind: string }[] = [];
    if (validDate(t.plannedDate) && minutes(t.plannedTime) !== null) rows.push({ task: t, date: t.plannedDate!, time: t.plannedTime!, kind: 'Planned work' });
    if (validDate(t.dueDate) && minutes(t.dueTime) !== null) rows.push({ task: t, date: t.dueDate!, time: t.dueTime!, kind: 'Deadline' });
    return rows;
  }).filter(item => item.date > today || (item.date === today && minutes(item.time)! >= now.getHours() * 60 + now.getMinutes()))
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const commitment = commitments[0];
  const noNextAction = goalsWithoutNextAction(goals ?? [], props.tasks).length;

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
  const journalLine = (journalEntry?.highlight ?? '').trim() || (journalEntry?.note ?? '').trim();
  const orientation = openToday.length === 0
    ? 'Nothing is due today. Leave room for what matters, or pull one thing forward.'
    : openToday.length === 1
      ? 'One open task is due. Give it your full attention, then stop.'
      : `${openToday.length} open tasks are due. Pick one, finish it, then look up.`;

  return (
    <section className="home">
      <header className="home-head">
        <div className="home-heading">
          <p className="eyebrow">{weekdayLabel(today)} · {now.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</p>
          <h1>One thing at a time</h1>
          <p className="home-greeting">{greeting(now.getHours())}. {orientation}</p>
        </div>
        <button
          className={`icon-btn home-customize${customizing ? ' active' : ''}`}
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
            ['upnext', 'On your radar'],
            ['today', 'Next commitment'],
            ['habits', 'Habits'],
            ['journal', 'Journal'],
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

      <div className="home-capture">
        <QuickAdd projectId="inbox" dueDate={null} placeholder="Capture a task…" />
      </div>

      <div className="home-cockpit">
        <div className="home-primary">
          {!hidden.includes('focus') && running && (
            <section className="home-focus" aria-labelledby="home-focus-heading">
              <div className="widget-head">
                <p className="eyebrow" id="home-focus-heading">Focusing</p>
                <span className="focus-reason num">{formatClock(sessionSeconds(running, focusNow))}</span>
              </div>
              <HomeFocusStop key={running.id}>
                <button className="focus-title" onClick={() => runningTask && props.onOpen(runningTask.id)}>
                  {runningTask?.title ?? 'Task'}
                </button>
              </HomeFocusStop>
              {focusedToday > 0 && <p className="widget-meta num">Focused today: {formatDuration(focusedToday)}</p>}
            </section>
          )}
          {!hidden.includes('focus') && !running && suggestion && (
            <section className="home-focus" aria-labelledby="home-focus-heading">
              <div className="widget-head">
                <div>
                  <p className="eyebrow" id="home-focus-heading">Next action</p>
                  <p className="focus-reason">{suggestion.reason}</p>
                </div>
                <span className="home-focus-mark" aria-hidden="true"><Zap size={18} strokeWidth={1.75} /></span>
              </div>
              <div className="focus-task">
                <CompletionButton task={suggestion.task} className="checkbox home-check" label={`Mark ${suggestion.task.title} done`} />
                <button className="focus-title" onClick={() => props.onOpen(suggestion.task.id)}>
                  {suggestion.task.title}
                </button>
              </div>
              <div className="home-focus-actions">
                <HomeFocusStart taskId={suggestion.task.id} />
                <button className="btn-secondary" onClick={() => props.onOpen(suggestion.task.id)}>Open task</button>
              </div>
            </section>
          )}
          {!hidden.includes('focus') && !running && !suggestion && (
            <section className="home-focus home-focus-empty" aria-labelledby="home-focus-heading">
              <p className="eyebrow" id="home-focus-heading">Next action</p>
              <h2>No unblocked tasks due now.</h2>
              <p className="home-empty-copy">Choose something from Backlog, or enjoy the quiet.</p>
              <button className="btn-secondary" onClick={() => props.onSelect('backlog')}>Choose a task</button>
            </section>
          )}

          {!hidden.includes('today') && (
            <section className="home-commitment" aria-label="Next commitment">
              <div className="home-section-head">
                <div>
                  <p className="eyebrow">Today</p>
                  <h2>Next commitment</h2>
                </div>
                <button className="widget-link" onClick={() => props.onSelect('planner')}>Day <ArrowRight size={13} aria-hidden="true" /></button>
              </div>
              {commitment ? (
                <div className="home-commitment-body">
                  <p className="home-commitment-time num">
                    <time>{commitment.time}</time>
                    <span>{friendlyDate(commitment.date, today)} · {commitment.kind}</span>
                  </p>
                  <button className="widget-task home-commitment-title" onClick={() => props.onOpen(commitment.task.id)}>{commitment.task.title}</button>
                  <p className="widget-meta">
                    {commitment.kind === 'Planned work' && commitment.task.durationMinutes ? `${commitment.task.durationMinutes} min estimate · ` : ''}
                    A local task, not a calendar event.
                  </p>
                  <button className="btn-secondary" onClick={() => commitment.kind === 'Planned work' ? setEditingPlan(commitment.task.id) : props.onOpen(commitment.task.id)}>
                    {commitment.kind === 'Planned work' ? 'Reschedule work' : 'Reschedule task'}
                  </button>
                </div>
              ) : (
                <p className="home-empty-copy">No timed commitments left today. The rest of the day is yours.</p>
              )}
              {editingPlan && props.tasks.find(task => task.id === editingPlan && task.status === 'active') && <PlanEditor key={editingPlan} task={props.tasks.find(task => task.id === editingPlan)!} date={today} suggestedTime={null} close={() => setEditingPlan(null)} />}

              <div className="home-today-list">
                <div className="home-list-head">
                  <span>Open tasks</span>
                  <span className="num">{doneToday} of {dueTodayAll.length} done</span>
                </div>
                {openToday.length === 0 ? (
                  <p className="home-empty-copy">Nothing due today.</p>
                ) : (
                  <ul className="briefing-list">
                    {openToday.slice(0, 4).map((t) => (
                      <li key={t.id} className="briefing-task">
                        <CompletionButton task={t} className="checkbox home-check" label={`Mark ${t.title} done`} />
                        <button className={`briefing-task-title${t.status === 'done' ? ' done' : ''}`} onClick={() => props.onOpen(t.id)}>{t.title}</button>
                        <span className={`briefing-task-when num${t.dueDate && t.dueDate < today ? ' overdue' : ''}`}>
                          {t.dueDate ? friendlyDate(t.dueDate, today) : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <button className="home-more-tasks" onClick={() => props.onSelect('today')}>
                  View all {openToday.length} open tasks <ArrowRight size={14} aria-hidden="true" />
                </button>
              </div>
            </section>
          )}
        </div>

        <aside className="home-support" aria-label="Daily context">
          {!hidden.includes('habits') && (
            <section className="home-habits widget">
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
            </section>
          )}

          {!hidden.includes('journal') && (
            <section className="home-journal widget">
              <div className="widget-head">
                <h2>Journal</h2>
                <button className="widget-link" onClick={() => props.onSelect('journal')}>
                  Open <ArrowRight size={13} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
              <div className="home-journal-body">
                <BookOpen size={17} strokeWidth={1.75} aria-hidden="true" className="home-journal-icon" />
                <div>
                  <p className="widget-meta">{journalLine ? 'Today’s entry' : 'A quiet place to land'}</p>
                  <p className={journalLine ? 'home-journal-line' : 'home-journal-prompt'}>
                    {journalLine || 'What was worth remembering today?'}
                  </p>
                </div>
              </div>
              <button className="btn-secondary" onClick={() => props.onSelect('journal')}>{journalLine ? 'Continue writing' : 'Write a line'}</button>
            </section>
          )}

          {!hidden.includes('upnext') && (
            <section className="home-signals widget">
              <div className="widget-head">
                <h2>On your radar</h2>
              </div>
              {sugRows.length === 0 && <p className="widget-empty">No overdue, due-soon or stale-task signals.</p>}
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
              <p className="widget-meta">{noNextAction} active goal{noNextAction === 1 ? '' : 's'} without a next task.</p>
              <button className="btn-secondary" onClick={() => setReviewOpen(true)}>Review this week</button>
            </section>
          )}
        </aside>
      </div>

      <details className="home-extra-widgets">
        <summary>More insights · week, goals and upcoming</summary>
        <p className="widget-meta">Optional detail, kept out of your next-action view. Show or hide each widget using Customize widgets.</p>
        <div className="home-extra-grid">
          {!hidden.includes('week') && (
            <section className="home-week widget">
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
            </section>
          )}

          {!hidden.includes('goals') && (
            <section className="home-goals widget">
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
            </section>
          )}

          {!hidden.includes('upcoming') && (
            <section className="home-upcoming widget">
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
            </section>
          )}
        </div>
      </details>

      {reviewOpen && <WeeklyReview tasks={props.tasks} onOpen={id => { setReviewOpen(false); props.onOpen(id); }} onNavigate={selection => { setReviewOpen(false); props.onNavigate(selection); }} onClose={() => setReviewOpen(false)} />}
    </section>
  );
}
