import type { FocusSession } from './types';
import { addDays, parseLocalDate } from './dates';

/** Seconds a session has accrued: final value once stopped, live otherwise. */
export function sessionSeconds(s: FocusSession, now: number): number {
  if (s.endedAt !== null) return s.seconds;
  return Math.max(0, Math.floor((now - s.startedAt) / 1000));
}

/** m:ss for the live clock. */
export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Compact duration for totals: "45m", "2h 5m". */
export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 60) return `${h + 1}h`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// Seconds of a session that fall inside the given local calendar day.
function overlapSeconds(s: FocusSession, day: string, now: number): number {
  const start = parseLocalDate(day).getTime();
  const end = parseLocalDate(addDays(day, 1)).getTime();
  const a = Math.max(s.startedAt, start);
  const b = Math.min(s.endedAt ?? now, end);
  return Math.max(0, Math.floor((b - a) / 1000));
}

/**
 * Totals for display: per-task all-time seconds and today's total measured as
 * actual overlap with the local day, so a session crossing midnight splits
 * instead of attributing everything to its start date.
 */
export function focusTotals(
  sessions: FocusSession[],
  today: string,
  now: number,
): { perTask: Map<string, number>; todayTotal: number } {
  const perTask = new Map<string, number>();
  let todayTotal = 0;
  for (const s of sessions) {
    perTask.set(s.taskId, (perTask.get(s.taskId) ?? 0) + sessionSeconds(s, now));
    todayTotal += overlapSeconds(s, today, now);
  }
  return { perTask, todayTotal };
}

/** The single running session, if any (latest-started wins on bad data). */
export function runningSession(sessions: FocusSession[]): FocusSession | null {
  const running = sessions.filter((s) => s.endedAt === null);
  if (running.length === 0) return null;
  return running.sort((a, b) => b.startedAt - a.startedAt)[0];
}

/**
 * Repair pass for conflicting data (a restored backup can carry a running row
 * alongside a locally running one): the latest-started running session keeps
 * running; every other running row is finalized at that start, clamped to its
 * own start so totals can never overlap (zero seconds on a tie).
 */
export function reconcileRunningSessions(sessions: FocusSession[]): FocusSession[] {
  const running = sessions.filter((s) => s.endedAt === null).sort((a, b) => b.startedAt - a.startedAt);
  if (running.length <= 1) return sessions;
  const keeper = running[0];
  const finalized = new Map<string, FocusSession>();
  for (const s of running.slice(1)) {
    const end = Math.max(keeper.startedAt, s.startedAt);
    finalized.set(s.id, { ...s, endedAt: end, seconds: Math.max(0, Math.floor((end - s.startedAt) / 1000)) });
  }
  return sessions.map((s) => finalized.get(s.id) ?? s);
}

/* ==========================================================================
   Pomodoro & Timer Helpers
   ========================================================================== */

export type PomodoroStage = 'work' | 'short-break' | 'long-break';

export interface PomodoroSettings {
  workSec: number;
  shortBreakSec: number;
  longBreakSec: number;
  roundsBeforeLongBreak: number;
}

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  workSec: 25 * 60,
  shortBreakSec: 5 * 60,
  longBreakSec: 15 * 60,
  roundsBeforeLongBreak: 4,
};

export const DEEP_POMODORO_SETTINGS: PomodoroSettings = {
  workSec: 50 * 60,
  shortBreakSec: 10 * 60,
  longBreakSec: 20 * 60,
  roundsBeforeLongBreak: 3,
};

export function calculateRemaining(targetSec: number, elapsedSec: number): number {
  return Math.max(0, targetSec - elapsedSec);
}

export function getNextStage(
  currentStage: PomodoroStage,
  completedWorkRounds: number,
  roundsBeforeLongBreak = 4,
): PomodoroStage {
  if (currentStage === 'work') {
    return completedWorkRounds > 0 && completedWorkRounds % roundsBeforeLongBreak === 0
      ? 'long-break'
      : 'short-break';
  }
  return 'work';
}

export function formatRounds(currentRound: number, totalRounds = 4): string {
  const clamped = ((currentRound - 1) % totalRounds) + 1;
  return `Round ${clamped} of ${totalRounds}`;
}
