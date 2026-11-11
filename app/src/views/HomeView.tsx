import './home.css';
import { PlanEditor } from './PlannerView';
import HomeFocusStart from '../components/HomeFocusStart';
import WeeklyReview from '../components/WeeklyReview';
import type { Selection } from '../components/Sidebar';
import { minutes, validDate } from '../planning';
import { goalsWithoutNextAction } from '../review';
import CompletionButton from '../components/CompletionButton';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Calendar, CalendarCheck, CalendarPlus, Check, Clock, ListTodo, Maximize2, PenLine, RotateCcw, SkipForward, Target, X } from 'lucide-react';
import QuickAdd from '../components/QuickAdd';
import { db } from '../db';
import { useHomePreferences } from '../homePreferences';
import HomeHabitCheck from '../components/HomeHabitCheck';
import HomeFocusStop from '../components/HomeFocusStop';
import { runningSession, sessionSeconds, focusTotals, formatClock, formatDuration } from '../focus';
import { todayTasks, upcomingTasks, suggestedTask, upNextGroups, sortTasks, sortBacklogTasks, activeBlockers } from '../logic';
import { currentStreak, isScheduledOn, logsByDate, isHabitDone } from '../habits';
import { todayStr, addDays, friendlyDate, weekdayLabel } from '../dates';
import { getOrCreateJournalEntry, updateJournalEntry, updateTask } from '../repo';
import type { Task } from '../types';

function greeting(hour: number): string {
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeView(props: {
  tasks: Task[];
  onSelect: (kind: string) => void;
  onOpen: (id: string) => void;
  onNavigate: (selection: Selection) => void;
  onOpenFocusWorkspace?: (taskId: string) => void;
}) {
  const habits = useLiveQuery(() => db.habits.orderBy('order').toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const projectMap = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects]);
  const homePrefs = useHomePreferences();
  const hidden = homePrefs.hiddenWidgets;
  const [editingPlan, setEditingPlan] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [drillDate, setDrillDate] = useState<string | null>(null);
  const [skippedIds, setSkippedIds] = useState<string[]>([]);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [editingJournal, setEditingJournal] = useState(false);
  const [journalDraft, setJournalDraft] = useState('');
  const [journalSaving, setJournalSaving] = useState(false);
  const [journalError, setJournalError] = useState('');
  const logs = useLiveQuery(() => db.habitLogs.toArray(), []);
  const goals = useLiveQuery(() => db.goals.orderBy('order').toArray(), []);
  const today = todayStr();
  const journalEntry = useLiveQuery(() => db.journal.get(today), [today]);

  const handleScheduleToday = async (id: string) => {
    setScheduleError(null);
    try {
      await updateTask(id, { dueDate: today });
    } catch {
      setScheduleError("Couldn't schedule task for today. Try again.");
    }
  };

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

  // Backlog pool sorted by the user's configured Home preference
  const unblockedBacklog = useMemo(() => {
    const list = props.tasks.filter(
      (t) =>
        t.status === 'active' &&
        t.parentId === null &&
        activeBlockers(props.tasks, t).length === 0 &&
        t.dueDate === null,
    );
    return sortBacklogTasks(list, homePrefs.backlogSort);
  }, [props.tasks, homePrefs.backlogSort]);

  // Candidate pool for Next Action cycling
  const unblocked = (t: Task) => t.status === 'active' && t.parentId === null && activeBlockers(props.tasks, t).length === 0 && t.dueDate !== null;
  const candidates = props.tasks.filter((t) => unblocked(t) && t.dueDate! <= today);
  const tomorrow = addDays(today, 1);
  const pool =
    candidates.length > 0
      ? candidates
      : homePrefs.showBacklog && unblockedBacklog.length > 0
        ? unblockedBacklog
        : props.tasks.filter((t) => unblocked(t) && t.dueDate! === tomorrow);
  const candidateTasks = props.tasks.filter((t) => !skippedIds.includes(t.id));
  const suggestion =
    suggestedTask(candidateTasks, today, {
      tomorrowFallback: true,
      backlogFallback: homePrefs.showBacklog,
      backlogSort: homePrefs.backlogSort,
    }) ??
    suggestedTask(props.tasks, today, {
      tomorrowFallback: true,
      backlogFallback: homePrefs.showBacklog,
      backlogSort: homePrefs.backlogSort,
    });
  const canCycle = pool.length > 1;
  const skipSuggestion = (id: string) => {
    const next = [...skippedIds, id];
    const remaining = pool.filter((t) => !next.includes(t.id));
    if (remaining.length === 0) setSkippedIds([]);
    else setSkippedIds(next);
  };

  const getSubtaskSummary = (taskId: string) => {
    const children = props.tasks.filter((t) => t.parentId === taskId && t.status !== 'archived');
    if (children.length === 0) return null;
    const done = children.filter((t) => t.status === 'done').length;
    return { done, total: children.length };
  };

  // todayTasks() is active-only; the progress count needs the done ones too.
  const dueTodayAll = props.tasks.filter((t) => t.parentId === null && t.dueDate !== null && t.dueDate <= today && t.status !== 'archived');
  const openToday = todayTasks(props.tasks, today);
  const doneToday = dueTodayAll.filter((t) => t.status === 'done').length;
  const completedTodayTasks = dueTodayAll.filter((t) => t.status === 'done');
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const commitments = props.tasks.filter(t => t.status === 'active' && t.parentId === null).flatMap(t => {
    const rows: { task: Task; date: string; time: string; kind: string; overdue: boolean }[] = [];
    const checkOverdue = (date: string, time: string) => date < today || (date === today && minutes(time)! < currentMinutes);
    if (validDate(t.plannedDate) && minutes(t.plannedTime) !== null) {
      rows.push({ task: t, date: t.plannedDate!, time: t.plannedTime!, kind: 'Planned work', overdue: checkOverdue(t.plannedDate!, t.plannedTime!) });
    }
    if (validDate(t.dueDate) && minutes(t.dueTime) !== null) {
      rows.push({ task: t, date: t.dueDate!, time: t.dueTime!, kind: 'Deadline', overdue: checkOverdue(t.dueDate!, t.dueTime!) });
    }
    return rows;
  }).filter(item => item.date >= today)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const commitment = commitments[0];
  const todayCommitments = commitments.filter((item) => item.date === today);
  const remainingTodayCommitments = todayCommitments.filter((item) => item.task.id !== commitment?.task.id);
  const noNextAction = goalsWithoutNextAction(goals ?? [], props.tasks).length;

  const todaysHabits = (habits ?? []).filter((h) => !h.archived && isScheduledOn(h, today));
  const habitsDone = todaysHabits.filter((h) => isHabitDone(h, logsByDate(logs ?? [], h.id).get(today))).length;
  const allHabitsDone = todaysHabits.length > 0 && habitsDone === todaysHabits.length;

  const totalCommitments = dueTodayAll.length + todaysHabits.length;
  const completedCommitments = doneToday + habitsDone;
  const progressPct = totalCommitments > 0 ? Math.round((completedCommitments / totalCommitments) * 100) : 0;
  const allDoneToday = totalCommitments > 0 && completedCommitments === totalCommitments;

  const upcoming = upcomingTasks(props.tasks, today, 7);
  const weekLoad = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, i);
    const count = i === 0 ? dueTodayAll.filter((t) => t.status === 'active').length : (upcoming.get(d) ?? []).length;
    return { date: d, label: weekdayLabel(d).slice(0, 2), count };
  });
  const maxLoad = Math.max(1, ...weekLoad.map((d) => d.count));
  const dayTasks = (d: string): Task[] =>
    d === today
      ? sortTasks(dueTodayAll).sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0))
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
  const orientation = allDoneToday
    ? 'All clear for today. Every scheduled task and habit is done. Enjoy the quiet.'
    : openToday.length === 0
      ? (homePrefs.showBacklog && unblockedBacklog.length > 0
          ? `${unblockedBacklog.length} task${unblockedBacklog.length === 1 ? '' : 's'} in backlog ready to pull forward, or enjoy the quiet.`
          : 'Nothing is due today. Leave room for what matters, or pull one thing forward.')
      : openToday.length === 1
        ? 'One open task is due. Give it your full attention, then stop.'
        : `${openToday.length} open tasks are due. Pick one, finish it, then look up.`;

  const saveJournalHighlight = async (text: string) => {
    if (!text.trim() || journalSaving) return;
    setJournalSaving(true);
    setJournalError('');
    try {
      const entry = await getOrCreateJournalEntry(today);
      await updateJournalEntry(entry.id, { highlight: text.trim() });
      setEditingJournal(false);
      setJournalDraft('');
    } catch {
      setJournalError("Couldn't save highlight. Try again.");
    } finally {
      setJournalSaving(false);
    }
  };

  return (
    <section className="home">
      <header className="home-head">
        <div className="home-heading">
          <p className="eyebrow">{weekdayLabel(today)} · {now.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</p>
          <h1>One thing at a time</h1>
          {homePrefs.showGreeting && (
            <p className="home-greeting">{greeting(now.getHours())}. {orientation}</p>
          )}
          {homePrefs.showProgressBar && totalCommitments > 0 && (
            <div className="home-progress-wrap" role="group" aria-label="Daily progress">
              <div
                className="home-progress-bar"
                role="progressbar"
                aria-valuenow={progressPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${progressPct}% of daily commitments done`}
              >
                <div className="home-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <p className="home-progress-text num">
                <span>{completedCommitments} of {totalCommitments} done today</span>
                <span>{progressPct}%</span>
              </p>
            </div>
          )}
        </div>
      </header>

      <div className="home-capture">
        <QuickAdd projectId="inbox" dueDate={null} placeholder="Capture a task…" />
      </div>

      <div className="home-cockpit">
        <div className="home-primary">
          {!hidden.includes('focus') && running && (
            <section className="home-focus" aria-labelledby="home-focus-heading">
              <div className="widget-head">
                <div className="focus-heading-wrap">
                  <span className="focus-pulse" aria-hidden="true" />
                  <p className="eyebrow" id="home-focus-heading">Focusing</p>
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span className="focus-reason num">{formatClock(sessionSeconds(running, focusNow))}</span>
                  {props.onOpenFocusWorkspace && runningTask && (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Expand Focus Workspace"
                      title="Fullscreen Focus Workspace"
                      onClick={() => props.onOpenFocusWorkspace!(runningTask.id)}
                    >
                      <Maximize2 size={13} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
              <HomeFocusStop key={running.id}>
                <button className="focus-title" onClick={() => runningTask && props.onOpen(runningTask.id)}>
                  {runningTask?.title ?? 'Task'}
                </button>
              </HomeFocusStop>
              {runningTask && (
                <div className="home-focus-meta">
                  {projectMap.get(runningTask.projectId)?.id !== 'inbox' && (
                    <span className="home-meta-pill project">
                      <span className="dot" style={{ background: projectMap.get(runningTask.projectId)?.color }} />
                      {projectMap.get(runningTask.projectId)?.name}
                    </span>
                  )}
                  {runningTask.durationMinutes && (
                    <span className="home-meta-pill duration num">{runningTask.durationMinutes}m est</span>
                  )}
                </div>
              )}
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
                <div className="home-focus-head-actions">
                  {canCycle && (
                    <button
                      type="button"
                      className="home-skip-btn"
                      onClick={() => skipSuggestion(suggestion.task.id)}
                      title="Skip to next candidate"
                      aria-label="Skip to next candidate"
                    >
                      <SkipForward size={14} aria-hidden="true" />
                      <span>Skip for now</span>
                    </button>
                  )}
                  {skippedIds.length > 0 && (
                    <button
                      type="button"
                      className="home-skip-reset"
                      onClick={() => setSkippedIds([])}
                      title="Reset skipped candidates"
                      aria-label="Reset skipped candidates"
                    >
                      <RotateCcw size={12} aria-hidden="true" />
                      <span>Reset ({skippedIds.length})</span>
                    </button>
                  )}
                </div>
              </div>
              <div className="home-focus-body">
                <div className="home-focus-content">
                  <div className="focus-task">
                    <CompletionButton task={suggestion.task} className="checkbox home-check" label={`Mark ${suggestion.task.title} done`} />
                    <button className="focus-title" onClick={() => props.onOpen(suggestion.task.id)}>
                      {suggestion.task.title}
                    </button>
                  </div>
                  <div className="home-focus-meta">
                    {(() => {
                      const proj = projectMap.get(suggestion.task.projectId);
                      const sub = getSubtaskSummary(suggestion.task.id);
                      return (
                        <>
                          {proj && proj.id !== 'inbox' && (
                            <span className="home-meta-pill project">
                              <span className="dot" style={{ background: proj.color }} />
                              {proj.name}
                            </span>
                          )}
                          {suggestion.task.durationMinutes && (
                            <span className="home-meta-pill duration num">{suggestion.task.durationMinutes}m</span>
                          )}
                          {sub && (
                            <span className="home-meta-pill subtask num">{sub.done}/{sub.total} subtasks</span>
                          )}
                          {suggestion.task.priority === 1 && (
                            <span className="home-meta-pill priority-high">High priority</span>
                          )}
                          {suggestion.task.priority === 2 && (
                            <span className="home-meta-pill priority-med">Medium priority</span>
                          )}
                          {suggestion.task.dueTime && (
                            <span className="home-meta-pill due-time num">Due {suggestion.task.dueTime}</span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
                <div className="home-focus-actions">
                  {suggestion.task.dueDate === null && (
                    <button
                      type="button"
                      className="home-do-today-btn"
                      onClick={() => void handleScheduleToday(suggestion.task.id)}
                      title="Schedule this backlog task for today"
                      aria-label={`Schedule ${suggestion.task.title} for today`}
                    >
                      <CalendarPlus size={14} strokeWidth={2} aria-hidden="true" />
                      <span>Do today</span>
                    </button>
                  )}
                  <HomeFocusStart taskId={suggestion.task.id} />
                </div>
              </div>
            </section>
          )}
          {!hidden.includes('focus') && !running && !suggestion && (
            <section className="home-focus home-focus-empty" aria-labelledby="home-focus-heading">
              <p className="eyebrow" id="home-focus-heading">Next action</p>
              <h2>All clear for now.</h2>
              <p className="home-empty-copy">No tasks due or waiting in your backlog. Capture an idea or enjoy the quiet.</p>
              <button className="btn-secondary" onClick={() => props.onSelect('backlog')}>
                <ListTodo size={14} strokeWidth={2} aria-hidden="true" />
                Open Backlog
              </button>
            </section>
          )}

          {!hidden.includes('today') && (
            <section className="home-commitment" aria-label="Today's schedule">
              <div className="home-section-head">
                <div>
                  <p className="eyebrow">Today</p>
                  <h2>Today's schedule</h2>
                  <p className="home-section-subtitle">Your next scheduled work session or deadline due today</p>
                </div>
                <button className="widget-link" onClick={() => props.onSelect('planner')}>Day <ArrowRight size={13} aria-hidden="true" /></button>
              </div>
              {commitment ? (
                (() => {
                  const proj = projectMap.get(commitment.task.projectId);
                  return (
                    <div className="home-commitment-body">
                      <div className="home-commitment-header-row">
                        <div className="home-commitment-time-pill num">
                          <Clock size={13} strokeWidth={2} aria-hidden="true" />
                          <time>{commitment.kind === 'Planned work' ? `Planned ${commitment.time}` : `Due ${commitment.time}`}</time>
                        </div>
                      </div>

                      <div className="home-commitment-task-row">
                        <CompletionButton
                          task={commitment.task}
                          className="checkbox home-check"
                          label={`Mark ${commitment.task.title} done`}
                        />
                        <div className="home-commitment-task-info">
                          <div className="home-commitment-title-line">
                            {proj && proj.id !== 'inbox' && (
                              <span
                                className="dot briefing-dot"
                                style={{ background: proj.color }}
                                title={proj.name}
                              />
                            )}
                            <button
                              className="widget-task home-commitment-title"
                              onClick={() => props.onOpen(commitment.task.id)}
                            >
                              {commitment.task.title}
                            </button>
                            {suggestion?.task.id === commitment.task.id && (
                              <span className="home-same-task-badge">In focus</span>
                            )}
                          </div>
                          <div className="home-commitment-meta">
                            {proj && proj.id !== 'inbox' && (
                              <span className="meta-item project-name">{proj.name}</span>
                            )}
                            {commitment.kind === 'Planned work' && commitment.task.durationMinutes ? (
                              <span className="meta-item num">{commitment.task.durationMinutes}m focus session</span>
                            ) : null}
                            {commitment.overdue ? (
                              <span className="meta-item overdue">Overdue</span>
                            ) : (
                              <span className="meta-item">{friendlyDate(commitment.date, today)}</span>
                            )}
                            {commitment.task.priority === 1 && (
                              <span className="meta-item priority-1">High priority</span>
                            )}
                            {commitment.task.priority === 2 && (
                              <span className="meta-item priority-2">Medium priority</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {remainingTodayCommitments.length > 0 && (
                        <div className="home-mini-agenda" aria-label="Later commitments today">
                          <div className="home-mini-agenda-head">
                            <span className="home-mini-agenda-label">Later today</span>
                            <span className="home-mini-agenda-count num">{remainingTodayCommitments.length}</span>
                          </div>
                          <ul className="home-agenda-list">
                            {remainingTodayCommitments.map((rem, idx) => {
                              const remProj = projectMap.get(rem.task.projectId);
                              return (
                                <li key={`${rem.task.id}-${rem.time}-${idx}`} className="home-agenda-item">
                                  <div className="home-agenda-time-pill num">
                                    <Clock size={11} strokeWidth={2} aria-hidden="true" />
                                    <time>{rem.kind === 'Planned work' ? `Planned ${rem.time}` : `Due ${rem.time}`}</time>
                                  </div>
                                  <div className="home-agenda-task">
                                    {remProj && remProj.id !== 'inbox' && (
                                      <span
                                        className="dot briefing-dot"
                                        style={{ background: remProj.color }}
                                        title={remProj.name}
                                      />
                                    )}
                                    <button className="home-agenda-title" onClick={() => props.onOpen(rem.task.id)}>
                                      {rem.task.title}
                                    </button>
                                  </div>
                                  {rem.overdue && (
                                    <div className="home-agenda-meta">
                                      <span className="home-agenda-overdue">overdue</span>
                                    </div>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (
                <p className="home-empty-copy">No timed commitments left today. The rest of the day is yours.</p>
              )}
              {editingPlan && props.tasks.find(task => task.id === editingPlan && task.status === 'active') && <PlanEditor key={editingPlan} task={props.tasks.find(task => task.id === editingPlan)!} date={today} suggestedTime={null} close={() => setEditingPlan(null)} />}

              <div className="home-today-list">
                <div className="home-list-head">
                  <span>Open tasks</span>
                  <span className="num">{doneToday} of {dueTodayAll.length} done</span>
                </div>
                {scheduleError && <p className="sub-add-feedback" role="alert">{scheduleError}</p>}
                {openToday.length === 0 ? (
                  <div className="home-backlog-picker-section">
                    <p className="home-empty-copy">Nothing scheduled for today.</p>
                    {homePrefs.showBacklog && unblockedBacklog.length > 0 ? (
                      <div className="home-backlog-tray">
                        <div className="home-backlog-tray-head">
                          <span className="eyebrow">Ready from Backlog</span>
                          <span className="num">{unblockedBacklog.length} parked</span>
                        </div>
                        <ul className="briefing-list">
                          {unblockedBacklog
                            .filter(t => t.id !== suggestion?.task.id)
                            .slice(0, homePrefs.backlogLimit)
                            .map((t) => {
                              const proj = projectMap.get(t.projectId);
                              return (
                                <li key={t.id} className="briefing-task home-backlog-task-row">
                                  <CompletionButton task={t} className="checkbox home-check" label={`Mark ${t.title} done`} />
                                  <button className="briefing-task-title" onClick={() => props.onOpen(t.id)}>
                                    {proj && proj.id !== 'inbox' && (
                                      <span className="dot briefing-dot" style={{ background: proj.color }} title={proj.name} />
                                    )}
                                    {t.title}
                                  </button>
                                  <div className="home-backlog-actions">
                                    {t.durationMinutes && (
                                      <span className="home-meta-pill duration num">{t.durationMinutes}m</span>
                                    )}
                                    <button
                                      type="button"
                                      className="btn-quiet mini home-schedule-pill"
                                      onClick={() => void handleScheduleToday(t.id)}
                                      title="Schedule for today"
                                      aria-label={`Schedule ${t.title} for today`}
                                    >
                                      <CalendarPlus size={12} strokeWidth={2} aria-hidden="true" />
                                      <span>+ Today</span>
                                    </button>
                                  </div>
                                </li>
                              );
                            })}
                        </ul>
                        <button className="home-more-tasks" onClick={() => props.onSelect('backlog')}>
                          View all {unblockedBacklog.length} backlog tasks <ArrowRight size={14} aria-hidden="true" />
                        </button>
                      </div>
                    ) : (
                      <button className="home-more-tasks" onClick={() => props.onSelect('backlog')}>
                        Open Backlog <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <ul className="briefing-list">
                      {openToday.filter(t => t.id !== suggestion?.task.id && t.id !== commitment?.task.id).slice(0, 4).map((t) => {
                        const proj = projectMap.get(t.projectId);
                        return (
                          <li key={t.id} className="briefing-task">
                            <CompletionButton task={t} className="checkbox home-check" label={`Mark ${t.title} done`} />
                            <button className={`briefing-task-title${t.status === 'done' ? ' done' : ''}`} onClick={() => props.onOpen(t.id)}>
                              {proj && proj.id !== 'inbox' && (
                                <span className="dot briefing-dot" style={{ background: proj.color }} title={proj.name} />
                              )}
                              {t.title}
                            </button>
                            <span className={`briefing-task-when num${t.dueDate && t.dueDate < today ? ' overdue' : ''}`}>
                              {t.dueDate ? friendlyDate(t.dueDate, today) : ''}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <button className="home-more-tasks" onClick={() => props.onSelect('today')}>
                      View all {openToday.length} open tasks <ArrowRight size={14} aria-hidden="true" />
                    </button>
                    {homePrefs.showBacklog && unblockedBacklog.length > 0 && (
                      <details className="home-backlog-accordion">
                        <summary>
                          <span>Pull from Backlog</span>
                          <span className="num">{unblockedBacklog.length} ready</span>
                        </summary>
                        <ul className="briefing-list">
                          {unblockedBacklog.slice(0, homePrefs.backlogLimit).map((t) => {
                            const proj = projectMap.get(t.projectId);
                            return (
                              <li key={t.id} className="briefing-task home-backlog-task-row">
                                <CompletionButton task={t} className="checkbox home-check" label={`Mark ${t.title} done`} />
                                <button className="briefing-task-title" onClick={() => props.onOpen(t.id)}>
                                  {proj && proj.id !== 'inbox' && (
                                    <span className="dot briefing-dot" style={{ background: proj.color }} title={proj.name} />
                                  )}
                                  {t.title}
                                </button>
                                <div className="home-backlog-actions">
                                  <button
                                    type="button"
                                    className="btn-quiet mini home-schedule-pill"
                                    onClick={() => void handleScheduleToday(t.id)}
                                    title="Schedule for today"
                                    aria-label={`Schedule ${t.title} for today`}
                                  >
                                    <CalendarPlus size={12} strokeWidth={2} aria-hidden="true" />
                                    <span>+ Today</span>
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                        <button className="home-more-tasks" onClick={() => props.onSelect('backlog')}>
                          View all {unblockedBacklog.length} backlog tasks <ArrowRight size={14} aria-hidden="true" />
                        </button>
                      </details>
                    )}
                  </>
                )}
                {homePrefs.showCompletedToday && completedTodayTasks.length > 0 && (
                  <details className="home-completed-today">
                    <summary>
                      <span>Completed today</span>
                      <span className="num">{completedTodayTasks.length}</span>
                    </summary>
                    <ul className="briefing-list">
                      {completedTodayTasks.map((t) => (
                        <li key={t.id} className="briefing-task completed-task">
                          <CompletionButton task={t} className="checkbox home-check-completed checked" label={`Mark ${t.title} not done`}>
                            <Check size={12} strokeWidth={2.5} aria-hidden="true" />
                          </CompletionButton>
                          <button className="briefing-task-title done" onClick={() => props.onOpen(t.id)}>{t.title}</button>
                          <span className="briefing-task-when num">done</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
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
                  {allHabitsDone && (
                    <div className="habits-complete-banner" role="status">
                      <Check size={13} strokeWidth={2.5} aria-hidden="true" /> All habits completed today
                    </div>
                  )}
                  <ul className="widget-list">
                    {todaysHabits.map((h) => {
                      const done = isHabitDone(h, logsByDate(logs ?? [], h.id).get(today));
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
              {editingJournal || !journalLine ? (
                <form
                  className="home-journal-quick"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveJournalHighlight(journalDraft);
                  }}
                >
                  <input
                    type="text"
                    className="home-journal-input"
                    placeholder="What was worth remembering today?"
                    value={journalDraft}
                    disabled={journalSaving}
                    onChange={(e) => setJournalDraft(e.target.value)}
                    aria-label="Today's highlight"
                  />
                  <div className="home-journal-actions">
                    <button type="submit" className="btn-secondary mini home-journal-save-btn" disabled={journalSaving || !journalDraft.trim()}>
                      {journalSaving ? 'Saving…' : (
                        <>
                          <Check size={12} strokeWidth={2.4} aria-hidden="true" />
                          Save
                        </>
                      )}
                    </button>
                    {editingJournal && (
                      <button type="button" className="btn-quiet mini" onClick={() => setEditingJournal(false)}>
                        <X size={12} strokeWidth={2} aria-hidden="true" />
                        Cancel
                      </button>
                    )}
                    <button type="button" className="btn-quiet mini" onClick={() => props.onSelect('journal')}>
                      Open journal <ArrowRight size={12} aria-hidden="true" />
                    </button>
                  </div>
                  {journalError && <p className="sub-add-feedback" role="alert">{journalError}</p>}
                </form>
              ) : (
                <>
                  <div className="home-journal-body">
                    <BookOpen size={17} strokeWidth={1.75} aria-hidden="true" className="home-journal-icon" />
                    <div>
                      <p className="widget-meta">{journalEntry?.highlight ? "Today's highlight" : "Today's entry"}</p>
                      <p className="home-journal-line">{journalLine}</p>
                    </div>
                  </div>
                  <div className="home-journal-actions">
                    <button className="btn-secondary" onClick={() => props.onSelect('journal')}>
                      <PenLine size={13} strokeWidth={2} aria-hidden="true" />
                      Continue writing
                    </button>
                    <button
                      type="button"
                      className="btn-quiet mini"
                      onClick={() => {
                        setJournalDraft(journalEntry?.highlight ?? journalEntry?.note ?? '');
                        setEditingJournal(true);
                      }}
                    >
                      <PenLine size={12} strokeWidth={2} aria-hidden="true" />
                      Edit highlight
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {!hidden.includes('upnext') && (sugRows.length > 0 || noNextAction > 0) && (
            <section className="home-signals widget" aria-label="Needs attention">
              <div className="widget-head">
                <h2>Needs attention</h2>
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
              {noNextAction > 0 && (
                <p className="widget-meta">{noNextAction} active goal{noNextAction === 1 ? '' : 's'} without a next task.</p>
              )}
              <button className="btn-secondary" onClick={() => setReviewOpen(true)}>
                <CalendarCheck size={14} strokeWidth={2} aria-hidden="true" />
                Review this week
              </button>
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
        </aside>
      </div>

      <details className="home-extra-widgets">
        <summary>More insights · week and goals</summary>
        <p className="widget-meta">Optional detail, kept out of your next-action view.</p>
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

        </div>
      </details>

      {reviewOpen && <WeeklyReview tasks={props.tasks} onOpen={id => { setReviewOpen(false); props.onOpen(id); }} onNavigate={selection => { setReviewOpen(false); props.onNavigate(selection); }} onClose={() => setReviewOpen(false)} />}
    </section>
  );
}
