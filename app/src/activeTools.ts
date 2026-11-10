import { useState, useEffect } from 'react';
import { playBell, playBreathingCue } from './sound';
import { calculateRemaining, getNextStage, type PomodoroStage } from './focus';
import { startFocus, stopFocus } from './repo';

export const ACTIVE_TOOLS_CHANGED_EVENT = 'lifedash-active-tools-changed';

export interface TimerState {
  isRunning: boolean;
  isPaused: boolean;
  timerMode: 'pomodoro' | 'stopwatch';
  stage: PomodoroStage;
  targetDurationSec: number;
  accumulatedSec: number;
  sessionStartedAt: number | null;
  taskId: string | null;
  completedRounds: number;
  pipDismissed: boolean;
  pipPinned: boolean;
}

export interface BreathingState {
  isActive: boolean;
  isPaused: boolean;
  phaseIndex: number; // 0 = Inhale, 1 = Hold, 2 = Exhale, 3 = Hold
  secondsRemaining: number;
  completedCycles: number;
  pipDismissed: boolean;
  pipPinned: boolean;
}

export const BREATHING_PHASES = [
  { label: 'Breathe In', duration: 4, soundType: 'inhale' as const },
  { label: 'Hold', duration: 4, soundType: 'hold' as const },
  { label: 'Breathe Out', duration: 4, soundType: 'exhale' as const },
  { label: 'Hold', duration: 4, soundType: 'hold' as const },
];

// Singleton store in memory
let timerState: TimerState = {
  isRunning: false,
  isPaused: false,
  timerMode: 'pomodoro',
  stage: 'work',
  targetDurationSec: 25 * 60,
  accumulatedSec: 0,
  sessionStartedAt: null,
  taskId: null,
  completedRounds: 0,
  pipDismissed: false,
  pipPinned: false,
};

let breathingState: BreathingState = {
  isActive: false,
  isPaused: false,
  phaseIndex: 0,
  secondsRemaining: 4,
  completedCycles: 0,
  pipDismissed: false,
  pipPinned: false,
};

let hasRungForCurrentCycle = false;
let globalTickerInitialized = false;

function notify() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ACTIVE_TOOLS_CHANGED_EVENT));
  }
}

function initGlobalTicker() {
  if (globalTickerInitialized || typeof window === 'undefined') return;
  globalTickerInitialized = true;

  setInterval(() => {
    let changed = false;

    // Timer tick logic
    if (timerState.isRunning && !timerState.isPaused) {
      changed = true;
      const elapsed = getElapsedTimerSeconds();
      if (timerState.timerMode === 'pomodoro' && elapsed >= timerState.targetDurationSec && !hasRungForCurrentCycle) {
        hasRungForCurrentCycle = true;
        playBell();
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const title = timerState.stage === 'work' ? 'Pomodoro Complete!' : 'Break Finished!';
          const body =
            timerState.stage === 'work'
              ? 'Great focus block! Time to take a restful break.'
              : 'Break is over. Ready to begin your next focus round?';
          try {
            new Notification(title, { body });
          } catch {
            // ignore
          }
        }
      }
    }

    // Breathing tick logic
    if (breathingState.isActive && !breathingState.isPaused) {
      changed = true;
      if (breathingState.secondsRemaining <= 1) {
        const nextPhaseIndex = (breathingState.phaseIndex + 1) % BREATHING_PHASES.length;
        const nextCycles = nextPhaseIndex === 0 ? breathingState.completedCycles + 1 : breathingState.completedCycles;
        breathingState = {
          ...breathingState,
          phaseIndex: nextPhaseIndex,
          completedCycles: nextCycles,
          secondsRemaining: BREATHING_PHASES[nextPhaseIndex].duration,
        };
        playBreathingCue(BREATHING_PHASES[nextPhaseIndex].soundType);
      } else {
        breathingState = {
          ...breathingState,
          secondsRemaining: breathingState.secondsRemaining - 1,
        };
      }
    }

    if (changed) {
      notify();
    }
  }, 1000);
}

export function getElapsedTimerSeconds(): number {
  if (!timerState.isRunning) return timerState.accumulatedSec;
  if (timerState.isPaused || timerState.sessionStartedAt === null) return timerState.accumulatedSec;
  return timerState.accumulatedSec + Math.max(0, Math.floor((Date.now() - timerState.sessionStartedAt) / 1000));
}

export function getTimerState(): TimerState {
  return { ...timerState };
}

export function getBreathingState(): BreathingState {
  return { ...breathingState };
}

/* ==========================================================================
   Timer Actions
   ========================================================================== */

export async function startTimer(taskId?: string | null, targetSec?: number, stage?: PomodoroStage): Promise<void> {
  initGlobalTicker();
  const now = Date.now();
  hasRungForCurrentCycle = false;

  const nextTaskId = taskId !== undefined ? taskId : timerState.taskId;
  const nextTarget = targetSec !== undefined ? targetSec : timerState.targetDurationSec;
  const nextStage = stage !== undefined ? stage : timerState.stage;

  timerState = {
    ...timerState,
    isRunning: true,
    isPaused: false,
    taskId: nextTaskId,
    targetDurationSec: nextTarget,
    stage: nextStage,
    sessionStartedAt: now,
    pipDismissed: false,
    pipPinned: false,
  };

  if (nextTaskId) {
    try {
      await startFocus(nextTaskId);
    } catch {
      // ignore
    }
  }

  notify();
}

export async function pauseTimer(): Promise<void> {
  if (!timerState.isRunning || timerState.isPaused) return;
  const currentElapsed = getElapsedTimerSeconds();

  timerState = {
    ...timerState,
    isPaused: true,
    accumulatedSec: currentElapsed,
    sessionStartedAt: null,
  };

  if (timerState.taskId) {
    try {
      await stopFocus();
    } catch {
      // ignore
    }
  }

  notify();
}

export async function resumeTimer(): Promise<void> {
  if (!timerState.isRunning || !timerState.isPaused) return;
  const now = Date.now();

  timerState = {
    ...timerState,
    isPaused: false,
    sessionStartedAt: now,
  };

  if (timerState.taskId) {
    try {
      await startFocus(timerState.taskId);
    } catch {
      // ignore
    }
  }

  notify();
}

export function resetTimer(targetSec?: number, stage?: PomodoroStage): void {
  hasRungForCurrentCycle = false;
  const nextTarget = targetSec !== undefined ? targetSec : timerState.targetDurationSec;
  const nextStage = stage !== undefined ? stage : timerState.stage;

  timerState = {
    ...timerState,
    isRunning: false,
    isPaused: false,
    accumulatedSec: 0,
    sessionStartedAt: null,
    targetDurationSec: nextTarget,
    stage: nextStage,
    pipPinned: false,
  };

  notify();
}

export async function stopTimer(): Promise<void> {
  const hadTask = timerState.taskId;
  hasRungForCurrentCycle = false;

  timerState = {
    ...timerState,
    isRunning: false,
    isPaused: false,
    accumulatedSec: 0,
    sessionStartedAt: null,
    pipDismissed: true,
    pipPinned: false,
  };

  if (hadTask) {
    try {
      await stopFocus();
    } catch {
      // ignore
    }
  }

  notify();
}

export function setTimerMode(mode: 'pomodoro' | 'stopwatch'): void {
  hasRungForCurrentCycle = false;
  timerState = {
    ...timerState,
    timerMode: mode,
    accumulatedSec: 0,
    sessionStartedAt: timerState.isRunning ? Date.now() : null,
  };
  notify();
}

export function setTimerTask(taskId: string | null): void {
  timerState = {
    ...timerState,
    taskId,
  };
  notify();
}

export function nextPomodoroStage(): void {
  if (timerState.stage === 'work') {
    const nextRounds = timerState.completedRounds + 1;
    const next = getNextStage('work', nextRounds, 4);
    const breakSec = next === 'long-break' ? 15 * 60 : 5 * 60;
    timerState = {
      ...timerState,
      completedRounds: nextRounds,
      stage: next,
      targetDurationSec: breakSec,
      accumulatedSec: 0,
      sessionStartedAt: timerState.isRunning ? Date.now() : null,
    };
  } else {
    timerState = {
      ...timerState,
      stage: 'work',
      targetDurationSec: 25 * 60,
      accumulatedSec: 0,
      sessionStartedAt: timerState.isRunning ? Date.now() : null,
    };
  }
  hasRungForCurrentCycle = false;
  notify();
}

export function dismissTimerPiP(): void {
  timerState = { ...timerState, pipDismissed: true, pipPinned: false };
  notify();
}

export function showTimerPiP(): void {
  timerState = { ...timerState, pipDismissed: false };
  notify();
}

export function pinTimerPiP(): void {
  timerState = { ...timerState, pipPinned: true, pipDismissed: false };
  notify();
}

export function unpinTimerPiP(): void {
  timerState = { ...timerState, pipPinned: false, pipDismissed: true };
  notify();
}

/* ==========================================================================
   Breathing Actions
   ========================================================================== */

export function startBreathing(): void {
  initGlobalTicker();
  breathingState = {
    ...breathingState,
    isActive: true,
    isPaused: false,
    phaseIndex: 0,
    secondsRemaining: 4,
    pipDismissed: false,
    pipPinned: false,
  };
  playBreathingCue('inhale');
  notify();
}

export function pauseBreathing(): void {
  if (!breathingState.isActive || breathingState.isPaused) return;
  breathingState = {
    ...breathingState,
    isPaused: true,
  };
  notify();
}

export function resumeBreathing(): void {
  if (!breathingState.isActive || !breathingState.isPaused) return;
  breathingState = {
    ...breathingState,
    isPaused: false,
  };
  notify();
}

export function resetBreathing(): void {
  breathingState = {
    ...breathingState,
    isActive: false,
    isPaused: false,
    phaseIndex: 0,
    secondsRemaining: 4,
    completedCycles: 0,
    pipPinned: false,
  };
  notify();
}

export function stopBreathing(): void {
  breathingState = {
    ...breathingState,
    isActive: false,
    isPaused: false,
    phaseIndex: 0,
    secondsRemaining: 4,
    pipDismissed: true,
    pipPinned: false,
  };
  notify();
}

export function dismissBreathingPiP(): void {
  breathingState = { ...breathingState, pipDismissed: true, pipPinned: false };
  notify();
}

export function showBreathingPiP(): void {
  breathingState = { ...breathingState, pipDismissed: false };
  notify();
}

export function pinBreathingPiP(): void {
  breathingState = { ...breathingState, pipPinned: true, pipDismissed: false };
  notify();
}

export function unpinBreathingPiP(): void {
  breathingState = { ...breathingState, pipPinned: false, pipDismissed: true };
  notify();
}

/* ==========================================================================
   React Hook for Active Tools
   ========================================================================== */

export function useActiveTools() {
  const [tState, setTState] = useState<TimerState>(getTimerState);
  const [bState, setBState] = useState<BreathingState>(getBreathingState);
  const [elapsed, setElapsed] = useState<number>(getElapsedTimerSeconds);

  useEffect(() => {
    const onToolChanged = () => {
      setTState(getTimerState());
      setBState(getBreathingState());
      setElapsed(getElapsedTimerSeconds());
    };

    if (typeof window !== 'undefined') {
      window.addEventListener(ACTIVE_TOOLS_CHANGED_EVENT, onToolChanged);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener(ACTIVE_TOOLS_CHANGED_EVENT, onToolChanged);
      }
    };
  }, []);

  return {
    timer: tState,
    elapsedSeconds: elapsed,
    breathing: bState,
    actions: {
      startTimer,
      pauseTimer,
      resumeTimer,
      resetTimer,
      stopTimer,
      setTimerMode,
      setTimerTask,
      nextPomodoroStage,
      dismissTimerPiP,
      showTimerPiP,
      pinTimerPiP,
      unpinTimerPiP,
      startBreathing,
      pauseBreathing,
      resumeBreathing,
      resetBreathing,
      stopBreathing,
      dismissBreathingPiP,
      showBreathingPiP,
      pinBreathingPiP,
      unpinBreathingPiP,
    },
  };
}
