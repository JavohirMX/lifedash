// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  (globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'Asia/Makassar'; // fixed +08:00, no DST, so local-day expectations are stable
});

import { GoogleCalendarError, MAX_LOCAL_DAYS, googleConnectUrl, googleDisconnect, googleEvents, googleEventsForLocalDays, googleStatus, groupByDay, truncationNote, utcRangeForLocalDays, type GoogleEvent } from './googleCalendar';

const S = { url: 'https://sync.example/', username: 'u', token: 'TOK' };

function mockFetch(status: number, body: unknown, capture?: { url?: string; init?: RequestInit }) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (capture) Object.assign(capture, { url, init });
    return { status, ok: status >= 200 && status < 300, json: async () => { if (body === undefined) throw new Error('no json'); return body; } };
  });
}
afterEach(() => vi.unstubAllGlobals());

describe('googleStatus', () => {
  it('maps the server reply and sends the bearer token', async () => {
    const cap: { url?: string; init?: RequestInit } = {};
    mockFetch(200, { available: true, connected: true, connected_at: '2026-10-27T01:02:03Z' }, cap);
    expect(await googleStatus(S)).toEqual({ available: true, connected: true, connectedAt: '2026-10-27T01:02:03Z', problem: null });
    expect(cap.url).toBe('https://sync.example/api/google/status');
    expect((cap.init!.headers as Record<string, string>).Authorization).toBe('Bearer TOK');
  });
  it('treats 404 (older server) as unavailable, and passes a problem text through', async () => {
    mockFetch(404, {});
    expect((await googleStatus(S)).available).toBe(false);
    mockFetch(200, { available: false, connected: false, problem: 'SYNC_SECRET_KEYS missing or invalid' });
    expect((await googleStatus(S)).problem).toMatch(/SYNC_SECRET_KEYS/);
  });
  it('turns network failure and junk into typed errors', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('x'); });
    await expect(googleStatus(S)).rejects.toMatchObject({ kind: 'network' });
    mockFetch(200, undefined);
    await expect(googleStatus(S)).rejects.toMatchObject({ kind: 'bad_response' });
    mockFetch(200, [1]);
    await expect(googleStatus(S)).rejects.toMatchObject({ kind: 'bad_response' });
    mockFetch(500, {});
    await expect(googleStatus(S)).rejects.toMatchObject({ kind: 'upstream' });
  });
});

describe('googleConnectUrl', () => {
  it('returns only a Google accounts URL', async () => {
    mockFetch(200, { url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' });
    expect(await googleConnectUrl(S)).toContain('accounts.google.com');
    for (const bad of ['http://accounts.google.com/x', 'https://evil.example/x', 'javascript:alert(1)', 5, undefined, 'https://accounts.google.com.evil.example/x']) {
      mockFetch(200, { url: bad });
      await expect(googleConnectUrl(S)).rejects.toBeInstanceOf(GoogleCalendarError);
    }
  });
  it('maps 404 and 429', async () => {
    mockFetch(404, {});
    await expect(googleConnectUrl(S)).rejects.toMatchObject({ kind: 'unavailable' });
    mockFetch(429, {});
    await expect(googleConnectUrl(S)).rejects.toMatchObject({ kind: 'upstream' });
  });
});

describe('googleDisconnect', () => {
  it('reports revoked only when the server says so', async () => {
    mockFetch(200, { removed: true, revoked: false });
    expect(await googleDisconnect(S)).toEqual({ removed: true, revoked: false });
    mockFetch(200, { removed: true });
    expect((await googleDisconnect(S)).revoked).toBe(false);
  });
});

describe('googleEvents', () => {
  it('encodes the window, validates items and keeps the truncation reason', async () => {
    const cap: { url?: string } = {};
    mockFetch(200, { events: [{ id: 'a', title: 'T', start: '2026-11-03', end: '2026-11-04', allDay: true }, { id: 5 }, null, { id: 'b', title: 'B', start: 's', end: 'e' }], truncated: true, reason: 'event_cap' }, cap);
    const r = await googleEvents(S, '2026-11-01', '2026-11-08');
    expect(cap.url).toBe('https://sync.example/api/google/events?start=2026-11-01&end=2026-11-08');
    expect(r.events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(r.truncated).toBe(true);
    expect(r.reason).toBe('event_cap');
    expect(truncationNote(r)).toMatch(/first 500/);
  });
  it('ignores an unknown reason and says nothing when complete', async () => {
    mockFetch(200, { events: [], truncated: false, reason: null });
    const r = await googleEvents(S, '2026-11-01', '2026-11-08');
    expect(truncationNote(r)).toBeNull();
    mockFetch(200, { events: [], truncated: true, reason: 'made_up' });
    const r2 = await googleEvents(S, '2026-11-01', '2026-11-08');
    expect(r2.truncated).toBe(true);
    expect(r2.reason).toBeNull();
    expect(truncationNote(r2)).toMatch(/may be missing/);
  });
  it('maps 409 reconnect vs not connected, 404, 502', async () => {
    mockFetch(409, { detail: 'Google access expired or was revoked; reconnect' });
    await expect(googleEvents(S, 'a', 'b')).rejects.toMatchObject({ kind: 'reconnect' });
    mockFetch(409, { detail: 'not connected' });
    await expect(googleEvents(S, 'a', 'b')).rejects.toMatchObject({ kind: 'not_connected' });
    mockFetch(404, {});
    await expect(googleEvents(S, 'a', 'b')).rejects.toMatchObject({ kind: 'unavailable' });
    mockFetch(502, {});
    await expect(googleEvents(S, 'a', 'b')).rejects.toMatchObject({ kind: 'upstream' });
  });
});

describe('groupByDay (local zone Asia/Makassar, +08:00)', () => {
  const ev = (o: Partial<GoogleEvent> & { id: string }): GoogleEvent => ({ title: o.id, start: '', end: '', allDay: false, ...o });

  it('puts a one-day all-day event on one day (Google end is exclusive) and a 3-day one on three', () => {
    const m = groupByDay([ev({ id: 'one', allDay: true, start: '2026-11-03', end: '2026-11-04' }), ev({ id: 'three', allDay: true, start: '2026-11-03', end: '2026-11-06' })], '2026-11-01', '2026-11-10');
    expect([...m.keys()]).toEqual(['2026-11-03', '2026-11-04', '2026-11-05']);
    expect(m.get('2026-11-03')!.map((i) => i.id).sort()).toEqual(['one', 'three']);
    expect(m.get('2026-11-05')!.map((i) => i.id)).toEqual(['three']);
  });
  it('uses the local day for timed events, whatever offset Google sent', () => {
    // 2026-11-03 20:00 UTC is 2026-11-04 04:00 in +08:00
    const m = groupByDay([ev({ id: 'x', start: '2026-11-03T20:00:00Z', end: '2026-11-03T21:00:00Z' })], '2026-11-01', '2026-11-10');
    expect([...m.keys()]).toEqual(['2026-11-04']);
    expect(m.get('2026-11-04')![0].time).toBe('04:00');
  });
  it('spans midnight but an event ending exactly at local midnight stays on its day', () => {
    const span = groupByDay([ev({ id: 's', start: '2026-11-03T22:00:00+08:00', end: '2026-11-04T01:00:00+08:00' })], '2026-11-01', '2026-11-10');
    expect([...span.keys()]).toEqual(['2026-11-03', '2026-11-04']);
    expect(span.get('2026-11-04')![0].time).toBeNull();
    const edge = groupByDay([ev({ id: 'e', start: '2026-11-03T22:00:00+08:00', end: '2026-11-04T00:00:00+08:00' })], '2026-11-01', '2026-11-10');
    expect([...edge.keys()]).toEqual(['2026-11-03']);
  });
  it('clips to the window, sorts all-day first then by time, and survives junk dates and zero-length spans', () => {
    const m = groupByDay([
      ev({ id: 'late', start: '2026-11-03T15:00:00+08:00', end: '2026-11-03T16:00:00+08:00' }),
      ev({ id: 'early', start: '2026-11-03T08:00:00+08:00', end: '2026-11-03T09:00:00+08:00' }),
      ev({ id: 'day', allDay: true, start: '2026-11-03', end: '2026-11-04' }),
      ev({ id: 'zero', allDay: true, start: '2026-11-03', end: '2026-11-03' }),
      ev({ id: 'out', allDay: true, start: '2026-12-01', end: '2026-12-02' }),
      ev({ id: 'junk', start: 'nope', end: 'nope' }),
    ], '2026-11-03', '2026-11-03');
    expect([...m.keys()]).toEqual(['2026-11-03']);
    expect(m.get('2026-11-03')!.map((i) => i.id)).toEqual(['day', 'zero', 'early', 'late']);
  });
});

describe('groupByDay across zones, DST and all-day boundaries', () => {
  const setTz = (z: string) => {
    (globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = z;
  };
  afterEach(() => setTz('Asia/Makassar'));
  const ev = (o: Partial<GoogleEvent> & { id: string }): GoogleEvent => ({ title: o.id, start: '', end: '', allDay: false, ...o });
  const keys = (m: Map<string, unknown>) => [...m.keys()];

  it('the same UTC instant lands on different local days in different zones', () => {
    const e = [ev({ id: 'x', start: '2026-11-03T23:30:00Z', end: '2026-11-04T00:30:00Z' })];
    const day = (z: string) => { setTz(z); return keys(groupByDay(e, '2026-11-01', '2026-11-10')); };
    expect(day('America/New_York')).toEqual(['2026-11-03']); // 18:30 EST
    expect(day('Europe/Berlin')).toEqual(['2026-11-04', ]); // 00:30 CET, start already next day
    expect(day('Pacific/Auckland')).toEqual(['2026-11-04']); // 12:30 NZDT
    expect(day('Asia/Kolkata')).toEqual(['2026-11-04']); // 05:00 IST
    expect(day('Pacific/Pago_Pago')).toEqual(['2026-11-03']); // -11
  });

  it('half-hour zone time label', () => {
    setTz('Asia/Kolkata');
    const m = groupByDay([ev({ id: 'k', start: '2026-11-03T04:00:00Z', end: '2026-11-03T05:00:00Z' })], '2026-11-01', '2026-11-10');
    expect(m.get('2026-11-03')![0].time).toBe('09:30');
  });

  it('New York fall-back day (2026-11-01, 25 hours): events keep the right day and time', () => {
    setTz('America/New_York');
    const m = groupByDay([
      ev({ id: 'a', start: '2026-11-01T05:30:00Z', end: '2026-11-01T06:30:00Z' }), // 01:30 EDT, first 01:30
      ev({ id: 'b', start: '2026-11-01T06:30:00Z', end: '2026-11-01T07:30:00Z' }), // 01:30 EST, second 01:30
      ev({ id: 'c', start: '2026-11-02T04:00:00Z', end: '2026-11-02T05:00:00Z' }), // 23:00 EST on Nov 1
    ], '2026-10-30', '2026-11-03');
    expect(keys(m)).toEqual(['2026-11-01']);
    expect(m.get('2026-11-01')!.map((i) => `${i.id}@${i.time}`)).toEqual(['a@01:30', 'b@01:30', 'c@23:00']);
  });

  it('New York spring-forward day (2026-03-08): a UTC-spanning event touches only that day', () => {
    setTz('America/New_York');
    // 06:00Z = 01:00 EST; 08:00Z = 04:00 EDT (the 2am hour does not exist)
    const m = groupByDay([ev({ id: 's', start: '2026-03-08T06:00:00Z', end: '2026-03-08T08:00:00Z' })], '2026-03-07', '2026-03-09');
    expect(keys(m)).toEqual(['2026-03-08']);
    expect(m.get('2026-03-08')![0].time).toBe('01:00');
  });

  it('a multi-day all-day event across the DST change keeps exactly its days', () => {
    setTz('America/New_York');
    const m = groupByDay([ev({ id: 'trip', allDay: true, start: '2026-10-31', end: '2026-11-03' })], '2026-10-25', '2026-11-10');
    expect(keys(m)).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
    setTz('Australia/Sydney'); // spring forward 2026-10-04
    const m2 = groupByDay([ev({ id: 'trip', allDay: true, start: '2026-10-03', end: '2026-10-06' })], '2026-09-30', '2026-10-10');
    expect(keys(m2)).toEqual(['2026-10-03', '2026-10-04', '2026-10-05']);
  });

  it('all-day events do not move with the viewer zone', () => {
    const e = [ev({ id: 'h', allDay: true, start: '2026-12-25', end: '2026-12-26' })];
    for (const z of ['Pacific/Pago_Pago', 'Pacific/Kiritimati', 'Europe/London', 'America/Los_Angeles']) {
      setTz(z);
      expect(keys(groupByDay(e, '2026-12-20', '2026-12-31'))).toEqual(['2026-12-25']);
    }
  });

  it('window edges are inclusive, month and year boundaries work, leap day works', () => {
    const m = groupByDay([ev({ id: 'y', allDay: true, start: '2026-12-31', end: '2027-01-02' }), ev({ id: 'leap', allDay: true, start: '2028-02-28', end: '2028-03-02' })], '2026-12-31', '2028-03-01');
    expect(keys(m)).toEqual(['2026-12-31', '2027-01-01', '2028-02-28', '2028-02-29', '2028-03-01']);
    expect(groupByDay([ev({ id: 'y', allDay: true, start: '2026-12-31', end: '2027-01-02' })], '2027-01-01', '2027-01-01').get('2027-01-01')).toHaveLength(1);
  });

  it('timed event ending at local midnight in a non-Makassar zone, and one a second after', () => {
    setTz('Europe/Berlin');
    const edge = groupByDay([ev({ id: 'e', start: '2026-11-03T22:00:00+01:00', end: '2026-11-04T00:00:00+01:00' })], '2026-11-01', '2026-11-10');
    expect(keys(edge)).toEqual(['2026-11-03']);
    const over = groupByDay([ev({ id: 'o', start: '2026-11-03T22:00:00+01:00', end: '2026-11-04T00:00:01+01:00' })], '2026-11-01', '2026-11-10');
    expect(keys(over)).toEqual(['2026-11-03', '2026-11-04']);
  });

  it('a very long all-day event is bounded and does not hang', () => {
    const m = groupByDay([ev({ id: 'long', allDay: true, start: '2026-01-01', end: '2031-01-01' })], '2026-01-01', '2026-01-31');
    expect(keys(m)).toHaveLength(31);
  });
});


describe('local-day window to UTC request range', () => {
  const setTz = (z: string) => {
    (globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = z;
  };
  afterEach(() => setTz('Asia/Makassar'));

  it('Makassar (+08): local Nov 3 is Nov 2 16:00Z to Nov 3 16:00Z, so the UTC dates widen to Nov 2 .. Nov 4', () => {
    expect(utcRangeForLocalDays('2026-11-03', '2026-11-03')).toEqual({ start: '2026-11-02', end: '2026-11-04' });
  });
  it('UTC-like zone: exact midnight bounds stay exact', () => {
    setTz('UTC');
    expect(utcRangeForLocalDays('2026-11-03', '2026-11-03')).toEqual({ start: '2026-11-03', end: '2026-11-04' });
    expect(utcRangeForLocalDays('2026-11-03', '2026-11-09')).toEqual({ start: '2026-11-03', end: '2026-11-10' });
  });
  it('west of UTC: New York local Nov 3 (05:00Z to 05:00Z next day) widens end', () => {
    setTz('America/New_York');
    expect(utcRangeForLocalDays('2026-11-03', '2026-11-03')).toEqual({ start: '2026-11-03', end: '2026-11-05' });
  });
  it('always covers the local window in every tested zone, including DST changes', () => {
    for (const z of ['Pacific/Pago_Pago', 'America/New_York', 'Europe/Berlin', 'Asia/Kolkata', 'Pacific/Auckland', 'Pacific/Kiritimati', 'Australia/Sydney']) {
      setTz(z);
      for (const [f, t] of [['2026-11-01', '2026-11-01'], ['2026-03-08', '2026-03-09'], ['2026-10-03', '2026-10-05'], ['2026-12-28', '2027-01-03']] as const) {
        const { start, end } = utcRangeForLocalDays(f, t);
        const lo = new Date(f + 'T00:00:00').getTime();
        const hi = new Date(new Date(t + 'T00:00:00').getTime() + 26 * 3600_000).getTime(); // generous: next local midnight is within 26h
        expect(Date.parse(start + 'T00:00:00Z')).toBeLessThanOrEqual(lo);
        expect(Date.parse(end + 'T00:00:00Z')).toBeGreaterThanOrEqual(parseLocalMidnightAfter(t));
        expect(Date.parse(end + 'T00:00:00Z') - parseLocalMidnightAfter(t)).toBeLessThan(86_400_000); // ceil, not a whole extra day
        expect(Date.parse(end + 'T00:00:00Z')).toBeLessThanOrEqual(hi + 86_400_000);
      }
    }
  });
  it('asks the server for the widened range, keeps morning events and drops the neighbour day', async () => {
    const cap: { url?: string } = {};
    // Makassar: local Nov 3 06:00 = Nov 2 22:00Z (omitted by naive UTC bounds); local Nov 4 02:00 = Nov 3 18:00Z (outside)
    mockFetch(200, { events: [
      { id: 'morning', title: 'm', start: '2026-11-02T22:00:00Z', end: '2026-11-02T23:00:00Z', allDay: false },
      { id: 'next', title: 'n', start: '2026-11-03T18:00:00Z', end: '2026-11-03T19:00:00Z', allDay: false },
      { id: 'noon', title: 'x', start: '2026-11-03T04:00:00Z', end: '2026-11-03T05:00:00Z', allDay: false },
    ], truncated: false, reason: null }, cap);
    const r = await googleEventsForLocalDays(S, '2026-11-03', '2026-11-03');
    expect(cap.url).toBe('https://sync.example/api/google/events?start=2026-11-02&end=2026-11-04');
    expect([...r.byDay.keys()]).toEqual(['2026-11-03']);
    expect(r.byDay.get('2026-11-03')!.map((i) => i.id)).toEqual(['morning', 'noon']);
  });
  it('rejects empty, reversed and oversize windows without calling the server', async () => {
    let called = 0;
    vi.stubGlobal('fetch', async () => { called++; return { status: 200, ok: true, json: async () => ({ events: [] }) }; });
    await expect(googleEventsForLocalDays(S, '2026-11-05', '2026-11-03')).rejects.toBeInstanceOf(GoogleCalendarError);
    await expect(googleEventsForLocalDays(S, '2026-01-01', '2026-12-31')).rejects.toBeInstanceOf(GoogleCalendarError);
    expect(called).toBe(0);
    await googleEventsForLocalDays(S, '2026-11-01', '2026-11-' + String(MAX_LOCAL_DAYS > 30 ? 30 : MAX_LOCAL_DAYS));
    expect(called).toBe(1);
  });
  it('the widest allowed local window stays within the server 100-day UTC cap in extreme zones', () => {
    for (const z of ['Pacific/Pago_Pago', 'Pacific/Kiritimati', 'Asia/Kolkata']) {
      setTz(z);
      const from = '2026-06-01';
      const to = addDaysLocal(from, MAX_LOCAL_DAYS - 1);
      const { start, end } = utcRangeForLocalDays(from, to);
      expect((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86_400_000).toBeLessThanOrEqual(100);
    }
  });
});

function parseLocalMidnightAfter(t: string): number {
  const d = new Date(t + 'T00:00:00'); // local midnight of t
  d.setDate(d.getDate() + 1); // local midnight after t
  return d.getTime();
}

function addDaysLocal(s: string, n: number): string {
  const d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


describe('review edge cases', () => {
  it('rejects impossible or malformed local dates on either end before any fetch', async () => {
    let called = 0;
    vi.stubGlobal('fetch', async () => { called++; return { status: 200, ok: true, json: async () => ({ events: [] }) }; });
    for (const [f, t] of [['2026-02-30', '2026-02-30'], ['2026-02-28', '2026-02-30'], ['2026-13-01', '2026-13-02'], ['2026-2-1', '2026-2-2'], ['', ''], ['2026-04-31', '2026-05-01']] as const) {
      await expect(googleEventsForLocalDays(S, f, t)).rejects.toBeInstanceOf(GoogleCalendarError);
    }
    expect(called).toBe(0);
    await googleEventsForLocalDays(S, '2028-02-29', '2028-02-29'); // real leap day
    expect(called).toBe(1);
  });
  it('a long-running all-day event still shows in a later window, and a timed one keeps its true start time only on its first day', () => {
    const r = groupByDay([{ id: 'long', title: 'ongoing', allDay: true, start: '2020-01-01', end: '2030-01-01' }], '2026-11-03', '2026-11-04');
    expect([...r.keys()]).toEqual(['2026-11-03', '2026-11-04']);
    const t = groupByDay([{ id: 'x', title: 't', allDay: false, start: '2026-11-02T22:00:00Z', end: '2026-11-03T22:00:00Z' }], '2026-11-03', '2026-11-03');
    expect(t.get('2026-11-03')![0].time).toBe('06:00'); // Makassar: starts on Nov 3 local
    const u = groupByDay([{ id: 'y', title: 'u', allDay: false, start: '2020-01-01T10:00:00Z', end: '2030-01-01T10:00:00Z' }], '2026-11-03', '2026-11-03');
    expect(u.get('2026-11-03')![0].time).toBeNull(); // continuing day
  });
});
