// Natural-language quick add: pulls due dates, times, and recurrence out of
// the typed sentence. Deliberately conservative - a word is only consumed
// when it matches a known pattern, so ordinary task titles pass through.

import { addDays, todayStr } from './dates';
import { makeRecurrence, type RecurrenceKind } from './logic';

export interface NaturalParse {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  recurrence: string | null;
  priority: number;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function nextWeekday(today: string, target: number, forceNext: boolean): string {
  const dow = new Date(`${today}T12:00:00`).getDay();
  let delta = (target - dow + 7) % 7;
  if (delta === 0 || forceNext) delta += 7; // bare weekday means the coming one; "next" means the one after
  if (delta === 7 && !forceNext) delta = 7; // today named -> a week out
  return addDays(today, delta);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function parseNatural(raw: string, now: Date = new Date()): NaturalParse {
  const today = todayStr(now);
  let dueDate: string | null = null;
  let dueTime: string | null = null;
  let recurrence: string | null = null;
  let priority = 0;

  const words = raw.trim().split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  let i = 0;

  const takeTime = (w: string): boolean => {
    const m = w.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i) ?? w.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return false;
    let h = Number(m[1]);
    const mins = m[2] !== undefined && m[1].length <= 2 && w.includes(':') ? Number(m[2]) : Number(m[2] ?? 0);
    const meridiem = m[3]?.toLowerCase();
    if (meridiem === 'pm' && h < 12) h += 12;
    if (meridiem === 'am' && h === 12) h = 0;
    if (h > 23 || mins > 59) return false;
    dueTime = `${String(h).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    return true;
  };

  while (i < words.length) {
    const w = words[i];
    const lw = w.toLowerCase();
    const next = words[i + 1]?.toLowerCase();

    // Recurrence: every day|week|month|weekday|N days
    if (lw === 'every' && next) {
      let kind: RecurrenceKind | null = null;
      let consumed = 2;
      let anchor = today;
      let n = 0;
      if (next === 'day' || next === 'morning' || next === 'evening') kind = 'daily';
      else if (next === 'week') kind = 'weekly';
      else if (next === 'month') kind = 'monthly';
      else if (next in WEEKDAYS) {
        kind = 'weekly';
        anchor = nextWeekday(today, WEEKDAYS[next], false);
      } else if (/^\d+$/.test(next) && (words[i + 2]?.toLowerCase() === 'days')) {
        kind = 'ndays';
        n = Number(next);
        consumed = 3;
      }
      if (kind) {
        const recDate: string = dueDate ?? (kind === 'daily' ? addDays(today, 1) : anchor);
        dueDate = recDate;
        recurrence = makeRecurrence(kind, recDate, n || 3);
        i += consumed;
        continue;
      }
    }

    // Dates
    if (lw === 'today') { dueDate = today; i++; continue; }
    if (lw === 'tomorrow') { dueDate = addDays(today, 1); i++; continue; }
    if (lw === 'tonight') { dueDate = today; dueTime ??= '20:00'; i++; continue; }
    if (lw === 'in' && next && /^\d+$/.test(next) && (words[i + 2]?.toLowerCase() === 'days' || words[i + 2]?.toLowerCase() === 'day')) {
      dueDate = addDays(today, Number(next)); i += 3; continue;
    }
    if (lw === 'in' && next && (next === 'a' || next === 'one') && words[i + 2]?.toLowerCase() === 'week') {
      dueDate = addDays(today, 7); i += 3; continue;
    }
    if (lw === 'in' && next && /^\d+$/.test(next) && (words[i + 2]?.toLowerCase() === 'weeks' || words[i + 2]?.toLowerCase() === 'week')) {
      dueDate = addDays(today, Number(next) * 7); i += 3; continue;
    }
    if (lw === 'eod' || (lw === 'end' && next === 'of' && words[i + 2]?.toLowerCase() === 'day')) {
      dueDate ??= today; dueTime = '17:00';
      i += lw === 'eod' ? 1 : 3; continue;
    }
    // Time-of-day words only count once a date is set, so a title like
    // "morning run" keeps its words.
    if (dueDate && (lw === 'morning' || lw === 'afternoon' || lw === 'evening' || lw === 'night')) {
      dueTime = { morning: '09:00', afternoon: '13:00', evening: '18:00', night: '21:00' }[lw]!;
      i++; continue;
    }
    if (lw === 'next' && next && next in WEEKDAYS) { dueDate = nextWeekday(today, WEEKDAYS[next], true); i += 2; continue; }
    if (lw === 'next' && next === 'week') { dueDate = addDays(today, 7); i += 2; continue; }
    if ((lw === 'on' && next && next in WEEKDAYS) || (lw in WEEKDAYS)) {
      const wd = lw === 'on' ? next! : lw;
      dueDate = nextWeekday(today, WEEKDAYS[wd], false);
      i += lw === 'on' ? 2 : 1;
      continue;
    }
    const iso = lw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) { dueDate = iso[0]; i++; continue; }
    const monDay = lw.match(/^([a-z]{3,9})$/) && next?.match(/^(\d{1,2})(?:st|nd|rd|th)?$/);
    if (monDay && next) {
      const mk = lw.slice(0, 3);
      if (mk in MONTHS) {
        const y = today.slice(0, 4);
        const cand = `${y}-${String(MONTHS[mk]).padStart(2, '0')}-${String(Number(next.match(/^\d+/)![0])).padStart(2, '0')}`;
        dueDate = cand >= today ? cand : `${Number(y) + 1}-${cand.slice(5)}`;
        i += 2; continue;
      }
    }

    // Priority: p1 (high) .. p3 (low)
    const pm = lw.match(/^p([123])$/);
    if (pm) { priority = Number(pm[1]); i++; continue; }

    // Times
    if (lw === 'at' && next && takeTime(next)) { i += 2; continue; }
    if (takeTime(w)) { i++; continue; }
    if (lw === 'noon') { dueTime = '12:00'; i++; continue; }

    kept.push(w);
    i++;
  }

  return { title: kept.join(' '), dueDate, dueTime, recurrence, priority };
}
