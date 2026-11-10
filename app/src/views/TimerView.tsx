import React, { useMemo, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Square,
  Check,
  CheckCircle2,
  Circle,
  Plus,
  Volume2,
  VolumeX,
  PictureInPicture2,
  Coffee,
  Sparkles,
  Copy,
  Clock,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { PageHeader } from '../components/Page';
import { formatClock, formatRounds, calculateRemaining, type PomodoroStage } from '../focus';
import { isSoundMuted, playBell, setSoundMuted } from '../sound';
import { requestNativePiP } from '../pipService';
import { useActiveTools } from '../activeTools';
import { addTask, toggleComplete, updateTask } from '../repo';
import type { Selection } from '../components/Sidebar';
import './timer-view.css';

export interface TimerViewProps {
  taskId?: string | null;
  onSelectTask?: (id: string | null) => void;
  onOpenPiP?: () => void;
  onNavigate?: (s: Selection) => void;
  pipActive?: boolean;
}

export default function TimerView(props: TimerViewProps) {
  const { timer, elapsedSeconds, actions } = useActiveTools();
  const [muted, setMutedState] = useState(() => isSoundMuted());

  // Tasks from Dexie
  const allTasks = useLiveQuery(
    () => db.tasks.filter((t) => t.status === 'active').toArray(),
    []
  );

  const selectedTaskId = timer.taskId ?? props.taskId ?? null;
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

  // Scratchpad
  const [scratchpad, setScratchpad] = useState('');
  const [savedNoteStatus, setSavedNoteStatus] = useState('');
  const [newSubtask, setNewSubtask] = useState('');

  const remainingPomodoroSec = calculateRemaining(timer.targetDurationSec, elapsedSeconds);
  const isBreak = timer.stage !== 'work';

  const toggleSound = () => {
    const next = !muted;
    setMutedState(next);
    setSoundMuted(next);
    if (!next) {
      playBell(587.33, 0.8);
    }
  };

  const handleSelectPreset = (sec: number, stage: PomodoroStage = 'work') => {
    actions.resetTimer(sec, stage);
  };

  const handleStartOrResume = () => {
    if (timer.isPaused) {
      void actions.resumeTimer();
    } else {
      void actions.startTimer(selectedTaskId, timer.targetDurationSec, timer.stage);
    }
  };

  const handleAddSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubtask.trim()) return;
    const clean = newSubtask.trim();
    setNewSubtask('');

    if (task) {
      await addTask({ title: clean, projectId: task.projectId, parentId: task.id });
    } else {
      const newT = await addTask({ title: clean, projectId: 'inbox' });
      actions.setTimerTask(newT.id);
      props.onSelectTask?.(newT.id);
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
      try {
        await navigator.clipboard.writeText(scratchpad.trim());
        setSavedNoteStatus('Copied notes to clipboard.');
        setTimeout(() => setSavedNoteStatus(''), 3000);
      } catch {
        setSavedNoteStatus('Ready to copy.');
      }
    }
  };

  const handleCompleteTask = async () => {
    if (!task) return;
    await actions.stopTimer();
    await toggleComplete(task);
  };

  const handlePiP = async () => {
    if (!timer.isRunning && timer.accumulatedSec === 0) {
      await actions.startTimer(selectedTaskId, timer.targetDurationSec, timer.stage);
    }
    actions.pinTimerPiP();
    try {
      await requestNativePiP('timer');
    } catch {
      // In-website PiP pinned
    }
    props.onOpenPiP?.();
  };

  return (
    <div className="page-wrap timer-view-wrap">
      <PageHeader
        eyebrow="Tools · Deep Work & Focus"
        title="Focus & Pomodoro Timer"
        description="Structured intervals to cultivate deep focus, track work sprints, and take restorative breaks."
      />

      <div className="timer-card-hero">
        <div className="timer-top-bar">
          <div className="timer-mode-toggle" role="group" aria-label="Timer mode">
            <button
              type="button"
              className={`timer-mode-btn ${timer.timerMode === 'pomodoro' ? 'active' : ''}`}
              onClick={() => actions.setTimerMode('pomodoro')}
            >
              Pomodoro
            </button>
            <button
              type="button"
              className={`timer-mode-btn ${timer.timerMode === 'stopwatch' ? 'active' : ''}`}
              onClick={() => actions.setTimerMode('stopwatch')}
            >
              Stopwatch
            </button>
          </div>

          <div className="timer-top-actions">
            <button
              type="button"
              className="icon-btn"
              onClick={toggleSound}
              title={muted ? 'Unmute bell chime' : 'Mute bell chime'}
              aria-label={muted ? 'Unmute bell chime' : 'Mute bell chime'}
            >
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>

            <button
              type="button"
              className="btn-secondary timer-top-pip-btn"
              onClick={handlePiP}
              title="Open Picture-in-Picture mode"
            >
              <PictureInPicture2 size={14} />
              <span>PiP Mode</span>
            </button>
          </div>
        </div>

        {timer.timerMode === 'pomodoro' && (
          <div className="timer-presets-bar" role="group" aria-label="Interval presets">
            <button
              type="button"
              className={`timer-preset-chip ${timer.stage === 'work' && timer.targetDurationSec === 25 * 60 ? 'active' : ''}`}
              onClick={() => handleSelectPreset(25 * 60, 'work')}
            >
              25m Focus
            </button>
            <button
              type="button"
              className={`timer-preset-chip ${timer.stage === 'work' && timer.targetDurationSec === 50 * 60 ? 'active' : ''}`}
              onClick={() => handleSelectPreset(50 * 60, 'work')}
            >
              50m Deep Work
            </button>
            <button
              type="button"
              className={`timer-preset-chip break-chip ${timer.stage === 'short-break' ? 'active' : ''}`}
              onClick={() => handleSelectPreset(5 * 60, 'short-break')}
            >
              <Coffee size={12} style={{ display: 'inline', marginRight: 4 }} />
              5m Short Break
            </button>
            <button
              type="button"
              className={`timer-preset-chip break-chip ${timer.stage === 'long-break' ? 'active' : ''}`}
              onClick={() => handleSelectPreset(15 * 60, 'long-break')}
            >
              <Coffee size={12} style={{ display: 'inline', marginRight: 4 }} />
              15m Long Break
            </button>
          </div>
        )}

        {timer.timerMode === 'pomodoro' && (
          <div className="timer-rounds-indicator">
            <span>{formatRounds(timer.completedRounds + 1, 4)}</span>
            <div className="timer-round-dots">
              {[0, 1, 2, 3].map((idx) => {
                const isCompleted = idx < timer.completedRounds % 4;
                const isCurrent = idx === timer.completedRounds % 4;
                return (
                  <span
                    key={idx}
                    className={`timer-round-dot ${isCompleted ? 'completed' : isCurrent ? 'current' : ''}`}
                  />
                );
              })}
            </div>
          </div>
        )}

        <div className={`timer-clock-display num ${isBreak ? 'break-mode' : ''}`}>
          {timer.timerMode === 'stopwatch'
            ? formatClock(elapsedSeconds)
            : formatClock(remainingPomodoroSec)}
        </div>

        <p className="timer-clock-status">
          {!timer.isRunning
            ? timer.timerMode === 'stopwatch'
              ? 'Ready to start counting'
              : `Ready for ${Math.round(timer.targetDurationSec / 60)}m ${isBreak ? 'break' : 'sprint'}`
            : timer.isPaused
            ? 'Timer paused'
            : timer.timerMode === 'stopwatch'
            ? `${Math.floor(elapsedSeconds / 60)} minutes elapsed`
            : remainingPomodoroSec === 0
            ? 'Time is up!'
            : `${Math.ceil(remainingPomodoroSec / 60)} minutes remaining`}
        </p>

        {timer.timerMode === 'pomodoro' && remainingPomodoroSec === 0 ? (
          <div style={{ marginBottom: 20 }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() => actions.nextPomodoroStage()}
              style={{ padding: '9px 22px', fontSize: '0.95rem' }}
            >
              {timer.stage === 'work' ? 'Start 5m Break' : 'Start Next Work Round (25m)'}
            </button>
          </div>
        ) : (
          <div className="timer-controls-row">
            {!timer.isRunning || timer.isPaused ? (
              <button
                type="button"
                className="btn-primary"
                onClick={handleStartOrResume}
              >
                <Play size={16} fill="currentColor" />
                <span>{timer.isPaused ? 'Resume' : timer.stage === 'work' ? 'Start Focus' : 'Start Break'}</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void actions.pauseTimer()}
              >
                <Pause size={16} />
                <span>Pause</span>
              </button>
            )}

            {(timer.isRunning || timer.accumulatedSec > 0) && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => actions.resetTimer()}
                title="Reset timer"
              >
                <RotateCcw size={15} />
                <span>Reset</span>
              </button>
            )}

            {timer.isRunning && (
              <button
                type="button"
                className="btn-secondary timer-btn-danger"
                onClick={() => void actions.stopTimer()}
                title="Stop focus session"
              >
                <Square size={13} fill="currentColor" />
                <span>Stop</span>
              </button>
            )}
          </div>
        )}

        {/* Task Attachment Section */}
        <div className="timer-task-section">
          {task ? (
            <div className="timer-attached-task">
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: project?.color ?? 'var(--accent)',
                }}
              />
              <h3 className="timer-task-title">{task.title}</h3>
              <button
                type="button"
                className="btn-primary mini"
                onClick={() => void handleCompleteTask()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <Check size={14} strokeWidth={2.2} />
                Complete
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <select
                className="timer-task-select"
                value={selectedTaskId ?? ''}
                onChange={(e) => {
                  const val = e.target.value || null;
                  actions.setTimerTask(val);
                  props.onSelectTask?.(val);
                }}
                aria-label="Attach to an open task"
              >
                <option value="">Free Focus (no task attached)…</option>
                {allTasks?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Panels: Subtasks and Scratchpad */}
      <div className="timer-panels-grid">
        <section className="timer-panel">
          <h2 className="timer-panel-title">
            Checklist ({subtasks?.filter((t) => t.status === 'done').length ?? 0}/
            {subtasks?.length ?? 0})
          </h2>
          <p className="timer-panel-desc">Step-by-step actions for this work block.</p>

          <div className="timer-subtasks-list">
            {subtasks && subtasks.length > 0 ? (
              subtasks.map((st) => (
                <div
                  key={st.id}
                  className={`timer-subtask-item ${st.status === 'done' ? 'done' : ''}`}
                  onClick={() => void toggleComplete(st)}
                >
                  <button
                    type="button"
                    className={`planner-block-check ${st.status === 'done' ? 'checked' : ''}`}
                    aria-label={st.status === 'done' ? 'Mark open' : 'Mark done'}
                  >
                    {st.status === 'done' ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                  </button>
                  <span className="timer-subtask-text">{st.title}</span>
                </div>
              ))
            ) : (
              <p className="workflow-hint">No checklist items yet.</p>
            )}
          </div>

          <form onSubmit={(e) => void handleAddSubtask(e)} className="timer-subtask-form">
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

        <section className="timer-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 className="timer-panel-title">Scratchpad & Fleeting Notes</h2>
            {savedNoteStatus && (
              <span className="form-save-status" style={{ fontSize: '0.75rem', margin: 0 }}>
                {savedNoteStatus}
              </span>
            )}
          </div>
          <p className="timer-panel-desc">Jot down intrusive ideas without breaking flow.</p>
          <textarea
            className="timer-scratchpad-input"
            rows={4}
            placeholder="Quick thought, follow-up item, or realization…"
            value={scratchpad}
            onChange={(e) => setScratchpad(e.target.value)}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
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
    </div>
  );
}
