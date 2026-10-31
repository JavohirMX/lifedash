import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./dev/sampleMode', () => ({ SAMPLE_MODE: true, DATABASE_NAME: 'lifedash-sample' }));

// Node test env has no localStorage; the modules only touch it inside
// functions, so a tiny in-memory stub is enough (same pattern as
// reminders.test.ts).
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  get length() { return store.size; },
} as Storage;

import { journalPromptEnabled, remindersEnabled, setJournalPromptEnabled, setRemindersEnabled } from './reminders';
import { FONT_KEY, WALLPAPER_KEY } from './appearancePrefs';

afterEach(() => { store.clear(); vi.unstubAllGlobals(); });

describe('sample sandbox isolation', () => {
  it('reminder preferences use sample-prefixed keys and leave real keys untouched', () => {
    localStorage.setItem('lifedash-reminders-enabled', '1');
    localStorage.setItem('lifedash-journal-prompt-enabled', '1');
    // Sample mode starts from its own defaults, not the real profile's prefs.
    expect(remindersEnabled()).toBe(false);
    expect(journalPromptEnabled()).toBe(false);
    setRemindersEnabled(true);
    setJournalPromptEnabled(true);
    expect(localStorage.getItem('lifedash-sample-reminders-enabled')).toBe('1');
    expect(localStorage.getItem('lifedash-sample-journal-prompt-enabled')).toBe('1');
    // The real profile's keys are read back unchanged afterwards.
    expect(localStorage.getItem('lifedash-reminders-enabled')).toBe('1');
    localStorage.removeItem('lifedash-reminders-enabled');
    expect(remindersEnabled()).toBe(true); // sample pref, not the removed real one
  });

  it('appearance font/wallpaper keys follow the same sample-mode determination', () => {
    expect(FONT_KEY).toBe('lifedash-sample-font');
    expect(WALLPAPER_KEY).toBe('lifedash-sample-wallpaper');
  });
});
