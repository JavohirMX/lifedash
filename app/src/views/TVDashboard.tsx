import { useEffect, useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  Maximize2,
  Minimize2,
  CheckCircle2,
  Circle,
  Timer,
  Clock,
  Target,
  Sun,
  Moon,
  Sunset,
  Sparkles,
  AlertCircle,
  Check,
  Flame,
} from 'lucide-react';
import { db } from '../db';
import { deriveTv } from '../tv';
import { todayStr, friendlyDate } from '../dates';
import { formatClock, formatDuration } from '../focus';

const TASK_CAP = 8;
const HABIT_CAP = 8;

// Read-only kiosk surface for wall screens, smart TVs, and homelab displays.
// High-contrast dark Nexus palette, ambient auto-hiding controls, keyboard shortcuts.
export default function TVDashboard() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Database queries
  const tasks = useLiveQuery(() => db.tasks.toArray(), []);
  const habits = useLiveQuery(() => db.habits.toArray(), []);
  const logs = useLiveQuery(() => db.habitLogs.toArray(), []);
  const journal = useLiveQuery(() => db.journal.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const focusSessions = useLiveQuery(() => db.focusSessions.toArray(), []);
  const goals = useLiveQuery(() => db.goals.toArray(), []);

  // Controls visibility (auto-hides after 3.5 seconds of inactivity)
  const [controlsVisible, setControlsVisible] = useState(true);
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const show = () => {
      setControlsVisible(true);
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => setControlsVisible(false), 3500);
    };
    show();
    window.addEventListener('mousemove', show);
    window.addEventListener('touchstart', show);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('mousemove', show);
      window.removeEventListener('touchstart', show);
    };
  }, []);

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && Boolean(document.fullscreenElement),
  );
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch(() => {});
    } else {
      void document.exitFullscreen().catch(() => {});
    }
  };

  // Screen Wake Lock API to prevent wall screen sleep
  const [wakeLockActive, setWakeLockActive] = useState(false);
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    let mounted = true;

    const requestWakeLock = async () => {
      if ('wakeLock' in navigator) {
        try {
          wakeLock = await navigator.wakeLock.request('screen');
          if (mounted) setWakeLockActive(true);
          wakeLock.addEventListener('release', () => {
            if (mounted) setWakeLockActive(false);
          });
        } catch {
          if (mounted) setWakeLockActive(false);
        }
      }
    };

    void requestWakeLock();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', onVisibility);
      void wakeLock?.release().catch(() => {});
    };
  }, []);

  // Keyboard navigation: Escape or q to exit, f for fullscreen
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const isInput =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active?.getAttribute('contenteditable') === 'true';
      if (isInput) return;

      if (e.key === 'Escape' || e.key === 'q' || e.key === 'Q') {
        window.location.hash = '';
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!tasks || !habits || !logs || !journal) return null;

  const today = todayStr(now);
  const tv = deriveTv(tasks, habits, logs, journal, today, {
    projects: projects ?? [],
    focusSessions: focusSessions ?? [],
    goals: goals ?? [],
    now,
  });

  const hoursMins = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const dateLabel = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const hour = now.getHours();
  const GreetingIcon = hour >= 5 && hour < 12 ? Sun : hour >= 12 && hour < 18 ? Sunset : Moon;

  const overdueCount = tv.dueTaskItems.filter((i) => i.overdueDays > 0).length;

  return (
    <div className="tv-root" onMouseMove={() => setControlsVisible(true)}>
      {/* Ambient Floating Overlay Controls */}
      <nav
        className={`tv-ambient-controls ${controlsVisible ? 'visible' : ''}`}
        aria-label="TV Display Controls"
      >
        <button
          type="button"
          className="tv-ctrl-btn tv-exit-btn"
          onClick={() => { window.location.hash = ''; }}
          title="Exit to Lifedash (Esc)"
          aria-label="Exit to Lifedash"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Exit to Lifedash</span>
          <kbd className="tv-kbd">Esc</kbd>
        </button>

        <div className="tv-ctrl-group">
          {wakeLockActive && (
            <div className="tv-wake-indicator" title="Screen wake lock is active">
              <span className="tv-wake-dot" />
              <span>Awake</span>
            </div>
          )}

          <button
            type="button"
            className="tv-ctrl-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen (F)' : 'Enter fullscreen (F)'}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
            <span className="tv-ctrl-label">{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
            <kbd className="tv-kbd">F</kbd>
          </button>
        </div>
      </nav>

      {/* Main Kiosk Header */}
      <header className="tv-head">
        <div className="tv-clock-wrap">
          <div className="tv-clock num">
            <span>{hoursMins}</span>
            <span className="tv-clock-sec">:{seconds}</span>
          </div>
          <div className="tv-date-row">
            <div className="tv-date">{dateLabel}</div>
            <div className="tv-greeting">
              <GreetingIcon size={16} className="tv-greeting-icon" aria-hidden="true" />
              <span>{tv.greeting}</span>
            </div>
          </div>
        </div>

        {/* Glanceable Metrics Pill Row */}
        <div className="tv-summary-row" role="region" aria-label="Daily summary">
          {tv.dueTodayTotal > 0 ? (
            <div className="tv-pill tv-pill-primary">
              <Clock size={14} aria-hidden="true" />
              <span><strong>{tv.dueTodayTotal}</strong> due today</span>
            </div>
          ) : (
            <div className="tv-pill tv-pill-success">
              <Check size={14} aria-hidden="true" />
              <span>Schedule clear</span>
            </div>
          )}

          {overdueCount > 0 && (
            <div className="tv-pill tv-pill-alert">
              <AlertCircle size={14} aria-hidden="true" />
              <span><strong>{overdueCount}</strong> overdue</span>
            </div>
          )}

          {tv.completedTodayCount > 0 && (
            <div className="tv-pill tv-pill-done">
              <CheckCircle2 size={14} aria-hidden="true" />
              <span><strong>{tv.completedTodayCount}</strong> done today</span>
            </div>
          )}

          {tv.habitsTotal > 0 && (
            <div className="tv-pill tv-pill-habit">
              <Flame size={14} aria-hidden="true" />
              <span><strong>{tv.habitsDone}</strong>/{tv.habitsTotal} habits</span>
            </div>
          )}

          {tv.focus.todaySeconds > 0 && (
            <div className="tv-pill tv-pill-focus">
              <Timer size={14} aria-hidden="true" />
              <span><strong>{formatDuration(tv.focus.todaySeconds)}</strong> focused</span>
            </div>
          )}
        </div>
      </header>

      {/* Grid of Ambient Cards */}
      <main className="tv-grid">
        {/* Active Focus Sprint or Top Priority Task */}
        {tv.focus.runningTaskId ? (
          <section className="tv-card tv-card-focus-live" aria-label="Active Focus Sprint">
            <div className="tv-card-badge-row">
              <span className="tv-badge-live">
                <span className="tv-live-dot" />
                FOCUS SPRINT IN PROGRESS
              </span>
              <span className="tv-focus-today-note">
                {formatDuration(tv.focus.todaySeconds)} focused today
              </span>
            </div>
            <p className="tv-top-title">{tv.focus.runningTaskTitle}</p>
            <div className="tv-focus-timer num" aria-live="polite">
              <Timer size={24} className="tv-timer-icon" aria-hidden="true" />
              <span>{formatClock(tv.focus.runningSeconds)}</span>
            </div>
          </section>
        ) : (
          <section className="tv-card tv-card-highlighted">
            <h2>Top Priority</h2>
            {tv.topTask ? (
              <>
                <div className="tv-top-task-head">
                  {tv.topTaskProject && (
                    <span className="tv-project-pill" style={{ borderColor: tv.topTaskProject.color }}>
                      <span className="tv-project-dot" style={{ backgroundColor: tv.topTaskProject.color }} />
                      <span>{tv.topTaskProject.name}</span>
                    </span>
                  )}
                  {tv.topTask.priority > 0 && (
                    <span className={`tv-prio-badge prio-${tv.topTask.priority}`}>
                      P{tv.topTask.priority}
                    </span>
                  )}
                </div>
                <p className="tv-top-title">{tv.topTask.title}</p>
                <p className="tv-top-meta">
                  {tv.topTaskOverdueSince ? (
                    <span className="tv-overdue-alert">
                      Overdue since {friendlyDate(tv.topTaskOverdueSince, today)}
                    </span>
                  ) : tv.topTask.dueTime ? (
                    <span>Due at {tv.topTask.dueTime}</span>
                  ) : (
                    <span>Due today</span>
                  )}
                </p>
              </>
            ) : (
              <p className="tv-empty">Nothing due. Enjoy your day.</p>
            )}
          </section>
        )}

        {/* Today's Highlight */}
        {tv.highlight && (
          <section className="tv-card tv-highlight" aria-label="Today's highlight">
            <div className="tv-card-badge-row">
              <span className="tv-highlight-label">
                <Sparkles size={14} aria-hidden="true" />
                <span>Today&apos;s Highlight</span>
              </span>
            </div>
            <p className="tv-highlight-text">&ldquo;{tv.highlight}&rdquo;</p>
          </section>
        )}

        {/* Habits Today */}
        <section className="tv-card" aria-label="Habits today">
          <div className="tv-card-head-row">
            <h2>Habits Today</h2>
            {tv.habitsTotal > 0 && (
              <span className="tv-card-count num">{tv.habitsDone} of {tv.habitsTotal}</span>
            )}
          </div>

          {tv.habitsTotal > 0 ? (
            <>
              <div className="tv-bar" role="img" aria-label={`${tv.habitsDone} of ${tv.habitsTotal} habits done`}>
                <div className="tv-bar-fill" style={{ width: `${tv.habitPct ?? 0}%` }} />
              </div>
              <ul className="tv-list tv-habits-list">
                {tv.habitsToday.slice(0, HABIT_CAP).map((r) => (
                  <li key={r.habit.id} className={r.done ? 'tv-habit-item tv-done' : 'tv-habit-item'}>
                    <div className="tv-habit-info">
                      {r.done ? (
                        <CheckCircle2 size={18} className="tv-check-icon checked" aria-hidden="true" />
                      ) : (
                        <Circle size={18} className="tv-check-icon" aria-hidden="true" />
                      )}
                      <span className="dot" style={{ background: r.habit.color }} aria-hidden="true" />
                      <span className="tv-habit-name">{r.habit.name}</span>
                    </div>
                  </li>
                ))}
                {tv.habitsToday.length > HABIT_CAP && (
                  <li className="tv-more">+{tv.habitsToday.length - HABIT_CAP} more habits</li>
                )}
              </ul>
            </>
          ) : (
            <p className="tv-empty">No habits scheduled today.</p>
          )}

          {tv.weekPct !== null && (
            <div className="tv-habit-week-footer">
              <div className="tv-habit-week-bar" role="img" aria-label={`${tv.weekPct}% this week`}>
                <div className="tv-bar-fill" style={{ width: `${tv.weekPct}%` }} />
              </div>
              <span className="tv-sub">
                <strong>{tv.weekPct}%</strong> weekly consistency ({tv.weekDone}/{tv.weekScheduled} check-ins)
              </span>
            </div>
          )}
        </section>

        {/* Active Goals (if user has active goals) */}
        {tv.activeGoals.length > 0 && (
          <section className="tv-card" aria-label="Active goals">
            <div className="tv-card-head-row">
              <h2>Active Goals</h2>
              <span className="tv-card-count num">{tv.activeGoals.length}</span>
            </div>
            <ul className="tv-list tv-goals-list">
              {tv.activeGoals.map((g) => (
                <li key={g.id} className="tv-goal-item">
                  <div className="tv-goal-info">
                    <Target size={16} className="tv-goal-icon" aria-hidden="true" />
                    <span className="tv-goal-title">{g.title}</span>
                  </div>
                  {g.targetDate && (
                    <span className="tv-goal-date num">{friendlyDate(g.targetDate, today)}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Due Today & Overdue Tasks */}
        <section className="tv-card tv-wide" aria-label="Tasks due today">
          <div className="tv-card-head-row">
            <h2>Due &amp; Scheduled Today</h2>
            {tv.dueTodayTotal > 0 && (
              <span className="tv-card-count num">{tv.dueTodayTotal} tasks</span>
            )}
          </div>

          {tv.dueTaskItems.length > 0 ? (
            <ul className="tv-list tv-due">
              {tv.dueTaskItems.slice(0, TASK_CAP).map(({ task: t, project, overdueDays }) => {
                const isOverdue = overdueDays > 0;
                return (
                  <li key={t.id} className={`tv-task-row ${isOverdue ? 'tv-row-overdue' : ''}`}>
                    <div className="tv-task-main">
                      {project && (
                        <span className="tv-task-proj-badge" style={{ borderColor: project.color }}>
                          <span className="tv-project-dot" style={{ backgroundColor: project.color }} />
                          <span>{project.name}</span>
                        </span>
                      )}
                      {t.priority > 0 && (
                        <span className={`tv-prio-badge prio-${t.priority}`}>
                          P{t.priority}
                        </span>
                      )}
                      <span className="tv-task-title">{t.title}</span>
                    </div>

                    <div className="tv-task-meta">
                      {isOverdue && (
                        <span className="tv-overdue-tag">
                          {overdueDays === 1 ? 'Yesterday' : `${overdueDays}d overdue`}
                        </span>
                      )}
                      {t.dueTime && <span className="tv-time num">{t.dueTime}</span>}
                    </div>
                  </li>
                );
              })}
              {tv.dueTodayTotal > TASK_CAP && (
                <li className="tv-more">+{tv.dueTodayTotal - TASK_CAP} more scheduled tasks</li>
              )}
            </ul>
          ) : (
            <p className="tv-empty">Nothing due today. Enjoy the clear slate.</p>
          )}
        </section>
      </main>
    </div>
  );
}
