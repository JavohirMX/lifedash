// Natural-language quick add: pulls due dates, times, and recurrence out of
// the typed sentence. Deliberately conservative - a word is only consumed
// when it matches a known pattern, so ordinary task titles pass through.

import { addDays, todayStr } from './dates';
import { makeRecurrence, type RecurrenceKind } from './logic';
import { validDate } from './planning';

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

function thisWeekday(today: string, target: number): string {
  const dow = new Date(`${today}T12:00:00`).getDay();
  let delta = target - dow;
  if (delta < 0) {
    delta += 7;
  }
  return addDays(today, delta);
}

function getWeekend(today: string, forceNext: boolean): string {
  const dow = new Date(`${today}T12:00:00`).getDay();
  let delta = (6 - dow + 7) % 7; // Saturday
  if (forceNext) {
    delta = delta === 0 ? 7 : delta + 7;
  }
  return addDays(today, delta);
}

function getEndOfMonth(today: string): string {
  const [y, m] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
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
    const m =
      w.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*([ap]m|[ap])$/i) ??
      w.match(/^(\d{1,2})[:.](\d{2})$/);
    if (!m) return false;
    let h = Number(m[1]);
    const mins = m[2] !== undefined && m[1].length <= 2 ? Number(m[2]) : 0;
    const rawMeridiem = m[3]?.toLowerCase();
    const isPm = rawMeridiem === 'pm' || rawMeridiem === 'p';
    const isAm = rawMeridiem === 'am' || rawMeridiem === 'a';
    if (isPm && h < 12) h += 12;
    if (isAm && h === 12) h = 0;
    if (h > 23 || mins > 59) return false;
    dueTime = `${String(h).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    return true;
  };

  while (i < words.length) {
    const w = words[i];
    const lw = w.toLowerCase();
    const next = words[i + 1]?.toLowerCase();
    const third = words[i + 2]?.toLowerCase();
    const fourth = words[i + 3]?.toLowerCase();

    // Clean prepositions (by, due, before, on) when immediately preceding a valid date/time phrase
    if (lw === 'by' || lw === 'due' || lw === 'before' || lw === 'on') {
      // by the weekend / on the weekend / due on the weekend
      if ((next === 'the' || next === 'this') && third === 'weekend') {
        dueDate = getWeekend(today, false);
        i += 3;
        continue;
      }
      if (next === 'next' && third === 'weekend') {
        dueDate = getWeekend(today, true);
        i += 3;
        continue;
      }
      if (next === 'weekend') {
        dueDate = getWeekend(today, false);
        i += 2;
        continue;
      }
      // by next <weekday> / on next <weekday> / due next <weekday>
      if (next === 'next' && third && third in WEEKDAYS) {
        dueDate = nextWeekday(today, WEEKDAYS[third], true);
        i += 3;
        continue;
      }
      // by this <weekday> / on this <weekday>
      if ((next === 'this' || next === 'coming') && third && third in WEEKDAYS) {
        dueDate = thisWeekday(today, WEEKDAYS[third]);
        i += 3;
        continue;
      }
      // by <weekday> / on <weekday> / due <weekday>
      if (next && next in WEEKDAYS) {
        dueDate = nextWeekday(today, WEEKDAYS[next], false);
        i += 2;
        continue;
      }
      // by tomorrow / due tomorrow
      if (next === 'tomorrow') {
        dueDate = addDays(today, 1);
        i += 2;
        continue;
      }
      // by today / due today
      if (next === 'today') {
        dueDate = today;
        i += 2;
        continue;
      }
      // by tonight / due tonight
      if (next === 'tonight') {
        dueDate = today;
        dueTime ??= '20:00';
        i += 2;
        continue;
      }
      // by eod / due eod / by end of day
      if (next === 'eod' || (next === 'end' && third === 'of' && fourth === 'day')) {
        dueDate ??= today;
        dueTime = '17:00';
        i += next === 'eod' ? 2 : 4;
        continue;
      }
      // by eow / by end of week
      if (next === 'eow' || (next === 'end' && third === 'of' && fourth === 'week')) {
        dueDate = thisWeekday(today, 5);
        dueTime ??= '17:00';
        i += next === 'eow' ? 2 : 4;
        continue;
      }
      // by eom / by end of month
      if (next === 'eom' || (next === 'end' && third === 'of' && fourth === 'month')) {
        dueDate = getEndOfMonth(today);
        dueTime ??= '17:00';
        i += next === 'eom' ? 2 : 4;
        continue;
      }
      // by noon / before noon / by midday
      if (next === 'noon' || next === 'midday') {
        dueTime = '12:00';
        i += 2;
        continue;
      }
      // by midnight / before midnight
      if (next === 'midnight') {
        dueTime = '00:00';
        i += 2;
        continue;
      }
      // by 5pm / before 3:30pm
      if (next && takeTime(next)) {
        i += 2;
        continue;
      }
    }

    // Recurrence: every ...
    if (lw === 'every' && next) {
      let kind: RecurrenceKind | null = null;
      let consumed = 2;
      let anchor = today;
      let n = 0;
      if (next === 'day' || next === 'morning' || next === 'evening') {
        kind = 'daily';
      } else if (next === 'week') {
        kind = 'weekly';
      } else if (next === 'month') {
        kind = 'monthly';
      } else if (next === 'weekend') {
        kind = 'weekly';
        anchor = getWeekend(today, false);
      } else if (next === 'other' && third === 'day') {
        kind = 'ndays';
        n = 2;
        consumed = 3;
      } else if (next === 'other' && third === 'week') {
        kind = 'ndays';
        n = 14;
        consumed = 3;
      } else if (next in WEEKDAYS) {
        kind = 'weekly';
        anchor = nextWeekday(today, WEEKDAYS[next], false);
      } else if (/^\d+$/.test(next) && third === 'days') {
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

    // Weekends: this weekend, next weekend, the weekend, weekend
    if ((lw === 'this' || lw === 'the') && next === 'weekend') {
      dueDate = getWeekend(today, false);
      i += 2;
      continue;
    }
    if (lw === 'next' && next === 'weekend') {
      dueDate = getWeekend(today, true);
      i += 2;
      continue;
    }
    if (lw === 'weekend') {
      dueDate = getWeekend(today, false);
      i++;
      continue;
    }

    // Day after tomorrow: day after tomorrow / the day after tomorrow
    if (lw === 'the' && next === 'day' && third === 'after' && fourth === 'tomorrow') {
      dueDate = addDays(today, 2);
      i += 4;
      continue;
    }
    if (lw === 'day' && next === 'after' && third === 'tomorrow') {
      dueDate = addDays(today, 2);
      i += 3;
      continue;
    }

    // Dates: today, tomorrow, tonight
    if (lw === 'today') {
      dueDate = today;
      i++;
      continue;
    }
    if (lw === 'tomorrow') {
      dueDate = addDays(today, 1);
      // tomorrow morning/afternoon/evening/night
      if (next && (next === 'morning' || next === 'afternoon' || next === 'evening' || next === 'night')) {
        dueTime = { morning: '09:00', afternoon: '13:00', evening: '18:00', night: '21:00' }[next]!;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (lw === 'tonight') {
      dueDate = today;
      dueTime ??= '20:00';
      i++;
      continue;
    }

    // Relative dates: in N days/weeks/hours/mins
    if (lw === 'in' && next && /^\d+$/.test(next)) {
      const unit = third;
      if (unit === 'day' || unit === 'days') {
        dueDate = addDays(today, Number(next));
        i += 3;
        continue;
      }
      if (unit === 'week' || unit === 'weeks') {
        dueDate = addDays(today, Number(next) * 7);
        i += 3;
        continue;
      }
      if (unit === 'hour' || unit === 'hours' || unit === 'hr' || unit === 'hrs') {
        const d = new Date(now.getTime() + Number(next) * 60 * 60 * 1000);
        dueDate = todayStr(d);
        dueTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        i += 3;
        continue;
      }
      if (unit === 'min' || unit === 'mins' || unit === 'minute' || unit === 'minutes') {
        const d = new Date(now.getTime() + Number(next) * 60 * 1000);
        dueDate = todayStr(d);
        dueTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        i += 3;
        continue;
      }
    }
    if (lw === 'in' && (next === 'a' || next === 'one') && third === 'week') {
      dueDate = addDays(today, 7);
      i += 3;
      continue;
    }
    if (lw === 'in' && (next === 'an' || next === 'a' || next === 'one') && (third === 'hour' || third === 'hr')) {
      const d = new Date(now.getTime() + 60 * 60 * 1000);
      dueDate = todayStr(d);
      dueTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      i += 3;
      continue;
    }

    // End of day / week / month
    if (lw === 'eod' || (lw === 'end' && next === 'of' && third === 'day')) {
      dueDate ??= today;
      dueTime = '17:00';
      i += lw === 'eod' ? 1 : 3;
      continue;
    }
    if (lw === 'eow' || (lw === 'end' && next === 'of' && third === 'week')) {
      dueDate = thisWeekday(today, 5);
      dueTime ??= '17:00';
      i += lw === 'eow' ? 1 : 3;
      continue;
    }
    if (lw === 'eom' || (lw === 'end' && next === 'of' && third === 'month')) {
      dueDate = getEndOfMonth(today);
      dueTime ??= '17:00';
      i += lw === 'eom' ? 1 : 3;
      continue;
    }

    // Time-of-day with "this": this morning / this afternoon / this evening / this night
    if (lw === 'this' && next && (next === 'morning' || next === 'afternoon' || next === 'evening' || next === 'night')) {
      dueDate = today;
      dueTime = { morning: '09:00', afternoon: '13:00', evening: '18:00', night: '21:00' }[next]!;
      i += 2;
      continue;
    }

    // Time-of-day words only count once a date is set, so a title like
    // "morning run" keeps its words.
    if (dueDate && (lw === 'morning' || lw === 'afternoon' || lw === 'evening' || lw === 'night')) {
      dueTime = { morning: '09:00', afternoon: '13:00', evening: '18:00', night: '21:00' }[lw]!;
      i++;
      continue;
    }

    // this <weekday> / coming <weekday>
    if ((lw === 'this' || lw === 'coming' || lw === 'upcoming') && next && next in WEEKDAYS) {
      dueDate = thisWeekday(today, WEEKDAYS[next]);
      i += 2;
      continue;
    }

    // next <weekday> / next week / next month
    if (lw === 'next' && next && next in WEEKDAYS) {
      dueDate = nextWeekday(today, WEEKDAYS[next], true);
      i += 2;
      continue;
    }
    if (lw === 'next' && next === 'week') {
      dueDate = addDays(today, 7);
      i += 2;
      continue;
    }
    if (lw === 'next' && next === 'month') {
      const [y, m] = today.split('-').map(Number);
      const nextY = m === 12 ? y + 1 : y;
      const nextM = m === 12 ? 1 : m + 1;
      dueDate = `${nextY}-${String(nextM).padStart(2, '0')}-01`;
      i += 2;
      continue;
    }

    // Bare weekdays
    if (lw in WEEKDAYS) {
      dueDate = nextWeekday(today, WEEKDAYS[lw], false);
      i++;
      continue;
    }

    // ISO dates
    const iso = lw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso && validDate(iso[0])) {
      dueDate = iso[0];
      i++;
      continue;
    }

    // Month and day (e.g. nov 12, oct 3rd)
    const monDay = lw.match(/^([a-z]{3,9})$/) && next?.match(/^(\d{1,2})(?:st|nd|rd|th)?$/);
    if (monDay && next) {
      const mk = lw.slice(0, 3);
      if (mk in MONTHS) {
        const y = today.slice(0, 4);
        const dayNum = Number(next.match(/^\d+/)![0]);
        const cand = `${y}-${String(MONTHS[mk]).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        const target = cand >= today ? cand : `${Number(y) + 1}-${cand.slice(5)}`;
        if (validDate(target)) {
          dueDate = target;
          i += 2;
          continue;
        }
      }
    }

    // Priority: p1 (high) .. p3 (low)
    const pm = lw.match(/^p([123])$/);
    if (pm) {
      priority = Number(pm[1]);
      i++;
      continue;
    }

    // Times
    if (lw === 'at' && next && takeTime(next)) {
      i += 2;
      continue;
    }
    if (takeTime(w)) {
      i++;
      continue;
    }
    if (lw === 'noon' || lw === 'midday') {
      dueTime = '12:00';
      i++;
      continue;
    }
    if (lw === 'midnight') {
      dueTime = '00:00';
      i++;
      continue;
    }

    kept.push(w);
    i++;
  }

  return { title: kept.join(' '), dueDate, dueTime, recurrence, priority };
}
