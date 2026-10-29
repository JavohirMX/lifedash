import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the deviceSettings Dexie table (mirrors
// automationSync.test.ts's established pattern).
const { tables } = vi.hoisted(() => {
  const tables = { deviceSettings: new Map<string, Record<string, unknown>>() };
  return { tables };
});

vi.mock('./db', () => ({
  db: {
    deviceSettings: {
      get: async (id: string) => tables.deviceSettings.get(id),
      put: async (row: { id: string }) => { tables.deviceSettings.set(row.id, row); return row.id; },
      clear: async () => tables.deviceSettings.clear(),
    },
  },
}));

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  get length() { return store.size; },
} as Storage;

const listeners = new Map<string, Set<(e: { type: string }) => void>>();
globalThis.Event = class { constructor(public type: string) {} } as unknown as typeof Event;
globalThis.window = {
  addEventListener: (t: string, f: (e: { type: string }) => void) => {
    if (!listeners.has(t)) listeners.set(t, new Set());
    listeners.get(t)!.add(f);
  },
  removeEventListener: (t: string, f: (e: { type: string }) => void) => listeners.get(t)?.delete(f),
  dispatchEvent: (e: { type: string }) => { listeners.get(e.type)?.forEach((f) => f(e)); return true; },
  matchMedia: () => ({ matches: false, addEventListener: () => {} }),
} as unknown as Window & typeof globalThis;

const styleProps = new Map<string, string>();
globalThis.document = {
  documentElement: {
    style: {
      setProperty: (k: string, v: string) => void styleProps.set(k, v),
      removeProperty: (k: string) => void styleProps.delete(k),
    },
    dataset: {} as Record<string, string>,
  },
  querySelectorAll: () => [],
  createElement: () => ({ remove: () => {} }),
  head: { appendChild: () => {} },
} as unknown as Document;

import {
  getDeviceId, getDeviceLabel, collectLocalPrefs, publishLocalSettings,
  applyRemoteSettings, DEVICE_SETTINGS_CHANGED_EVENT,
} from './deviceSettings';
import { getTheme, getStyle } from './theme';
import { getFont, getWallpaper } from './appearancePrefs';
import { remindersEnabled, journalPromptEnabled } from './reminders';

beforeEach(() => {
  store.clear();
  tables.deviceSettings.clear();
});

describe('device identity', () => {
  it('is stable and dev-prefixed', () => {
    const a = getDeviceId();
    expect(a).toMatch(/^dev-/);
    expect(getDeviceId()).toBe(a);
  });
  it('labels from the user agent', () => {
    expect(getDeviceLabel()).toMatch(/\w+ on \w+/);
  });
});

describe('collectLocalPrefs', () => {
  it('reads the six prefs from the localStorage cache', () => {
    expect(collectLocalPrefs()).toEqual({
      theme: 'system', style: 'paper', font: 'inter',
      wallpaper: { id: 'none', intensity: 20 },
      remindersEnabled: false, journalPromptEnabled: false,
    });
  });
  it('syncs only id + intensity for a custom wallpaper, never the image', () => {
    store.set('lifedash-wallpaper', JSON.stringify({ id: 'custom', intensity: 30, image: 'data:image/jpeg;base64,aGk=' }));
    const prefs = collectLocalPrefs();
    expect(prefs.wallpaper).toEqual({ id: 'custom', intensity: 30 });
    expect(JSON.stringify(prefs)).not.toContain('data:image');
  });
});

describe('publishLocalSettings', () => {
  it('mirrors prefs into the deviceSettings table keyed by device id', async () => {
    publishLocalSettings();
    await new Promise((r) => setTimeout(r, 0));
    const row = tables.deviceSettings.get(getDeviceId())!;
    expect(row).toBeTruthy();
    expect(row.font).toBe('inter');
    expect(String(row.label)).toMatch(/\w+ on \w+/);
    expect(typeof row.updatedAt).toBe('string');
  });
});

describe('applyRemoteSettings', () => {
  it('applies all six prefs and notifies the UI', () => {
    let notified = 0;
    window.addEventListener(DEVICE_SETTINGS_CHANGED_EVENT, () => notified++);
    applyRemoteSettings({
      theme: 'dark', style: 'terminal', font: 'plex',
      wallpaper: { id: 'blue', intensity: 35 },
      remindersEnabled: true, journalPromptEnabled: true,
    });
    expect(getTheme()).toBe('dark');
    expect(getStyle()).toBe('terminal');
    expect(getFont()).toBe('plex');
    expect(getWallpaper()).toEqual({ id: 'blue', intensity: 35 });
    expect(remindersEnabled()).toBe(true);
    expect(journalPromptEnabled()).toBe(true);
    expect(notified).toBe(1);
  });
  it('ignores invalid values and keeps previous prefs', () => {
    applyRemoteSettings({ theme: 'neon', style: 'shiny', font: 'comic-sans',
      wallpaper: { id: 'mars', intensity: 99 }, remindersEnabled: 'yes' });
    expect(getTheme()).toBe('system');
    expect(getStyle()).toBe('paper');
    expect(getFont()).toBe('inter');
    expect(getWallpaper()).toEqual({ id: 'none', intensity: 20 });
    expect(remindersEnabled()).toBe(false);
  });
  it('keeps the local custom image when a remote custom wallpaper arrives', () => {
    store.set('lifedash-wallpaper', JSON.stringify({ id: 'custom', intensity: 10, image: 'data:image/jpeg;base64,aGk=' }));
    applyRemoteSettings({ wallpaper: { id: 'custom', intensity: 25 } });
    expect(getWallpaper()).toEqual({ id: 'custom', intensity: 25, image: 'data:image/jpeg;base64,aGk=' });
  });
});
