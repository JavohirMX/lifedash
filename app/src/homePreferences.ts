import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import type { BacklogSortOrder } from './logic';
import { DEFAULT_HIDDEN_WIDGETS, saveWidgetVisibility } from './widgetPreferences';

export type { BacklogSortOrder };

export interface HomePreferences {
  backlogSort: BacklogSortOrder;
  showBacklog: boolean;
  backlogLimit: number;
  showProgressBar: boolean;
  showGreeting: boolean;
  showCompletedToday: boolean;
  hiddenWidgets: string[];
}

export const HOME_PREFS_KEY = 'home.preferences';

export const DEFAULT_HOME_PREFERENCES: HomePreferences = {
  backlogSort: 'priority-oldest',
  showBacklog: true,
  backlogLimit: 4,
  showProgressBar: true,
  showGreeting: true,
  showCompletedToday: true,
  hiddenWidgets: [...DEFAULT_HIDDEN_WIDGETS],
};

export const HOME_WIDGET_OPTIONS = [
  { id: 'focus', label: 'Focus', description: 'Primary Next action task or active focus timer' },
  { id: 'today', label: "Today's schedule", description: 'Timed commitments, open tasks, and ready backlog tray' },
  { id: 'habits', label: 'Habits', description: 'Daily habit check-ins and streaks' },
  { id: 'upnext', label: 'Needs attention', description: 'Overdue, due soon, and untouched backlog nudges' },
  { id: 'upcoming', label: 'Upcoming', description: 'Next few scheduled tasks coming up later this week' },
  { id: 'journal', label: 'Journal', description: 'Daily highlight and reflection note' },
  { id: 'week', label: 'This week', description: '7-day open task load chart under More insights' },
  { id: 'goals', label: 'Goals', description: 'Active goal progress list under More insights' },
] as const;

export const BACKLOG_SORT_OPTIONS: { value: BacklogSortOrder; label: string; description: string }[] = [
  {
    value: 'priority-oldest',
    label: 'Priority first, then oldest to newest',
    description: 'High priority tasks first, ordered by earliest created within each tier.',
  },
  {
    value: 'oldest',
    label: 'Oldest to newest (FIFO)',
    description: 'Surface earliest created tasks first regardless of priority.',
  },
  {
    value: 'priority-recent',
    label: 'Priority first, then recently updated',
    description: 'High priority tasks first, ordered by most recently modified.',
  },
  {
    value: 'recent',
    label: 'Recently updated first',
    description: 'Surface most recently created or edited tasks first.',
  },
];

export const BACKLOG_LIMIT_OPTIONS = [3, 4, 5, 8, 10] as const;

const VALID_SORT_ORDERS: readonly BacklogSortOrder[] = [
  'priority-oldest',
  'oldest',
  'priority-recent',
  'recent',
];

/**
 * Normalize raw persisted Home preferences alongside widget visibility into a typed HomePreferences object.
 */
export function parseHomePreferences(rawPrefs: unknown, rawWidgets: unknown): HomePreferences {
  const hiddenWidgets = Array.isArray(rawWidgets)
    ? (rawWidgets as string[])
    : [...DEFAULT_HIDDEN_WIDGETS];

  if (!rawPrefs || typeof rawPrefs !== 'object') {
    return {
      ...DEFAULT_HOME_PREFERENCES,
      hiddenWidgets,
    };
  }

  const p = rawPrefs as Record<string, unknown>;
  const backlogSort = VALID_SORT_ORDERS.includes(p.backlogSort as BacklogSortOrder)
    ? (p.backlogSort as BacklogSortOrder)
    : DEFAULT_HOME_PREFERENCES.backlogSort;

  const limitRaw =
    typeof p.backlogLimit === 'number' && Number.isFinite(p.backlogLimit)
      ? Math.round(p.backlogLimit)
      : DEFAULT_HOME_PREFERENCES.backlogLimit;
  const backlogLimit = Math.max(1, Math.min(20, limitRaw));

  return {
    backlogSort,
    showBacklog:
      typeof p.showBacklog === 'boolean' ? p.showBacklog : DEFAULT_HOME_PREFERENCES.showBacklog,
    backlogLimit,
    showProgressBar:
      typeof p.showProgressBar === 'boolean'
        ? p.showProgressBar
        : DEFAULT_HOME_PREFERENCES.showProgressBar,
    showGreeting:
      typeof p.showGreeting === 'boolean' ? p.showGreeting : DEFAULT_HOME_PREFERENCES.showGreeting,
    showCompletedToday:
      typeof p.showCompletedToday === 'boolean'
        ? p.showCompletedToday
        : DEFAULT_HOME_PREFERENCES.showCompletedToday,
    hiddenWidgets,
  };
}

let pendingWrite: Promise<unknown> = Promise.resolve();

/**
 * Update a single Home screen preference in IndexedDB, keeping sequential writes ordered.
 */
export function saveHomePreference<K extends keyof Omit<HomePreferences, 'hiddenWidgets'>>(
  key: K,
  value: HomePreferences[K],
): Promise<void> {
  const write = pendingWrite.then(async () => {
    const row = await db.syncmeta.get(HOME_PREFS_KEY);
    const current = (row?.value && typeof row.value === 'object' ? row.value : {}) as Record<
      string,
      unknown
    >;
    await db.syncmeta.put({
      key: HOME_PREFS_KEY,
      value: { ...current, [key]: value },
    });
  });
  pendingWrite = write.catch(() => {});
  return write;
}

/**
 * Restore all Home screen preferences and widget visibility to defaults.
 */
export function resetHomePreferences(): Promise<void> {
  const write = pendingWrite.then(async () => {
    await db.syncmeta.put({ key: HOME_PREFS_KEY, value: {} });
    await db.syncmeta.put({ key: 'home.widgets', value: [...DEFAULT_HIDDEN_WIDGETS] });
  });
  pendingWrite = write.catch(() => {});
  return write;
}

/**
 * Reactive hook returning current Home screen preferences from IndexedDB.
 */
export function useHomePreferences(): HomePreferences {
  const prefsRow = useLiveQuery(() => db.syncmeta.get(HOME_PREFS_KEY), []);
  const widgetsRow = useLiveQuery(() => db.syncmeta.get('home.widgets'), []);
  return parseHomePreferences(prefsRow?.value, widgetsRow?.value);
}

export { saveWidgetVisibility, DEFAULT_HIDDEN_WIDGETS };
