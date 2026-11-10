import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Coffee,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
  Copy,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { addTask, startFocus, stopFocus, toggleComplete, updateTask } from '../repo';
import {
  calculateRemaining,
  formatClock,
  formatRounds,
  getNextStage,
  sessionSeconds,
  type PomodoroStage,
} from '../focus';
import { isSoundMuted, playBell, setSoundMuted } from '../sound';
import type { FocusSession, Task } from '../types';
import './focus-workspace.css';

export interface FocusWorkspaceProps {
  taskId?: string | null;
  onClose: () => void;
  onOpenDetail?: (id: string) => void;
}

export default function FocusWorkspace({ taskId: initialTaskId, onClose }: FocusWorkspaceProps) {
  // Query all active focus sessions and open tasks
  const focusSessions = useLiveQuery(() => db.focusSessions.toArray(), []);
  const allTasks = useLiveQuery(
    () => db.tasks.filter((t) => t.status === 'active').toArray(),
    []
  );

  // Identify any currently running session
  const globallyRunningSession = useMemo(() => {
    if (!focusSessions) return null;
    return (
      focusSessions
        .filter((s) => s.endedAt === null)
        .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null
    );
  }, [focusSessions]);

  // Current task id: prop taskId > running session task > null
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    () => initialTaskId ?? globallyRunningSession?.taskId ?? null
  );

  // Sync if initialTaskId changes
  useEffect(() => {
    if (initialTaskId !== undefined) {
      setSelectedTaskId(initialTaskId);
    }
  }, [initialTaskId]);

  const task = useLiveQuery(
    () => (selectedTaskId ? db.tasks.get(selectedTaskId) : undefined),
    [selectedTaskId]
  );
  const project = useLiveQuery(
    () => (task ? db.projects.get(task.projectId) : undefined),
    [task?.projectId]
  );
  const subtasks = useLiveQuery(
    () =>
      selectedTaskId
        ? db.tasks
            .where('parentId')
            .equals(selectedTaskId)
            .filter((t) => t.status !== 'archived')
            .toArray()
        : [],
    [selectedTaskId]
  );

  // Timer configuration
  const [timerMode, setTimerMode] = useState<'pomodoro' | 'stopwatch'>('pomodoro');
  const [stage, setStage] = useState<PomodoroStage>('work');
  const [targetDurationSec, setTargetDurationSec] = useState<number>(25 * 60);
  const [completedWorkRounds, setCompletedWorkRounds] = useState<number>(0);
  const [muted, setMutedState] = useState(() => isSoundMuted());

  // Standalone timer state (for when no task is selected or running in Dexie)
  const [standaloneRunning, setStandaloneRunning] = useState(true);
  const [standaloneAccumulated, setStandaloneAccumulated] = useState(0);
  const [standaloneSessionStart, setStandaloneSessionStart] = useState(() => Date.now());

  const [now, setNow] = useState(() => Date.now());
  const hasRungRef = useRef(false);

  // 1-second ticker
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Is Dexie focus session running on the selected task?
  const activeDexieSession = useMemo(() => {
    if (!focusSessions || !selectedTaskId) return null;
    return (
      focusSessions
        .filter((s) => s.taskId === selectedTaskId && s.endedAt === null)
        .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null
    );
  }, [focusSessions, selectedTaskId]);

  // If a task is selected and no session is running for it, auto-start one
  useEffect(() => {
    if (selectedTaskId && !activeDexieSession) {
      void startFocus(selectedTaskId);
    }
  }, [selectedTaskId]);

  // Calculate elapsed seconds
  const elapsedSeconds = useMemo(() => {
    if (selectedTaskId && activeDexieSession) {
      return sessionSeconds(activeDexieSession, now);
    }
    // Standalone timer
    if (!standaloneRunning) return standaloneAccumulated;
    return standaloneAccumulated + Math.max(0, Math.floor((now - standaloneSessionStart) / 1000));
  }, [selectedTaskId, activeDexieSession, standaloneRunning, standaloneAccumulated, standaloneSessionStart, now]);

  const remainingPomodoroSec = calculateRemaining(targetDurationSec, elapsedSeconds);

  // Sound and Notification trigger on timer completion
  useEffect(() => {
    if (timerMode === 'pomodoro' && elapsedSeconds >= targetDurationSec && !hasRungRef.current) {
      hasRungRef.current = true;
      playBell();

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const title = stage === 'work' ? 'Pomodoro Complete!' : 'Break Finished!';
        const body =
          stage === 'work'
            ? 'Great focus block! Time to take a restful 5-minute break.'
            : 'Break is over. Ready to begin your next focus round?';
        try {
          new Notification(title, { body });
        } catch {
          // ignore
        }
      }
    }
  }, [timerMode, elapsedSeconds, targetDurationSec, stage]);

  // Reset ring guard when interval changes
  const resetInterval = (newSec: number, newStage: PomodoroStage = 'work') => {
    setTargetDurationSec(newSec);
    setStage(newStage);
    hasRungRef.current = false;
    // Restart local tracker for standalone or restart Dexie session
    if (selectedTaskId) {
      void startFocus(selectedTaskId);
    } else {
      setStandaloneAccumulated(0);
      setStandaloneSessionStart(Date.now());
      setStandaloneRunning(true);
    }
  };

  const handleNextStage = () => {
    if (stage === 'work') {
      const nextRounds = completedWorkRounds + 1;
      setCompletedWorkRounds(nextRounds);
      const next = getNextStage('work', nextRounds, 4);
      const breakSec = next === 'long-break' ? 15 * 60 : 5 * 60;
      resetInterval(breakSec, next);
    } else {
      resetInterval(25 * 60, 'work');
    }
  };

  const toggleSound = () => {
    const next = !muted;
    setMutedState(next);
    setSoundMuted(next);
    if (!next) {
      playBell(587.33, 0.8);
    }
  };

  // Scratchpad state
  const [scratchpad, setScratchpad] = useState('');
  const [savedNoteStatus, setSavedNoteStatus] = useState('');

  // Subtask quick add
  const [newSubtask, setNewSubtask] = useState('');

  const handleAddSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubtask.trim()) return;
    const clean = newSubtask.trim();
    setNewSubtask('');

    if (task) {
      await addTask({ title: clean, projectId: task.projectId, parentId: task.id });
    } else {
      // Create a new task in inbox
      const newT = await addTask({ title: clean, projectId: 'inbox' });
      setSelectedTaskId(newT.id);
    }
  };

  const handleAppendScratchpad = async () => {
    if (!scratchpad.trim()) return;
    if (task) {
      const currentNote = task.note ? `${task.note}\n\n` : '';
      const updated = `${currentNote}Focus Note (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}):\n${scratchpad.trim()}`;
      await updateTask(task.id, { note: updated });
      setScratchpad('');
      setSavedNoteStatus('Saved notes into task.');
      setTimeout(() => setSavedNoteStatus(''), 3000);
    } else {
      // Copy to clipboard
      try {
        await navigator.clipboard.writeText(scratchpad.trim());
        setSavedNoteStatus('Copied notes to clipboard.');
        setTimeout(() => setSavedNoteStatus(''), 3000);
      } catch {
        setSavedNoteStatus('Ready to copy.');
      }
    }
  };

  const handleStop = async () => {
    if (selectedTaskId) {
      await stopFocus();
    }
    setStandaloneRunning(false);
    onClose();
  };

  const handleCompleteTask = async () => {
    if (!task) return;
    await stopFocus();
    await toggleComplete(task);
    onClose();
  };

  // Keyboard shortcut listener
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (task) void handleCompleteTask();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [task?.id]);

  const isBreak = stage !== 'work';

  return (
    <div
      className="focus-workspace-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Focus workspace"
    >
      <header className="focus-workspace-head">
        <div className="focus-workspace-tag">
          {task ? (
            <>
              <span
                className="focus-project-dot"
                style={{ background: project?.color ?? 'var(--accent, #0f766e)' }}
              />
              <span>{project?.name ?? 'Inbox'}</span>
            </>
          ) : (
            <>
              <Clock size={15} aria-hidden="true" />
              <span>Standalone Focus</span>
            </>
          )}
        </div>

        <div className="focus-workspace-actions">
          <div className="focus-mode-toggle">
            <button
              type="button"
              className={`focus-mode-btn ${timerMode === 'pomodoro' ? 'active' : ''}`}
              onClick={() => {
                setTimerMode('pomodoro');
                hasRungRef.current = false;
              }}
            >
              Pomodoro
            </button>
            <button
              type="button"
              className={`focus-mode-btn ${timerMode === 'stopwatch' ? 'active' : ''}`}
              onClick={() => setTimerMode('stopwatch')}
            >
              Stopwatch
            </button>
          </div>

          <button
            type="button"
            className="icon-btn"
            onClick={toggleSound}
            title={muted ? 'Unmute chime' : 'Mute chime'}
            aria-label={muted ? 'Unmute chime' : 'Mute chime'}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>

          <button
            type="button"
            className="btn-secondary mini"
            onClick={onClose}
            title="Minimize to dashboard (Esc)"
          >
            <Minimize2 size={14} aria-hidden="true" />
            <span>Minimize</span>
          </button>

          <button
            type="button"
            className="mini danger"
            onClick={() => void handleStop()}
            title="Stop session"
          >
            <Square size={12} fill="currentColor" aria-hidden="true" />
            <span>Stop Focus</span>
          </button>
        </div>
      </header>

      <main className="focus-workspace-body">
        <div className="focus-timer-section">
          {timerMode === 'pomodoro' && (
            <div className="focus-intervals-bar" role="group" aria-label="Timer presets">
              <button
                type="button"
                className={`focus-interval-btn ${stage === 'work' && targetDurationSec === 25 * 60 ? 'active' : ''}`}
                onClick={() => resetInterval(25 * 60, 'work')}
              >
                25m Focus
              </button>
              <button
                type="button"
                className={`focus-interval-btn ${stage === 'work' && targetDurationSec === 50 * 60 ? 'active' : ''}`}
                onClick={() => resetInterval(50 * 60, 'work')}
              >
                50m Deep Work
              </button>
              <button
                type="button"
                className={`focus-interval-btn break-btn ${stage === 'short-break' ? 'active' : ''}`}
                onClick={() => resetInterval(5 * 60, 'short-break')}
              >
                <Coffee size={12} style={{ display: 'inline', marginRight: 4 }} />
                5m Short Break
              </button>
              <button
                type="button"
                className={`focus-interval-btn break-btn ${stage === 'long-break' ? 'active' : ''}`}
                onClick={() => resetInterval(15 * 60, 'long-break')}
              >
                <Coffee size={12} style={{ display: 'inline', marginRight: 4 }} />
                15m Long Break
              </button>
            </div>
          )}

          {timerMode === 'pomodoro' && (
            <div className="focus-rounds-indicator">
              <span>{formatRounds(completedWorkRounds + 1, 4)}</span>
              <div className="focus-round-dots">
                {[0, 1, 2, 3].map((idx) => {
                  const isCompleted = idx < completedWorkRounds % 4;
                  const isCurrent = idx === completedWorkRounds % 4;
                  return (
                    <span
                      key={idx}
                      className={`focus-round-dot ${isCompleted ? 'completed' : isCurrent ? 'current' : ''}`}
                    />
                  );
                })}
              </div>
            </div>
          )}

          <div className={`focus-clock-display num ${isBreak ? 'break-mode' : ''}`}>
            {timerMode === 'stopwatch'
              ? formatClock(elapsedSeconds)
              : formatClock(remainingPomodoroSec)}
          </div>

          {timerMode === 'pomodoro' && remainingPomodoroSec === 0 ? (
            <div style={{ marginTop: 12 }}>
              <div className="focus-break-notice">
                <Sparkles size={15} />
                <span>
                  {stage === 'work'
                    ? 'Round complete! Take a well-earned break.'
                    : 'Break finished! Ready to dive back in?'}
                </span>
              </div>
              <div>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleNextStage}
                  style={{ padding: '8px 18px', fontSize: '0.9rem' }}
                >
                  {stage === 'work' ? 'Start 5m Break' : 'Start Next Round (25m)'}
                </button>
              </div>
            </div>
          ) : (
            <p className="focus-timer-sub">
              {timerMode === 'stopwatch'
                ? `${Math.floor(elapsedSeconds / 60)} minutes elapsed`
                : isBreak
                ? `${Math.ceil(remainingPomodoroSec / 60)} minutes left in break`
                : `${Math.ceil(remainingPomodoroSec / 60)} minutes remaining`}
            </p>
          )}

          {/* Headline & Task controls */}
          {task ? (
            <>
              <h1 className="focus-task-headline">{task.title}</h1>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16 }}>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ padding: '8px 20px', fontSize: '0.95rem' }}
                  onClick={() => void handleCompleteTask()}
                >
                  <Check size={16} strokeWidth={2.2} aria-hidden="true" />
                  Complete Task
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="focus-task-headline">Deep Focus Session</h1>
              <div className="focus-task-picker">
                <select
                  className="focus-task-select"
                  value={selectedTaskId ?? ''}
                  onChange={(e) => setSelectedTaskId(e.target.value || null)}
                  aria-label="Attach to an open task"
                >
                  <option value="">Attach an open task (optional)…</option>
                  {allTasks?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        <div className="focus-grid-panels">
          {/* Subtasks checklist panel */}
          <section className="focus-panel">
            <h2 className="focus-panel-title">
              Checklist ({subtasks?.filter((t) => t.status === 'done').length ?? 0}/
              {subtasks?.length ?? 0})
            </h2>

            <div className="focus-subtasks-list">
              {subtasks && subtasks.length > 0 ? (
                subtasks.map((st) => (
                  <div
                    key={st.id}
                    className={`focus-subtask-item ${st.status === 'done' ? 'done' : ''}`}
                    onClick={() => void toggleComplete(st)}
                  >
                    <button
                      type="button"
                      className={`planner-block-check ${st.status === 'done' ? 'checked' : ''}`}
                      aria-label={st.status === 'done' ? 'Mark open' : 'Mark done'}
                    >
                      {st.status === 'done' ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                    </button>
                    <span className="focus-subtask-text">{st.title}</span>
                  </div>
                ))
              ) : (
                <p className="workflow-hint">No subtasks yet.</p>
              )}
            </div>

            <form onSubmit={(e) => void handleAddSubtask(e)} className="focus-subtask-form">
              <input
                placeholder={task ? 'Add next step…' : 'Quick checklist item…'}
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                aria-label="Add next step"
              />
              <button
                type="submit"
                className="btn-secondary mini"
                disabled={!newSubtask.trim()}
              >
                <Plus size={14} aria-hidden="true" />
                Add
              </button>
            </form>
          </section>

          {/* Distraction Brain-Dump Scratchpad */}
          <section className="focus-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="focus-panel-title">Scratchpad & Fleeting Notes</h2>
              {savedNoteStatus && (
                <span className="form-save-status" style={{ fontSize: '0.75rem', margin: 0 }}>
                  {savedNoteStatus}
                </span>
              )}
            </div>
            <p className="focus-panel-desc">
              Don't get sidetracked. Jot down thoughts here and save them without breaking flow.
            </p>
            <textarea
              className="focus-scratchpad-input"
              rows={4}
              placeholder="Jot down quick thoughts, follow-up items, or notes…"
              value={scratchpad}
              onChange={(e) => setScratchpad(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button
                type="button"
                className="btn-secondary mini"
                disabled={!scratchpad.trim()}
                onClick={() => void handleAppendScratchpad()}
              >
                {task ? (
                  'Save to Task Note'
                ) : (
                  <>
                    <Copy size={13} style={{ display: 'inline', marginRight: 4 }} />
                    Copy to Clipboard
                  </>
                )}
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
