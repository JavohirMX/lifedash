import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { addTask, stopFocus, toggleComplete, updateTask } from '../repo';
import { formatClock, sessionSeconds } from '../focus';
import type { FocusSession, Task } from '../types';
import './focus-workspace.css';

export interface FocusWorkspaceProps {
  taskId: string;
  onClose: () => void;
  onOpenDetail?: (id: string) => void;
}

export default function FocusWorkspace({ taskId, onClose }: FocusWorkspaceProps) {
  const task = useLiveQuery(() => db.tasks.get(taskId), [taskId]);
  const project = useLiveQuery(
    () => (task ? db.projects.get(task.projectId) : undefined),
    [task?.projectId]
  );
  const subtasks = useLiveQuery(
    () =>
      db.tasks
        .where('parentId')
        .equals(taskId)
        .filter((t) => t.status !== 'archived')
        .toArray(),
    [taskId]
  );
  const focusSessions = useLiveQuery(() => db.focusSessions.toArray(), []);

  // Timer mode: 'stopwatch' (count up) or 'pomodoro' (25-min count down)
  const [timerMode, setTimerMode] = useState<'stopwatch' | 'pomodoro'>('stopwatch');
  const [now, setNow] = useState(() => Date.now());

  // Ticker
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Running session
  const activeSession = useMemo(() => {
    if (!focusSessions) return null;
    return (
      focusSessions
        .filter((s) => s.taskId === taskId && s.endedAt === null)
        .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null
    );
  }, [focusSessions, taskId]);

  const elapsedSeconds = activeSession ? sessionSeconds(activeSession, now) : 0;
  const POMODORO_TARGET_SEC = 25 * 60;
  const remainingPomodoroSec = Math.max(0, POMODORO_TARGET_SEC - elapsedSeconds);

  // Scratchpad state
  const [scratchpad, setScratchpad] = useState('');
  const [savedNoteStatus, setSavedNoteStatus] = useState('');

  // Subtask quick add
  const [newSubtask, setNewSubtask] = useState('');

  const handleAddSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubtask.trim() || !task) return;
    const clean = newSubtask.trim();
    setNewSubtask('');
    await addTask({ title: clean, projectId: task.projectId, parentId: task.id });
  };

  const handleAppendScratchpad = async () => {
    if (!scratchpad.trim() || !task) return;
    const currentNote = task.note ? `${task.note}\n\n` : '';
    const updated = `${currentNote}Focus Note (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}):\n${scratchpad.trim()}`;
    await updateTask(task.id, { note: updated });
    setScratchpad('');
    setSavedNoteStatus('Saved notes into task.');
    setTimeout(() => setSavedNoteStatus(''), 3000);
  };

  const handleStop = async () => {
    await stopFocus();
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
        void handleCompleteTask();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [task?.id]);

  if (!task) return null;

  return (
    <div className="focus-workspace-overlay" role="dialog" aria-modal="true" aria-label="Focus workspace">
      <header className="focus-workspace-head">
        <div className="focus-workspace-tag">
          <span
            className="focus-project-dot"
            style={{ background: project?.color ?? 'var(--accent, #0f766e)' }}
          />
          <span>{project?.name ?? 'Inbox'}</span>
        </div>

        <div className="focus-workspace-actions">
          <div className="focus-mode-toggle">
            <button
              type="button"
              className={`focus-mode-btn ${timerMode === 'stopwatch' ? 'active' : ''}`}
              onClick={() => setTimerMode('stopwatch')}
            >
              Stopwatch
            </button>
            <button
              type="button"
              className={`focus-mode-btn ${timerMode === 'pomodoro' ? 'active' : ''}`}
              onClick={() => setTimerMode('pomodoro')}
            >
              25m Pomodoro
            </button>
          </div>
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
          <div className="focus-clock-display num">
            {timerMode === 'stopwatch'
              ? formatClock(elapsedSeconds)
              : formatClock(remainingPomodoroSec)}
          </div>
          <p className="focus-timer-sub">
            {timerMode === 'stopwatch'
              ? `${Math.floor(elapsedSeconds / 60)} minutes elapsed`
              : remainingPomodoroSec === 0
              ? 'Pomodoro complete! Take a 5-minute break.'
              : `${Math.ceil(remainingPomodoroSec / 60)} minutes remaining`}
          </p>

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
                      {st.status === 'done' ? (
                        <CheckCircle2 size={16} />
                      ) : (
                        <Circle size={16} />
                      )}
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
                placeholder="Add next step…"
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
              Don't get sidetracked. Jot down thoughts here and save them to the task notes.
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
                Save to Task Note
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
