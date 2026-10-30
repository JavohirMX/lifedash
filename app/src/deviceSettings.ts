import { SAMPLE_MODE } from './dev/sampleMode';
import { db } from './db';
import { STYLES, getTheme, getStyle, applyTheme, applyStyle, type Theme, type StyleId } from './theme';
import { FONTS, WALLPAPERS, getFont, getWallpaper, applyFont, applyWallpaper, type FontId, type WallpaperPrefs } from './appearancePrefs';
import { remindersEnabled, setRemindersEnabled, journalPromptEnabled, setJournalPromptEnabled } from './reminders';

/** UI listens for this to re-read prefs after a sync pull applies agent changes. */
export const DEVICE_SETTINGS_CHANGED_EVENT = 'lifedash-device-settings-changed';

// Per-device settings are synced entities keyed by device id so agents can
// manage a SPECIFIC device (owner decision, Oct 29). localStorage stays the
// synchronous boot cache; the deviceSettings row is the shared record.
const ID_KEY = SAMPLE_MODE ? 'lifedash-sample-device-id' : 'lifedash-device-id';

export function getDeviceId(): string {
  let id: string | null = null;
  try { id = localStorage.getItem(ID_KEY); } catch { id = null; }
  if (!id) {
    id = `dev-${crypto.randomUUID()}`;
    try { localStorage.setItem(ID_KEY, id); } catch { /* label read-only this session */ }
  }
  return id;
}

export function getDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Unknown device';
  const ua = navigator.userAgent;
  const browser = ua.includes('Firefox') ? 'Firefox'
    : ua.includes('Edg') ? 'Edge'
    : ua.includes('Chrome') ? 'Chrome'
    : ua.includes('Safari') ? 'Safari' : 'Browser';
  const os = ua.includes('Android') ? 'Android'
    : ua.includes('iPhone') || ua.includes('iPad') ? 'iOS'
    : ua.includes('Windows') ? 'Windows'
    : ua.includes('Mac') ? 'macOS'
    : ua.includes('Linux') ? 'Linux' : 'device';
  return `${browser} on ${os}`;
}

export interface DevicePrefs {
  theme: Theme;
  style: StyleId;
  font: FontId;
  wallpaper: { id: WallpaperPrefs['id']; intensity: number };
  remindersEnabled: boolean;
  journalPromptEnabled: boolean;
}

export function collectLocalPrefs(): DevicePrefs {
  const w = getWallpaper();
  return {
    theme: getTheme(),
    style: getStyle(),
    font: getFont(),
    // Custom wallpaper IMAGES stay on the device; only id + intensity sync.
    wallpaper: { id: w.id, intensity: w.intensity },
    remindersEnabled: remindersEnabled(),
    journalPromptEnabled: journalPromptEnabled(),
  };
}

/** Mirror the device's current prefs into Dexie so sync carries them. */
export function publishLocalSettings(): void {
  void Promise.resolve(db.deviceSettings?.put({
    id: getDeviceId(),
    label: getDeviceLabel(),
    updatedAt: new Date().toISOString(),
    ...collectLocalPrefs(),
  })).catch(() => {});
}

const THEMES: Theme[] = ['light', 'dark', 'system'];

/** Apply a deviceSettings row pulled from sync (agent or another device). */
export function applyRemoteSettings(data: Record<string, unknown>): void {
  try {
    if (typeof data.theme === 'string' && (THEMES as string[]).includes(data.theme)) {
      applyTheme(data.theme as Theme);
    }
  } catch { /* keep previous */ }
  try {
    if (typeof data.style === 'string' && STYLES.some((s) => s.id === data.style)) {
      applyStyle(data.style as StyleId);
    }
  } catch { /* keep previous */ }
  try {
    if (typeof data.font === 'string' && FONTS.some((f) => f.id === data.font)) {
      applyFont(data.font as FontId);
    }
  } catch { /* keep previous */ }
  try {
    const w = data.wallpaper as { id?: unknown; intensity?: unknown } | undefined;
    if (w && typeof w.id === 'string' && [...WALLPAPERS.map((x) => x.id), 'custom'].includes(w.id as never)) {
      const local = getWallpaper();
      // A synced 'custom' keeps THIS device's image; without one it falls
      // back to no wallpaper inside applyWallpaper's parser.
      applyWallpaper({ id: w.id as WallpaperPrefs['id'], intensity: typeof w.intensity === 'number' ? w.intensity : 20,
        ...(w.id === 'custom' && local.image ? { image: local.image } : {}) });
    }
  } catch { /* keep previous */ }
  try {
    if (typeof data.remindersEnabled === 'boolean') setRemindersEnabled(data.remindersEnabled);
    if (typeof data.journalPromptEnabled === 'boolean') setJournalPromptEnabled(data.journalPromptEnabled);
  } catch { /* keep previous */ }
  window.dispatchEvent(new Event(DEVICE_SETTINGS_CHANGED_EVENT));
}

/** Publish on startup if this device has no row yet, so agents can
 * discover it without waiting for a local settings change. */
export function ensureDeviceSettingsPublished(): void {
  void (async () => {
    try {
      const id = getDeviceId();
      const existing = await db.deviceSettings?.get(id);
      if (!existing) publishLocalSettings();
    } catch { /* Dexie unavailable: localStorage cache still works */ }
  })();
}
