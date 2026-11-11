import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HOME_PREFERENCES,
  DEFAULT_HIDDEN_WIDGETS,
  parseHomePreferences,
} from './homePreferences';

describe('homePreferences', () => {
  it('returns default preferences when persisted values are missing or invalid', () => {
    expect(parseHomePreferences(undefined, undefined)).toEqual(DEFAULT_HOME_PREFERENCES);
    expect(parseHomePreferences(null, null)).toEqual(DEFAULT_HOME_PREFERENCES);
    expect(parseHomePreferences('invalid', 123)).toEqual(DEFAULT_HOME_PREFERENCES);
  });

  it('defaults backlogSort to priority-oldest', () => {
    const prefs = parseHomePreferences(undefined, undefined);
    expect(prefs.backlogSort).toBe('priority-oldest');
    expect(prefs.showBacklog).toBe(true);
    expect(prefs.backlogLimit).toBe(4);
    expect(prefs.showProgressBar).toBe(true);
    expect(prefs.showGreeting).toBe(true);
    expect(prefs.showCompletedToday).toBe(true);
    expect(prefs.hiddenWidgets).toEqual([...DEFAULT_HIDDEN_WIDGETS]);
  });

  it('parses valid custom preferences and clamps backlogLimit', () => {
    const prefs = parseHomePreferences(
      {
        backlogSort: 'oldest',
        showBacklog: false,
        backlogLimit: 8,
        showProgressBar: false,
        showGreeting: false,
        showCompletedToday: false,
      },
      ['habits', 'journal'],
    );

    expect(prefs).toEqual({
      backlogSort: 'oldest',
      showBacklog: false,
      backlogLimit: 8,
      showProgressBar: false,
      showGreeting: false,
      showCompletedToday: false,
      hiddenWidgets: ['habits', 'journal'],
    });
  });

  it('falls back gracefully on invalid sort modes or out-of-range limits', () => {
    const prefs = parseHomePreferences(
      {
        backlogSort: 'unknown-mode',
        backlogLimit: 999,
      },
      undefined,
    );
    expect(prefs.backlogSort).toBe('priority-oldest');
    expect(prefs.backlogLimit).toBe(20);

    const lower = parseHomePreferences({ backlogLimit: -5 }, undefined);
    expect(lower.backlogLimit).toBe(1);
  });
});
