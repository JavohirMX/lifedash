import { RRule, rrulestr } from 'rrule';
import { db } from './db';
import { addDays, parseLocalDate, todayStr } from './dates';
import type { ScheduledBlock } from './dayPlanner';
import type { SyncSettings } from './sync';

export interface WebcalFeed {
  id: string;
  name: string;
  url: string;
  color: string;
  enabled: boolean;
  lastFetched?: number;
  lastError?: string | null;
}

export interface WebcalEvent {
  id: string;
  feedId: string;
  feedName: string;
  color: string;
  title: string;
  start: string; // YYYY-MM-DD for allDay, or YYYY-MM-DDTHH:MM
  end: string;   // YYYY-MM-DD for allDay, or YYYY-MM-DDTHH:MM
  allDay: boolean;
}

export const DEFAULT_WEBCAL_PALETTE = [
  '#0284c7', // light blue
  '#7c3aed', // violet
  '#059669', // emerald
  '#d97706', // amber
  '#e11d48', // rose
  '#475569', // slate
];

/** Normalizes webcal:// or webcals:// URLs into standard http(s) URLs. */
export function normalizeWebcalUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('webcal://')) {
    return 'https://' + trimmed.slice('webcal://'.length);
  }
  if (trimmed.startsWith('webcals://')) {
    return 'https://' + trimmed.slice('webcals://'.length);
  }
  return trimmed;
}

/** Unfolds RFC 5545 lines that were wrapped with CRLF + space or tab. */
export function unfoldIcsLines(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const unfolded = normalized.replace(/\n[ \t]/g, '');
  return unfolded.split('\n');
}

function unescapeIcsText(s: string): string {
  return s
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

interface ParsedDateTime {
  dateStr: string; // YYYY-MM-DD
  timeStr: string | null; // HH:MM or null if all-day
  allDay: boolean;
  dateObj: Date;
}

function parseIcsPropDate(val: string, params: string[]): ParsedDateTime | null {
  const isDateOnly = params.some((p) => p.toUpperCase() === 'VALUE=DATE') || /^\d{8}$/.test(val.trim());
  const cleanVal = val.trim();

  if (isDateOnly && /^\d{8}$/.test(cleanVal)) {
    const y = cleanVal.slice(0, 4);
    const m = cleanVal.slice(4, 6);
    const d = cleanVal.slice(6, 8);
    const dateStr = `${y}-${m}-${d}`;
    return {
      dateStr,
      timeStr: null,
      allDay: true,
      dateObj: parseLocalDate(dateStr),
    };
  }

  // DateTime format: YYYYMMDDTHHMMSS[Z]
  const match = cleanVal.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?/);
  if (!match) return null;

  const [, y, m, d, hh, mm, , isUtc] = match;
  if (isUtc) {
    const utcDate = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm)));
    const localY = utcDate.getFullYear();
    const localM = String(utcDate.getMonth() + 1).padStart(2, '0');
    const localD = String(utcDate.getDate()).padStart(2, '0');
    const localH = String(utcDate.getHours()).padStart(2, '0');
    const localMin = String(utcDate.getMinutes()).padStart(2, '0');
    return {
      dateStr: `${localY}-${localM}-${localD}`,
      timeStr: `${localH}:${localMin}`,
      allDay: false,
      dateObj: utcDate,
    };
  }

  // Floating or local with TZID
  const dateStr = `${y}-${m}-${d}`;
  const timeStr = `${hh}:${mm}`;
  return {
    dateStr,
    timeStr,
    allDay: false,
    dateObj: new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm)),
  };
}

/** Parses raw ICS content into normalized WebcalEvent objects. */
export function parseIcs(
  icsText: string,
  feedId: string,
  feedName: string,
  color: string,
  windowStartDays = -30,
  windowEndDays = 90
): WebcalEvent[] {
  const lines = unfoldIcsLines(icsText);
  const events: WebcalEvent[] = [];

  const today = todayStr();
  const winStart = parseLocalDate(addDays(today, windowStartDays));
  const winEnd = parseLocalDate(addDays(today, windowEndDays));

  let inEvent = false;
  let uid = '';
  let summary = 'Untitled Event';
  let dtstartVal = '';
  let dtstartParams: string[] = [];
  let dtendVal = '';
  let dtendParams: string[] = [];
  let rruleStr = '';
  let exdates: string[] = [];

  const flushEvent = () => {
    if (!dtstartVal) return;
    const startParsed = parseIcsPropDate(dtstartVal, dtstartParams);
    if (!startParsed) return;

    let endParsed = dtendVal ? parseIcsPropDate(dtendVal, dtendParams) : null;
    if (!endParsed) {
      if (startParsed.allDay) {
        endParsed = {
          dateStr: addDays(startParsed.dateStr, 1),
          timeStr: null,
          allDay: true,
          dateObj: parseLocalDate(addDays(startParsed.dateStr, 1)),
        };
      } else {
        const [h, m] = (startParsed.timeStr || '00:00').split(':').map(Number);
        const endTotal = h * 60 + m + 60; // default 1 hour
        const endH = String(Math.floor(endTotal / 60) % 24).padStart(2, '0');
        const endM = String(endTotal % 60).padStart(2, '0');
        const endD = endTotal >= 1440 ? addDays(startParsed.dateStr, 1) : startParsed.dateStr;
        endParsed = {
          dateStr: endD,
          timeStr: `${endH}:${endM}`,
          allDay: false,
          dateObj: new Date(startParsed.dateObj.getTime() + 60 * 60 * 1000),
        };
      }
    }

    if (rruleStr) {
      try {
        const rule = rrulestr(rruleStr, { dtstart: startParsed.dateObj });
        const occurrences = rule.between(winStart, winEnd, true);
        const durMs = Math.max(0, endParsed.dateObj.getTime() - startParsed.dateObj.getTime());

        for (const occ of occurrences) {
          const occY = occ.getFullYear();
          const occM = String(occ.getMonth() + 1).padStart(2, '0');
          const occD = String(occ.getDate()).padStart(2, '0');
          const occDateStr = `${occY}-${occM}-${occD}`;

          if (exdates.includes(occDateStr)) continue;

          let startStr: string;
          let endStr: string;

          if (startParsed.allDay) {
            startStr = occDateStr;
            const occEnd = new Date(occ.getTime() + durMs);
            const ey = occEnd.getFullYear();
            const em = String(occEnd.getMonth() + 1).padStart(2, '0');
            const ed = String(occEnd.getDate()).padStart(2, '0');
            endStr = `${ey}-${em}-${ed}`;
          } else {
            const occH = String(occ.getHours()).padStart(2, '0');
            const occMin = String(occ.getMinutes()).padStart(2, '0');
            startStr = `${occDateStr}T${occH}:${occMin}`;

            const occEnd = new Date(occ.getTime() + durMs);
            const ey = occEnd.getFullYear();
            const em = String(occEnd.getMonth() + 1).padStart(2, '0');
            const ed = String(occEnd.getDate()).padStart(2, '0');
            const eh = String(occEnd.getHours()).padStart(2, '0');
            const emin = String(occEnd.getMinutes()).padStart(2, '0');
            endStr = `${ey}-${em}-${ed}T${eh}:${emin}`;
          }

          events.push({
            id: `${uid || 'event'}-${startStr}`,
            feedId,
            feedName,
            color,
            title: summary,
            start: startStr,
            end: endStr,
            allDay: startParsed.allDay,
          });
        }
        return;
      } catch {
        // Fall back to single occurrence below
      }
    }

    // Single occurrence
    const startStr = startParsed.allDay ? startParsed.dateStr : `${startParsed.dateStr}T${startParsed.timeStr}`;
    const endStr = endParsed.allDay ? endParsed.dateStr : `${endParsed.dateStr}T${endParsed.timeStr}`;

    events.push({
      id: uid || `ev-${Math.random().toString(36).slice(2, 9)}`,
      feedId,
      feedName,
      color,
      title: summary,
      start: startStr,
      end: endStr,
      allDay: startParsed.allDay,
    });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true;
      uid = '';
      summary = 'Untitled Event';
      dtstartVal = '';
      dtstartParams = [];
      dtendVal = '';
      dtendParams = [];
      rruleStr = '';
      exdates = [];
      continue;
    }

    if (trimmed === 'END:VEVENT') {
      if (inEvent) flushEvent();
      inEvent = false;
      continue;
    }

    if (!inEvent) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const propHead = trimmed.slice(0, colonIdx);
    const propVal = trimmed.slice(colonIdx + 1);
    const propParts = propHead.split(';');
    const propName = propParts[0].toUpperCase();
    const propParams = propParts.slice(1);

    if (propName === 'UID') uid = propVal.trim();
    else if (propName === 'SUMMARY') summary = unescapeIcsText(propVal.trim());
    else if (propName === 'DTSTART') {
      dtstartVal = propVal.trim();
      dtstartParams = propParams;
    } else if (propName === 'DTEND') {
      dtendVal = propVal.trim();
      dtendParams = propParams;
    } else if (propName === 'RRULE') {
      rruleStr = propVal.trim();
    } else if (propName === 'EXDATE') {
      const parsed = parseIcsPropDate(propVal.trim(), propParams);
      if (parsed) exdates.push(parsed.dateStr);
    }
  }

  return events;
}

/** Fetches a single feed with fallback through the sync server proxy if configured. */
export async function fetchWebcalFeed(
  feed: WebcalFeed,
  syncSettings?: SyncSettings | null
): Promise<WebcalEvent[]> {
  const normUrl = normalizeWebcalUrl(feed.url);

  // If sync server is configured, try server-side proxy first to bypass browser CORS
  if (syncSettings?.url && syncSettings?.token) {
    try {
      const proxyUrl = `${syncSettings.url.replace(/\/$/, '')}/api/webcal/proxy?url=${encodeURIComponent(normUrl)}`;
      const res = await fetch(proxyUrl, {
        headers: { Authorization: `Bearer ${syncSettings.token}` },
      });
      if (res.ok) {
        const text = await res.text();
        return parseIcs(text, feed.id, feed.name, feed.color);
      }
    } catch {
      // Proxy failed or network error; fall back to direct fetch
    }
  }

  // Direct fetch fallback
  const res = await fetch(normUrl);
  if (!res.ok) {
    throw new Error(`Calendar server returned HTTP ${res.status}`);
  }
  const text = await res.text();
  return parseIcs(text, feed.id, feed.name, feed.color);
}

const FEEDS_STORAGE_KEY = 'webcal.feeds';
const CACHE_STORAGE_KEY = 'webcal.eventsCache';

export async function loadWebcalFeeds(): Promise<WebcalFeed[]> {
  try {
    const row = await db.syncmeta.get(FEEDS_STORAGE_KEY);
    return (row?.value as WebcalFeed[] | undefined) ?? [];
  } catch {
    return [];
  }
}

export async function saveWebcalFeeds(feeds: WebcalFeed[]): Promise<void> {
  await db.syncmeta.put({ key: FEEDS_STORAGE_KEY, value: feeds });
}

export async function loadWebcalEventsCache(): Promise<WebcalEvent[]> {
  try {
    const row = await db.syncmeta.get(CACHE_STORAGE_KEY);
    return (row?.value as WebcalEvent[] | undefined) ?? [];
  } catch {
    return [];
  }
}

export async function saveWebcalEventsCache(events: WebcalEvent[]): Promise<void> {
  await db.syncmeta.put({ key: CACHE_STORAGE_KEY, value: events });
}

/** Refreshes all enabled feeds and updates the local cache. */
export async function refreshAllWebcalFeeds(
  feeds: WebcalFeed[],
  syncSettings?: SyncSettings | null
): Promise<{ events: WebcalEvent[]; updatedFeeds: WebcalFeed[]; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const allEvents: WebcalEvent[] = [];
  const updatedFeeds: WebcalFeed[] = [];

  for (const feed of feeds) {
    if (!feed.enabled) {
      updatedFeeds.push(feed);
      continue;
    }
    try {
      const events = await fetchWebcalFeed(feed, syncSettings);
      allEvents.push(...events);
      updatedFeeds.push({
        ...feed,
        lastFetched: Date.now(),
        lastError: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch calendar';
      errors[feed.id] = msg;
      updatedFeeds.push({
        ...feed,
        lastFetched: Date.now(),
        lastError: msg,
      });
    }
  }

  await saveWebcalFeeds(updatedFeeds);
  await saveWebcalEventsCache(allEvents);
  return { events: allEvents, updatedFeeds, errors };
}

/** Converts Webcal events into ScheduledBlocks for rendering on the Planner timeline. */
export function webcalEventsToDayBlocks(events: WebcalEvent[], dateStr: string): ScheduledBlock[] {
  const blocks: ScheduledBlock[] = [];

  for (const ev of events) {
    if (ev.allDay) continue; // All-day events rendered in banner/header
    if (!ev.start.startsWith(dateStr)) continue;

    const startTimePart = ev.start.includes('T') ? ev.start.split('T')[1] : null;
    const endTimePart = ev.end.includes('T') ? ev.end.split('T')[1] : null;
    if (!startTimePart) continue;

    const [sh, sm] = startTimePart.split(':').map(Number);
    const startMin = sh * 60 + (sm || 0);

    let endMin = startMin + 60;
    if (endTimePart) {
      const [eh, em] = endTimePart.split(':').map(Number);
      const computed = eh * 60 + (em || 0);
      if (computed > startMin) endMin = computed;
    }

    const dur = Math.max(15, Math.min(1440 - startMin, endMin - startMin));

    blocks.push({
      id: `webcal-${ev.id}`,
      title: `${ev.title} (${ev.feedName})`,
      color: ev.color,
      start: startMin,
      dur,
      done: false,
    });
  }

  return blocks;
}
