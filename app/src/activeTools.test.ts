import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  getTimerState,
  getBreathingState,
  startTimer,
  pauseTimer,
  resumeTimer,
  resetTimer,
  stopTimer,
  setTimerMode,
  startBreathing,
  pauseBreathing,
  resumeBreathing,
  resetBreathing,
  stopBreathing,
  pinTimerPiP,
  unpinTimerPiP,
  pinBreathingPiP,
  unpinBreathingPiP,
} from './activeTools';

describe('activeTools store', () => {
  beforeEach(async () => {
    await stopTimer();
    stopBreathing();
    resetTimer(25 * 60, 'work');
    resetBreathing();
  });

  it('initializes timer in idle state without auto-starting', () => {
    const state = getTimerState();
    expect(state.isRunning).toBe(false);
    expect(state.isPaused).toBe(false);
    expect(state.accumulatedSec).toBe(0);
    expect(state.targetDurationSec).toBe(25 * 60);
  });

  it('starts, pauses, resumes and resets timer properly', async () => {
    await startTimer(null, 1500, 'work');
    let state = getTimerState();
    expect(state.isRunning).toBe(true);
    expect(state.isPaused).toBe(false);

    await pauseTimer();
    state = getTimerState();
    expect(state.isRunning).toBe(true);
    expect(state.isPaused).toBe(true);

    await resumeTimer();
    state = getTimerState();
    expect(state.isRunning).toBe(true);
    expect(state.isPaused).toBe(false);

    resetTimer(1500, 'work');
    state = getTimerState();
    expect(state.isRunning).toBe(false);
    expect(state.accumulatedSec).toBe(0);
  });

  it('initializes breathing in idle state without auto-starting', () => {
    const state = getBreathingState();
    expect(state.isActive).toBe(false);
    expect(state.isPaused).toBe(false);
    expect(state.phaseIndex).toBe(0);
  });

  it('starts, pauses, resumes and stops breathing', () => {
    startBreathing();
    let state = getBreathingState();
    expect(state.isActive).toBe(true);
    expect(state.isPaused).toBe(false);

    pauseBreathing();
    state = getBreathingState();
    expect(state.isActive).toBe(true);
    expect(state.isPaused).toBe(true);

    resumeBreathing();
    state = getBreathingState();
    expect(state.isActive).toBe(true);
    expect(state.isPaused).toBe(false);

    stopBreathing();
    state = getBreathingState();
    expect(state.isActive).toBe(false);
  });

  it('pins and unpins PiP widgets correctly', () => {
    pinTimerPiP();
    expect(getTimerState().pipPinned).toBe(true);
    expect(getTimerState().pipDismissed).toBe(false);

    unpinTimerPiP();
    expect(getTimerState().pipPinned).toBe(false);

    pinBreathingPiP();
    expect(getBreathingState().pipPinned).toBe(true);
    expect(getBreathingState().pipDismissed).toBe(false);

    unpinBreathingPiP();
    expect(getBreathingState().pipPinned).toBe(false);
  });
});
