/**
 * Build an RFC 5545 VTIMEZONE block for an IANA zone from the runtime's own tz data (Intl).
 *
 * RFC 5545 3.6.5 says a VTIMEZONE MUST be present for each TZID used, so an export that writes
 * TZID=Europe/Berlin alone is not conforming. We cannot read the IANA rules directly, so we
 * sample the UTC offset day by day, bisect each change to the minute, and write every change in
 * the covered years as its own observance with an RDATE. Dates outside the covered years are
 * not described: the offset in force at the edges is assumed to continue.
 */
const MIN = 60_000;

function offsetFn(zone: string): (utcMs: number) => number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
  return (utcMs: number) => {
    const name = fmt.formatToParts(new Date(utcMs)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    const m = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name);
    if (!m || !m[1]) return 0;
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  };
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** Wall-clock text YYYYMMDDTHHMMSS for a UTC instant seen through a fixed offset (minutes). */
function wall(utcMs: number, offsetMin: number): string {
  const d = new Date(utcMs + offsetMin * MIN);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}00`;
}

function fmtOffset(min: number): string {
  const a = Math.abs(min);
  return `${min < 0 ? '-' : '+'}${p2(Math.floor(a / 60))}${p2(a % 60)}`;
}

export interface OffsetChange {
  utcMs: number;
  from: number;
  to: number;
}

/** Offset changes (minutes) of `zone` between Jan 1 of fromYear and Jan 1 of toYear+1. */
export function offsetChanges(zone: string, fromYear: number, toYear: number): { start: number; initial: number; changes: OffsetChange[] } {
  const off = offsetFn(zone);
  const start = Date.UTC(fromYear, 0, 1);
  const end = Date.UTC(toYear + 1, 0, 1);
  const DAY = 86_400_000;
  const initial = off(start);
  const changes: OffsetChange[] = [];
  let prevT = start;
  let prevO = initial;
  for (let t = start + DAY; t <= end; t += DAY) {
    const o = off(t);
    if (o !== prevO) {
      let lo = prevT;
      let hi = t; // off(lo) = prevO, off(hi) = o
      while (hi - lo > MIN) {
        const mid = lo + Math.floor((hi - lo) / 2 / MIN) * MIN || lo + MIN;
        if (off(mid) === prevO) lo = mid;
        else hi = mid;
      }
      changes.push({ utcMs: hi, from: prevO, to: o });
      prevO = o;
    }
    prevT = t;
  }
  return { start, initial, changes };
}

export function vtimezoneLines(zone: string, fromYear: number, toYear: number): string[] {
  const { start, initial, changes } = offsetChanges(zone, fromYear, toYear);
  const lines = [
    'BEGIN:VTIMEZONE',
    `TZID:${zone}`,
    'BEGIN:STANDARD',
    `DTSTART:${wall(start, initial)}`,
    `TZOFFSETFROM:${fmtOffset(initial)}`,
    `TZOFFSETTO:${fmtOffset(initial)}`,
    'END:STANDARD',
  ];
  for (const c of changes) {
    const kind = c.to > c.from ? 'DAYLIGHT' : 'STANDARD';
    const local = wall(c.utcMs, c.from);
    lines.push(`BEGIN:${kind}`, `DTSTART:${local}`, `TZOFFSETFROM:${fmtOffset(c.from)}`, `TZOFFSETTO:${fmtOffset(c.to)}`, `RDATE:${local}`, `END:${kind}`);
  }
  lines.push('END:VTIMEZONE');
  return lines;
}
