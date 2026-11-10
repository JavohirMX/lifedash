import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Play,
  Pause,
  RotateCcw,
  Square,
  Maximize2,
  X,
  Timer as TimerIcon,
  Wind,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useActiveTools, BREATHING_PHASES } from '../activeTools';
import { calculateRemaining, formatClock } from '../focus';
import {
  getActiveDocPipWindow,
  getActiveDocPipType,
  subscribeDocPip,
  closeNativePiP,
} from '../pipService';
import type { Selection } from './Sidebar';
import './pip-widget.css';

export interface FloatingPiPWidgetProps {
  currentSelection: Selection;
  onNavigate: (s: Selection) => void;
}

interface PiPCardContentProps {
  type: 'timer' | 'breathing';
  isDocumentPiP?: boolean;
  onNavigate: (s: Selection) => void;
  onClose: () => void;
}

export function PiPCardContent({
  type,
  isDocumentPiP = false,
  onNavigate,
  onClose,
}: PiPCardContentProps) {
  const { timer, elapsedSeconds, breathing, actions } = useActiveTools();

  // Attached task title if any
  const task = useLiveQuery(
    () => (timer.taskId ? db.tasks.get(timer.taskId) : undefined),
    [timer.taskId]
  );

  const handleExpand = () => {
    if (isDocumentPiP) {
      try {
        window.focus();
      } catch {
        // Ignore focus error across contexts
      }
      closeNativePiP();
    }
    if (type === 'timer') {
      actions.unpinTimerPiP();
      onNavigate({ kind: 'timer' });
    } else {
      actions.unpinBreathingPiP();
      onNavigate({ kind: 'breathing' });
    }
  };

  if (type === 'timer') {
    const remainingSec = calculateRemaining(timer.targetDurationSec, elapsedSeconds);
    const isBreak = timer.stage !== 'work';
    const clockDisplay =
      timer.timerMode === 'stopwatch'
        ? formatClock(elapsedSeconds)
        : formatClock(remainingSec);
    const statusText = timer.isPaused
      ? 'Paused'
      : isBreak
      ? 'Rest & Stretch'
      : 'Deep Work';

    const handleTogglePlay = () => {
      if (!timer.isRunning || timer.isPaused) {
        if (timer.isPaused) void actions.resumeTimer();
        else void actions.startTimer(timer.taskId, timer.targetDurationSec, timer.stage);
      } else {
        void actions.pauseTimer();
      }
    };

    const handleRestart = () => {
      actions.resetTimer(timer.targetDurationSec, timer.stage);
    };

    const handleStop = () => {
      void actions.stopTimer();
      if (isDocumentPiP) {
        closeNativePiP();
      }
    };

    return (
      <div className="pip-card-content" role="region" aria-label="Timer PiP window">
        <div className="pip-header">
          <div className="pip-tag">
            <TimerIcon size={14} style={{ color: 'var(--accent)' }} />
            <span>{task ? task.title : isBreak ? 'Break Time' : 'Focus Timer'}</span>
          </div>
          <div className="pip-header-right">
            {timer.timerMode === 'pomodoro' && (
              <span className="pip-badge">Round {timer.completedRounds + 1}</span>
            )}
            <div className="pip-header-actions">
              <button
                type="button"
                className="icon-btn"
                onClick={handleExpand}
                title="Expand to full timer page"
                aria-label="Expand to full timer page"
              >
                <Maximize2 size={13} />
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={onClose}
                title="Close PiP"
                aria-label="Close PiP"
              >
                <X size={13} />
              </button>
            </div>
          </div>
        </div>

        <div className="pip-body" onClick={handleExpand} style={{ cursor: 'pointer' }}>
          <div className={`pip-clock-text num ${isBreak ? 'break-mode' : ''}`}>
            {clockDisplay}
          </div>
          <div className="pip-subtext">{statusText}</div>
        </div>

        <div className="pip-controls-row">
          <button
            type="button"
            className="btn-primary pip-btn"
            onClick={handleTogglePlay}
            title={timer.isPaused || !timer.isRunning ? 'Resume timer' : 'Pause timer'}
            aria-label={timer.isPaused || !timer.isRunning ? 'Resume timer' : 'Pause timer'}
          >
            {timer.isPaused || !timer.isRunning ? (
              <Play size={13} fill="currentColor" />
            ) : (
              <Pause size={13} />
            )}
            <span>{timer.isPaused || !timer.isRunning ? 'Resume' : 'Pause'}</span>
          </button>

          <button
            type="button"
            className="btn-secondary pip-btn"
            onClick={handleRestart}
            title="Restart timer"
            aria-label="Restart timer"
          >
            <RotateCcw size={13} />
            <span>Restart</span>
          </button>

          <button
            type="button"
            className="btn-secondary pip-btn pip-btn-danger"
            onClick={handleStop}
            title="Stop timer"
            aria-label="Stop timer"
          >
            <Square size={11} fill="currentColor" />
            <span>Stop</span>
          </button>
        </div>
      </div>
    );
  }

  // Breathing PiP
  const currentPhase = BREATHING_PHASES[breathing.phaseIndex] ?? BREATHING_PHASES[0];

  const handleToggleBreathing = () => {
    if (breathing.isPaused) {
      actions.resumeBreathing();
    } else {
      actions.pauseBreathing();
    }
  };

  const handleStopBreathing = () => {
    actions.stopBreathing();
    if (isDocumentPiP) {
      closeNativePiP();
    }
  };

  return (
    <div className="pip-card-content" role="region" aria-label="Breathing PiP window">
      <div className="pip-header">
        <div className="pip-tag">
          <Wind size={14} style={{ color: 'var(--accent)' }} />
          <span>Box Breathing</span>
        </div>
        <div className="pip-header-right">
          {breathing.completedCycles > 0 && (
            <span className="pip-badge">{breathing.completedCycles} cycles</span>
          )}
          <div className="pip-header-actions">
            <button
              type="button"
              className="icon-btn"
              onClick={handleExpand}
              title="Expand to full breathing page"
              aria-label="Expand to full breathing page"
            >
              <Maximize2 size={13} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              title="Close PiP"
              aria-label="Close PiP"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      </div>

      <div className="pip-body" onClick={handleExpand} style={{ cursor: 'pointer' }}>
        <div className="pip-clock-text num" style={{ fontSize: '1.65rem' }}>
          {currentPhase.label}
        </div>
        <div className="pip-subtext num">
          {breathing.isPaused
            ? 'Paused'
            : `${breathing.secondsRemaining}s remaining`}
        </div>
      </div>

      <div className="pip-controls-row">
        <button
          type="button"
          className="btn-primary pip-btn"
          onClick={handleToggleBreathing}
          title={breathing.isPaused ? 'Resume breathing' : 'Pause breathing'}
          aria-label={breathing.isPaused ? 'Resume breathing' : 'Pause breathing'}
        >
          {breathing.isPaused ? (
            <Play size={13} fill="currentColor" />
          ) : (
            <Pause size={13} />
          )}
          <span>{breathing.isPaused ? 'Resume' : 'Pause'}</span>
        </button>

        <button
          type="button"
          className="btn-secondary pip-btn"
          onClick={actions.resetBreathing}
          title="Restart cycle"
          aria-label="Restart cycle"
        >
          <RotateCcw size={13} />
          <span>Restart</span>
        </button>

        <button
          type="button"
          className="btn-secondary pip-btn pip-btn-danger"
          onClick={handleStopBreathing}
          title="Finish breathing"
          aria-label="Finish breathing"
        >
          <Square size={11} fill="currentColor" />
          <span>Finish</span>
        </button>
      </div>
    </div>
  );
}

export default function FloatingPiPWidget({
  currentSelection,
  onNavigate,
}: FloatingPiPWidgetProps) {
  const { timer, breathing, actions } = useActiveTools();
  const [docPipWin, setDocPipWin] = useState<Window | null>(() => getActiveDocPipWindow());
  const [docPipType, setDocPipType] = useState<'timer' | 'breathing'>(() => getActiveDocPipType());

  useEffect(() => {
    return subscribeDocPip((win, type) => {
      setDocPipWin(win);
      setDocPipType(type);
    });
  }, []);

  // PiP should only show when explicitly pinned/requested by the user, never automatically!
  const showTimer =
    Boolean(timer.pipPinned && !timer.pipDismissed);

  const showBreathing =
    Boolean(breathing.pipPinned && !breathing.pipDismissed);

  // 1. If native Document Picture-in-Picture window is active, portal the UI into it
  if (docPipWin && !docPipWin.closed && docPipWin.document?.body) {
    return createPortal(
      <div className="pip-window-frame">
        <PiPCardContent
          type={docPipType}
          isDocumentPiP={true}
          onNavigate={onNavigate}
          onClose={() => {
            closeNativePiP();
            actions.unpinTimerPiP();
            actions.unpinBreathingPiP();
          }}
        />
      </div>,
      docPipWin.document.body
    );
  }

  // 2. Otherwise render in-app floating widget if either tool is active
  if (!showTimer && !showBreathing) {
    return null;
  }

  const activeType: 'timer' | 'breathing' = showTimer ? 'timer' : 'breathing';

  return (
    <div
      className="pip-floating-widget"
      role="region"
      aria-label="Floating picture in picture widget"
    >
      <PiPCardContent
        type={activeType}
        isDocumentPiP={false}
        onNavigate={onNavigate}
        onClose={() => {
          if (activeType === 'timer') {
            actions.dismissTimerPiP();
          } else {
            actions.dismissBreathingPiP();
          }
        }}
      />
    </div>
  );
}
