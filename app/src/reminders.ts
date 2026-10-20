import type { Task } from './types';

// In-app reminders: while Lifedash is open, tasks due today with a time fire
// a browser notification at that minute. Local-first and honest about scope:
// nothing fires while the app is closed.

const PREF_KEY = 'lifedash-reminders-enabled';
const FIRED_KEY = 'lifedash-reminders-fired';

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
    if (changed) saveFired(fired);
  };
  tick();
  const id = setInterval(tick, intervalMs);
  return () => clearInterval(id);
}
