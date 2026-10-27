import { RRule } from 'rrule';
import type { Task, Project } from './types';
import { addDays } from './dates';
import { vtimezoneLines } from './vtimezone';

/**
 * iCalendar (RFC 5545) export for tasks that have a due date.
 *
 * Read-only and outbound: it builds a text file, nothing is sent anywhere. The file opens in
 * Google Calendar (Settings > Import), Apple Calendar, Outlook and Thunderbird. Tasks become
 * VEVENTs because Google Calendar ignores VTODO. A task with no time is an all-day event; a
 * task with a time is an event of `durationMinutes` in the device's IANA zone (TZID plus a generated
 * VTIMEZONE block, see vtimezone.ts, as RFC 5545 3.6.5 requires). If no valid zone is known the times are written floating, and importers differ on how they place those.
 *
 * A recurring task is one event with an RRULE starting at its current due date, and its
 * skipped dates become EXDATEs. Completed tasks are left out by default so a series does not
 * show a finished occurrence next to the repeating event.
 */
export interface IcsOptions {
  includeDone?: boolean;
  /** Put task notes in DESCRIPTION. Off by default: a calendar file is easily shared or synced to other apps. */
  includeNotes?: boolean;
  durationMinutes?: number;
  calendarName?: string;
  /** IANA zone for timed events (default: this device's zone). Written as TZID so the importer need not guess. */
  timeZone?: string;
}

/** The device's IANA zone, or null when the runtime does not report one. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function validZone(z: string | null | undefined): z is string {
  if (!z || !/^[A-Za-z0-9_+\-/]+$/.test(z)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

const PRODID = '-//LifeDash//Tasks 1.0//EN';

function escText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold a content line at 75 octets (RFC 5545 3.1) without splitting a UTF-8 character. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = '';
      curBytes = 0;
      limit = 74; // continuation lines start with one space
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const compactDate = (d: string) => d.replace(/-/g, '');
const compactTime = (t: string) => `${t.replace(':', '')}00`;

function utcStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

function addMinutes(date: string, time: string, minutes: number): { date: string; time: string } {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const dayShift = Math.floor(total / 1440);
  const rem = ((total % 1440) + 1440) % 1440;
  return {
    date: dayShift ? addDays(date, dayShift) : date,
    time: `${String(Math.floor(rem / 60)).padStart(2, '0')}:${String(rem % 60).padStart(2, '0')}`,
  };
}

/** The RRULE line (without DTSTART) for a stored rule, or null if it cannot be parsed. */
function rruleLine(rule: string): string | null {
  try {
    const line = RRule.fromString(rule)
      .toString()
      .split(/\r?\n/)
      .find((l) => l.startsWith('RRULE:'));
    return line ?? null;
  } catch {
    return null;
  }
}

const validDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const validTime = (s: string | null | undefined): s is string => !!s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function tasksToIcs(tasks: Task[], projects: Project[], opts: IcsOptions = {}): string {
  const duration = Math.max(1, opts.durationMinutes ?? 30);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const zone = validZone(opts.timeZone) ? opts.timeZone : validZone(deviceTimeZone()) ? deviceTimeZone() : null;
  const tz = zone ? `;TZID=${zone}` : '';
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escText(opts.calendarName ?? 'LifeDash tasks')}`,
    ...(zone ? [`X-WR-TIMEZONE:${zone}`] : []),
  ];

  const eligible = tasks
    .filter((t) => validDate(t.dueDate) && t.status !== 'archived' && (t.status === 'active' || opts.includeDone))
    .sort((a, b) => {
      const ka = `${a.dueDate} ${a.dueTime ?? ''}`;
      const kb = `${b.dueDate} ${b.dueTime ?? ''}`;
      return ka < kb ? -1 : ka > kb ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  for (const t of eligible) {
    const date = t.dueDate as string;
    const timed = validTime(t.dueTime);
    const ev: string[] = ['BEGIN:VEVENT', `UID:${t.id}@lifedash`, `DTSTAMP:${utcStamp(t.updatedAt || t.createdAt || 0)}`];
    if (timed) {
      const end = addMinutes(date, t.dueTime as string, duration);
      ev.push(`DTSTART${tz}:${compactDate(date)}T${compactTime(t.dueTime as string)}`);
      ev.push(`DTEND${tz}:${compactDate(end.date)}T${compactTime(end.time)}`);
    } else {
      ev.push(`DTSTART;VALUE=DATE:${compactDate(date)}`);
      ev.push(`DTEND;VALUE=DATE:${compactDate(addDays(date, 1))}`);
    }
    ev.push(`SUMMARY:${escText((t.status === 'done' ? '[done] ' : '') + t.title)}`);

    const project = projectName.get(t.projectId);
    const descParts = [opts.includeNotes ? t.note?.trim() : '', project ? `Project: ${project}` : ''].filter(Boolean) as string[];
    if (descParts.length) ev.push(`DESCRIPTION:${escText(descParts.join('\n\n'))}`);

    const cats = [project, ...(t.tags ?? [])].filter((c): c is string => !!c);
    if (cats.length) ev.push(`CATEGORIES:${cats.map(escText).join(',')}`);

    if (t.priority === 1) ev.push('PRIORITY:1');
    else if (t.priority === 2) ev.push('PRIORITY:5');
    else if (t.priority === 3) ev.push('PRIORITY:9');

    if (t.recurrence) {
      const rr = rruleLine(t.recurrence);
      if (rr) {
        ev.push(rr);
        for (const s of t.skippedDates ?? []) {
          if (!validDate(s)) continue;
          ev.push(timed ? `EXDATE${tz}:${compactDate(s)}T${compactTime(t.dueTime as string)}` : `EXDATE;VALUE=DATE:${compactDate(s)}`);
        }
      }
    }
    ev.push('END:VEVENT');
    lines.push(...ev);
  }
  if (zone) {
    const timed = eligible.filter((t) => validTime(t.dueTime));
    if (timed.length) {
      const years = timed.map((t) => Number((t.dueDate as string).slice(0, 4)));
      const thisYear = new Date().getFullYear();
      const from = Math.min(...years) - 1;
      // Repeating events can run past their first date: cover ten more years, capped at 40 in total.
      const to = Math.min(Math.max(Math.max(...years), thisYear) + 10, from + 40);
      const insertAt = lines.findIndex((l) => l.startsWith('BEGIN:VEVENT'));
      lines.splice(insertAt, 0, ...vtimezoneLines(zone, from, to));
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- import (parser only)

export interface IcsEventDraft {
  uid: string | null;
  title: string;
  note: string;
  dueDate: string;
  dueTime: string | null;
  /** True when the source event repeats; the rule is reported, never applied automatically. */
  repeats: boolean;
}

function unfold(text: string): string[] {
  return text.replace(/\r\n[ \t]/g, '').replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescText(s: string): string {
  return s.replace(/\\([nN])/g, '\n').replace(/\\([;,\\])/g, '$1');
}

function parseStart(params: string, value: string): { date: string; time: string | null } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4] || /VALUE=DATE(?!-)/i.test(params)) return { date, time: null };
  if (m[7]) {
    // UTC instant: show it as local wall-clock time on the importing device.
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)));
    const p = (n: number) => String(n).padStart(2, '0');
    return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
  }
  return { date, time: `${m[4]}:${m[5]}` };
}

/** Parse VEVENTs from an .ics file into drafts. Pure: it creates nothing. */
export function parseIcsEvents(text: string): IcsEventDraft[] {
  const out: IcsEventDraft[] = [];
  let cur: Record<string, { params: string; value: string }> | null = null;
  for (const raw of unfold(text)) {
    const line = raw.trimEnd();
    if (line === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur && cur.SUMMARY && cur.DTSTART) {
        const start = parseStart(cur.DTSTART.params, cur.DTSTART.value);
        if (start) {
          out.push({
            uid: cur.UID ? cur.UID.value : null,
            title: unescText(cur.SUMMARY.value).trim() || '(no title)',
            note: cur.DESCRIPTION ? unescText(cur.DESCRIPTION.value).trim() : '',
            dueDate: start.date,
            dueTime: start.time,
            repeats: !!cur.RRULE,
          });
        }
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 1) continue;
    const head = line.slice(0, idx);
    const semi = head.indexOf(';');
    const name = (semi < 0 ? head : head.slice(0, semi)).toUpperCase();
    if (!(name in cur)) cur[name] = { params: semi < 0 ? '' : head.slice(semi + 1), value: line.slice(idx + 1) };
  }
  return out;
}
