/**
 * Client for the OPTIONAL read-only Google Calendar display on the sync server
 * (server/app/gcal.py). UI-independent: nothing here renders anything or runs on its own.
 *
 * Honest limits, kept in the types and copy below so a UI cannot overpromise:
 * - primary calendar only, read-only, titles and times only;
 * - the list can be incomplete (`truncated` + `reason`);
 * - while the owner's Google project is in Testing, the link expires about weekly.
 */
import type { SyncSettings } from './sync';
import { addDays, parseLocalDate, toLocalDateStr } from './dates';
import { SAMPLE_MODE } from './dev/sampleMode';

export interface GoogleStatus {
  /** Server has the feature fully configured. */
  available: boolean;
  connected: boolean;
  connectedAt: string | null;
  /** Why it is unavailable, when the server owner asked for it (never user data). */
  problem: string | null;
}

export interface GoogleEvent {
  id: string;
  title: string;
  /** Google's value: YYYY-MM-DD for all-day, RFC 3339 with offset for timed events. */
  start: string;
  /** Exclusive end, same format as start. */
  end: string;
  allDay: boolean;
}

export type TruncationReason = 'event_cap' | 'page_cap' | 'repeated_page_token' | 'time_budget';

export interface GoogleEventsResult {
  events: GoogleEvent[];
  truncated: boolean;
  reason: TruncationReason | null;
}

export class GoogleCalendarError extends Error {
  constructor(
    public kind: 'not_connected' | 'reconnect' | 'unavailable' | 'upstream' | 'network' | 'bad_response',
    message: string,
  ) {
    super(message);
  }
}

export const GOOGLE_SCOPE_COPY = {
  summary: 'Shows your primary Google calendar (titles and times) in LifeDash. Read-only: LifeDash never changes your calendar.',
  limits: [
    'Primary calendar only. Other calendars and calendars shared with you are not shown.',
    'While the Google project is in testing mode, access expires about every 7 days and you reconnect.',
    'Not a sync. Events are fetched when you open a view and are not stored on the server.',
  ],
} as const;

const base = (s: SyncSettings) => s.url.replace(/\/$/, '');
const auth = (s: SyncSettings) => ({ Authorization: `Bearer ${s.token}` });

async function call(s: SyncSettings, path: string, init?: RequestInit): Promise<Response> {
  // Sample-data sandbox: never talk to a real server, token or Google account from here.
  if (SAMPLE_MODE) throw new GoogleCalendarError('unavailable', 'Google Calendar is turned off in the sample sandbox.');
  try {
    return await fetch(`${base(s)}${path}`, { ...init, headers: { ...auth(s), ...(init?.headers ?? {}) } });
  } catch {
    throw new GoogleCalendarError('network', 'Could not reach the sync server.');
  }
}

async function json(res: Response): Promise<Record<string, unknown>> {
  try {
    const v = await res.json();
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new GoogleCalendarError('bad_response', 'The server sent an unexpected reply.');
}

export async function googleStatus(s: SyncSettings): Promise<GoogleStatus> {
  if (SAMPLE_MODE) return { available: false, connected: false, connectedAt: null, problem: null };
  const res = await call(s, '/api/google/status');
  if (res.status === 404) return { available: false, connected: false, connectedAt: null, problem: null }; // older server
  if (!res.ok) throw new GoogleCalendarError('upstream', `Status check failed (${res.status}).`);
  const b = await json(res);
  return {
    available: b.available === true,
    connected: b.connected === true,
    connectedAt: typeof b.connected_at === 'string' ? b.connected_at : null,
    problem: typeof b.problem === 'string' ? b.problem : null,
  };
}

/** Returns the Google consent URL. The caller opens it; nothing is requested from Google here. */
export async function googleConnectUrl(s: SyncSettings): Promise<string> {
  const res = await call(s, '/api/google/connect', { method: 'POST' });
  if (res.status === 404) throw new GoogleCalendarError('unavailable', 'Google Calendar is not set up on this server.');
  if (res.status === 429) throw new GoogleCalendarError('upstream', 'Too many attempts. Try again in a few minutes.');
  if (!res.ok) throw new GoogleCalendarError('upstream', `Could not start connecting (${res.status}).`);
  const url = (await json(res)).url;
  let ok = false;
  try {
    ok = typeof url === 'string' && new URL(url).origin === 'https://accounts.google.com';
  } catch {
    ok = false;
  }
  if (!ok || typeof url !== 'string') throw new GoogleCalendarError('bad_response', 'The server returned an unexpected link.');
  return url;
}

export interface DisconnectResult {
  removed: boolean;
  /** True only when Google confirmed. When false, the user should also remove access in their Google account. */
  revoked: boolean;
}

export async function googleDisconnect(s: SyncSettings): Promise<DisconnectResult> {
  const res = await call(s, '/api/google/disconnect', { method: 'POST' });
  if (!res.ok) throw new GoogleCalendarError('upstream', `Disconnect failed (${res.status}).`);
  const b = await json(res);
  return { removed: b.removed === true, revoked: b.revoked === true };
}

const REASONS: TruncationReason[] = ['event_cap', 'page_cap', 'repeated_page_token', 'time_budget'];

/**
 * LOW LEVEL. `start`/`end` are UTC dates (YYYY-MM-DD), matching the server: it asks Google for
 * events overlapping [start 00:00Z, end 00:00Z) (Google's events.list returns events that overlap
 * the window, not only events that start in it). Window 1 to 100 days. Prefer googleEventsForLocalDays.
 */
export async function googleEvents(s: SyncSettings, start: string, end: string): Promise<GoogleEventsResult> {
  const res = await call(s, `/api/google/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
  if (res.status === 409) {
    const d = String((await json(res)).detail ?? '');
    throw new GoogleCalendarError(/reconnect/i.test(d) ? 'reconnect' : 'not_connected', d || 'Not connected.');
  }
  if (res.status === 404) throw new GoogleCalendarError('unavailable', 'Google Calendar is not set up on this server.');
  if (res.status === 502) throw new GoogleCalendarError('upstream', 'Google did not answer. Try again later.');
  if (!res.ok) throw new GoogleCalendarError('upstream', `Could not load events (${res.status}).`);
  const b = await json(res);
  const raw = Array.isArray(b.events) ? b.events : [];
  const events: GoogleEvent[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.title !== 'string' || typeof o.start !== 'string' || typeof o.end !== 'string') continue;
    events.push({ id: o.id, title: o.title, start: o.start, end: o.end, allDay: o.allDay === true });
  }
  const reason = REASONS.includes(b.reason as TruncationReason) ? (b.reason as TruncationReason) : null;
  return { events, truncated: b.truncated === true || (b.truncated === undefined && reason !== null), reason };
}

/** Max local days per request: the server window cap is 100 UTC days and the UTC range adds up to 2 days. */
export const MAX_LOCAL_DAYS = 97;

const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The UTC date range [start, end) that covers local days [from, to] (inclusive, YYYY-MM-DD, in
 * THIS device's zone). Floors the start and ceils the end to whole UTC dates, so it always covers
 * the local days and usually includes some neighbouring hours; groupByDay clips them off.
 */
export function utcRangeForLocalDays(from: string, to: string): { start: string; end: string } {
  const startMs = parseLocalDate(from).getTime(); // local midnight of `from`
  const endMs = parseLocalDate(addDays(to, 1)).getTime(); // local midnight after `to`
  const end = endMs % 86_400_000 === 0 ? utcDate(endMs) : utcDate(endMs + 86_400_000);
  return { start: utcDate(startMs), end };
}

/** Exact YYYY-MM-DD that survives a calendar round trip (rejects 2026-02-30). */
function isRealLocalDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return toLocalDateStr(parseLocalDate(d)) === d;
}

/**
 * Fetch events for local calendar days [from, to] and group them by local day. Works across
 * zones: the request is widened to whole UTC dates and the result is clipped to the local window.
 */
export async function googleEventsForLocalDays(
  s: SyncSettings,
  from: string,
  to: string,
): Promise<{ byDay: Map<string, DayItem[]>; truncated: boolean; reason: TruncationReason | null }> {
  if (!isRealLocalDate(from) || !isRealLocalDate(to)) {
    throw new GoogleCalendarError('bad_response', 'Dates must be real calendar dates (YYYY-MM-DD).');
  }
  const days = Math.round((parseLocalDate(addDays(to, 1)).getTime() - parseLocalDate(from).getTime()) / 86_400_000);
  if (!(days >= 1 && days <= MAX_LOCAL_DAYS)) {
    throw new GoogleCalendarError('bad_response', `Ask for 1 to ${MAX_LOCAL_DAYS} days at a time.`);
  }
  const { start, end } = utcRangeForLocalDays(from, to);
  const r = await googleEvents(s, start, end);
  return { byDay: groupByDay(r.events, from, to), truncated: r.truncated, reason: r.reason };
}

/** Plain-language note for an incomplete list. */
export function truncationNote(r: Pick<GoogleEventsResult, 'truncated' | 'reason'>): string | null {
  if (!r.truncated) return null;
  switch (r.reason) {
    case 'event_cap':
      return 'Showing the first 500 events. Narrow the date range to see the rest.';
    case 'time_budget':
      return 'Google was slow, so this list may be missing events. Try again.';
    default:
      return 'This list may be missing events. Try a shorter date range.';
  }
}

// ------------------------------------------------------------------ day grouping

function localDay(iso: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : toLocalDateStr(d);
}

function localTime(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export interface DayItem {
  id: string;
  title: string;
  allDay: boolean;
  /** Local HH:MM for timed events, null for all-day or continuing days. */
  time: string | null;
}

/**
 * Group events by LOCAL calendar day for the given window [from, to] (inclusive local dates).
 * All-day events use Google's exclusive end date, so a one-day event appears on one day.
 * Timed events appear on each local day they touch (an event ending exactly at midnight does not
 * spill onto the next day). Output is sorted: all-day first, then by time, then title.
 */
export function groupByDay(events: GoogleEvent[], from: string, to: string): Map<string, DayItem[]> {
  const out = new Map<string, DayItem[]>();
  const push = (day: string, item: DayItem) => {
    if (day < from || day > to) return;
    const list = out.get(day) ?? [];
    list.push(item);
    out.set(day, list);
  };
  for (const e of events) {
    const s = localDay(e.start);
    let en = localDay(e.end);
    if (!s || !en) continue;
    if (e.allDay) {
      // exclusive end; guard against zero or negative spans
      let last = addDays(en, -1);
      if (last < s) last = s;
      for (let d = s < from ? from : s, i = 0, stop = last > to ? to : last; d <= stop && i < 400; d = addDays(d, 1), i++) push(d, { id: e.id, title: e.title, allDay: true, time: null });
      continue;
    }
    // timed: an end exactly at local midnight belongs to the previous day
    const endDate = new Date(e.end);
    if (endDate.getHours() === 0 && endDate.getMinutes() === 0 && endDate.getSeconds() === 0 && en > s) en = addDays(en, -1);
    for (let d = s < from ? from : s, i = 0, stop = en > to ? to : en; d <= stop && i < 400; d = addDays(d, 1), i++) {
      push(d, { id: e.id, title: e.title, allDay: false, time: d === s ? localTime(e.start) : null });
    }
  }
  for (const list of out.values()) {
    list.sort((a, b) => (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) || (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title));
  }
  return out;
}
