import type { Task } from './types';

// In-app reminders: while Lifedash is open, tasks due today with a time fire
// a browser notification at that minute. Local-first and honest about scope:
// nothing fires while the app is closed.

const PREF_KEY = 'lifedash-reminders-enabled';
const FIRED_KEY = 'lifedash-reminders-fired';
const JOURNAL_PREF_KEY = 'lifedash-journal-prompt-enabled';
export const JOURNAL_PROMPT_HHMM = '21:00';

export function remindersEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === '1';
  } catch {
    return false;
  }
}

export function setRemindersEnabled(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? '1' : '0');
  } catch {
    /* private mode - pref just won't stick */
  }
}

// The evening journal nudge is a separate opt-in, default OFF, independent
// of the task-reminders pref. One notification at 21:00, only while Lifedash
// is open, when today's journal has neither note text nor a highlight.
export function journalPromptEnabled(): boolean {
  try {
    return localStorage.getItem(JOURNAL_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

export function setJournalPromptEnabled(on: boolean): void {
  try {
    localStorage.setItem(JOURNAL_PREF_KEY, on ? '1' : '0');
  } catch {
    /* private mode - pref just won't stick */
  }
}

/** True at the prompt minute when today's journal is empty and not yet fired. */
export function journalPromptDue(date: string, hhmm: string, journalEmpty: boolean, fired: Set<string>): boolean {
  return hhmm === JOURNAL_PROMPT_HHMM && journalEmpty && !fired.has(`journal:${date}`);
}

/** Active tasks due exactly at date+hhmm - the ones a tick should notify for. */
export function dueReminders(tasks: Task[], date: string, hhmm: string): Task[] {
  return tasks.filter(
    (t) => t.status === 'active' && t.parentId === null && t.dueDate === date && t.dueTime === hhmm,
  );
}

const firedKey = (t: Task) => `${t.id}:${t.dueDate}:${t.dueTime}`;

function loadFired(): Set<string> {
  try {
    const raw = localStorage.getItem(FIRED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveFired(keys: Set<string>): void {
  try {
    // Keep the tail so the list can't grow without bound.
    localStorage.setItem(FIRED_KEY, JSON.stringify([...keys].slice(-200)));
  } catch {
    /* ignore */
  }
}

/**
 * Tick every `intervalMs` (and once immediately); for each task due this
 * minute that has not fired yet, call `notify` and remember it. Returns a
 * stop function.
 */
export function startReminders(
  getTasks: () => Task[],
  notify: (task: Task) => void,
  now: () => Date = () => new Date(),
  intervalMs = 30_000,
  journal?: { isEmptyToday: (date: string) => boolean; notify: () => void },
): () => void {
  const tick = () => {
    const d = now();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const fired = loadFired();
    let changed = false;
    for (const t of dueReminders(getTasks(), date, hhmm)) {
      const key = firedKey(t);
      if (fired.has(key)) continue;
      fired.add(key);
      changed = true;
      notify(t);
    }
    if (journal && journalPromptDue(date, hhmm, journal.isEmptyToday(date), fired)) {
      fired.add(`journal:${date}`);
      changed = true;
      journal.notify();
    }
    if (changed) saveFired(fired);
  };
  tick();
  const id = setInterval(tick, intervalMs);
  return () => clearInterval(id);
}
