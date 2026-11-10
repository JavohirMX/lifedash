import { describe, expect, it, beforeEach } from 'vitest';
import { isSoundMuted, setSoundMuted, playBell, playBreathingCue } from './sound';

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  get length() { return store.size; },
} as Storage;

describe('sound', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists mute preference in localStorage', () => {
    expect(isSoundMuted()).toBe(false);
    setSoundMuted(true);
    expect(isSoundMuted()).toBe(true);
    setSoundMuted(false);
    expect(isSoundMuted()).toBe(false);
  });

  it('does not throw when playBell or playBreathingCue is called in test environment', () => {
    expect(() => playBell()).not.toThrow();
    expect(() => playBell(440, 1)).not.toThrow();
    expect(() => playBreathingCue('inhale')).not.toThrow();
    expect(() => playBreathingCue('hold')).not.toThrow();
    expect(() => playBreathingCue('exhale')).not.toThrow();
  });
});
