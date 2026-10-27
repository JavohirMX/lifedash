import { describe, expect, it } from 'vitest';
import { tasksToIcs, parseIcsEvents, foldLine } from './ics';
import { makeRecurrence } from './logic';
import type { Task, Project } from './types';

const project: Project = { id: 'p1', name: 'Home, Garden', color: '#fff', order: 0, archived: false };
function task(over: Partial<Task>): Task {
  return {
    id: 't1', title: 'Pay rent', note: '', noteDoc: null, projectId: 'p1', parentId: null, goalId: null, noteId: null,
    status: 'active', pinned: false, priority: 0, dueDate: '2026-11-03', dueTime: null, recurrence: null, blockedBy: [],
    tags: [], order: 0, seriesId: null, createdAt: Date.UTC(2026, 9, 1), updatedAt: Date.UTC(2026, 9, 2, 3, 4, 5), completedAt: null,
    ...over,
  };
}
const unfoldAll = (s: string) => s.replace(/\r\n /g, '');

describe('tasksToIcs', () => {
  it('writes a valid calendar with CRLF line endings', () => {
    const ics = tasksToIcs([task({})], [project]);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  it('makes a task without a time an all-day event ending the next day', () => {
    const ics = tasksToIcs([task({ dueDate: '2026-12-31' })], [project]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231');
    expect(ics).toContain('DTEND;VALUE=DATE:20270101');
    expect(ics).toContain('UID:t1@lifedash');
    expect(ics).toContain('DTSTAMP:20261002T030405Z');
  });

  it('makes a timed task a zoned event with the default 30 minute length, across midnight too', () => {
    expect(tasksToIcs([task({ dueTime: '09:15' })], [project], { timeZone: 'Asia/Makassar' })).toContain('DTSTART;TZID=Asia/Makassar:20261103T091500\r\nDTEND;TZID=Asia/Makassar:20261103T094500');
    const late = tasksToIcs([task({ dueDate: '2026-12-31', dueTime: '23:45' })], [project], { durationMinutes: 60, timeZone: 'Asia/Makassar' });
    expect(late).toContain('DTEND;TZID=Asia/Makassar:20270101T004500');
  });

  it('writes X-WR-TIMEZONE and TZID EXDATEs, ignores an invalid zone name', () => {
    const rule = makeRecurrence('daily', '2026-11-03');
    const z = tasksToIcs([task({ dueTime: '08:00', recurrence: rule, skippedDates: ['2026-11-05'] })], [project], { timeZone: 'Europe/Berlin' });
    expect(z).toContain('X-WR-TIMEZONE:Europe/Berlin');
    expect(z).toContain('EXDATE;TZID=Europe/Berlin:20261105T080000');
    const bad = tasksToIcs([task({ dueTime: '08:00' })], [project], { timeZone: 'Not/AZone;X' });
    expect(bad).not.toContain('TZID=Not');
  });

  it('escapes text and folds long lines without splitting characters', () => {
    const ics = tasksToIcs([task({ title: 'a;b,c\\d', note: 'line1\nline2', tags: ['x'] })], [project], { includeNotes: true });
    expect(ics).toContain('SUMMARY:a\\;b\\,c\\\\d');
    expect(ics).toContain('DESCRIPTION:line1\\nline2\\n\\nProject: Home\\, Garden');
    expect(ics).toContain('CATEGORIES:Home\\, Garden,x');
    const long = 'é'.repeat(80);
    const folded = foldLine(`SUMMARY:${long}`);
    expect(folded.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${long}`);
  });

  it('leaves out done, archived and undated tasks by default and marks done ones when included', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b', status: 'done' }), task({ id: 'c', status: 'archived' }), task({ id: 'd', dueDate: null })];
    const ics = tasksToIcs(tasks, [project]);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('UID:a@lifedash');
    const withDone = tasksToIcs(tasks, [project], { includeDone: true });
    expect(withDone.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(withDone).toContain('SUMMARY:[done] Pay rent');
  });

  it('exports a repeating task as one event with an RRULE and EXDATEs for skipped days', () => {
    const rule = makeRecurrence('weekly', '2026-11-03');
    const ics = unfoldAll(tasksToIcs([task({ recurrence: rule, skippedDates: ['2026-11-10'] })], [project]));
    expect(ics).toMatch(/RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TU/);
    expect(ics).not.toContain('DTSTART:2026'); // the rule's own DTSTART is not copied into the rule line
    expect(ics).toContain('EXDATE;VALUE=DATE:20261110');
  });

  it('skips a broken recurrence rule instead of failing the export', () => {
    const ics = tasksToIcs([task({ recurrence: 'not a rule' })], [project]);
    expect(ics).not.toContain('RRULE');
    expect(ics).toContain('BEGIN:VEVENT');
  });

  it('ignores a malformed time and treats it as all-day', () => {
    expect(tasksToIcs([task({ dueTime: '25:99' })], [project])).toContain('DTSTART;VALUE=DATE:20261103');
  });

  it('keeps notes out of the file unless asked', () => {
    const ics = tasksToIcs([task({ note: 'private detail' })], [project]);
    expect(ics).not.toContain('private detail');
    expect(ics).toContain('DESCRIPTION:Project: Home\\, Garden');
  });

  it('orders events by date then time, deterministically', () => {
    const ics = tasksToIcs([task({ id: 'b', dueDate: '2026-11-04' }), task({ id: 'a', dueDate: '2026-11-03', dueTime: '10:00' }), task({ id: 'c', dueDate: '2026-11-03' })], [project]);
    const ids = [...ics.matchAll(/UID:(\w+)@lifedash/g)].map((m) => m[1]);
    expect(ids).toEqual(['c', 'a', 'b']);
  });
});

describe('parseIcsEvents', () => {
  it('round-trips the export', () => {
    const ics = tasksToIcs([task({ title: 'Call; Bob, now', note: 'n1\nn2', dueTime: '14:30' })], [project], { includeNotes: true });
    const [e] = parseIcsEvents(ics);
    expect(e.uid).toBe('t1@lifedash');
    expect(e.title).toBe('Call; Bob, now');
    expect(e.note).toContain('n1\nn2');
    expect(e.dueDate).toBe('2026-11-03');
    expect(e.dueTime).toBe('14:30');
    expect(e.repeats).toBe(false);
  });

  it('reads all-day events, folded lines and repeat flags from a foreign file', () => {
    const text = [
      'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:abc@google.com', 'DTSTART;VALUE=DATE:20270105', 'RRULE:FREQ=YEARLY',
      'SUMMARY:Long titl', ' e here', 'END:VEVENT', 'BEGIN:VEVENT', 'SUMMARY:No start', 'END:VEVENT', 'END:VCALENDAR', '',
    ].join('\r\n');
    const evs = parseIcsEvents(text);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ uid: 'abc@google.com', title: 'Long title here', dueDate: '2027-01-05', dueTime: null, repeats: true });
  });

  it('ignores garbage without throwing', () => {
    expect(parseIcsEvents('hello')).toEqual([]);
    expect(parseIcsEvents('BEGIN:VEVENT\r\nSUMMARY:x\r\nDTSTART:bad\r\nEND:VEVENT')).toEqual([]);
  });
});

import { offsetChanges, vtimezoneLines } from './vtimezone';

describe('VTIMEZONE', () => {
  it('writes one VTIMEZONE per file, before the first event, only when a timed event exists', () => {
    const timed = tasksToIcs([task({ dueTime: '09:00' })], [project], { timeZone: 'Europe/Berlin' });
    expect(timed.match(/BEGIN:VTIMEZONE/g)).toHaveLength(1);
    expect(timed.indexOf('BEGIN:VTIMEZONE')).toBeLessThan(timed.indexOf('BEGIN:VEVENT'));
    expect(timed).toContain('TZID:Europe/Berlin');
    const allDay = tasksToIcs([task({})], [project], { timeZone: 'Europe/Berlin' });
    expect(allDay).not.toContain('VTIMEZONE');
  });

  it('every observance has DTSTART, TZOFFSETFROM and TZOFFSETTO (RFC 5545 3.6.5)', () => {
    const lines = vtimezoneLines('America/New_York', 2026, 2027);
    const blocks = lines.join('\n').split(/BEGIN:(?:STANDARD|DAYLIGHT)\n/).slice(1);
    expect(blocks.length).toBeGreaterThanOrEqual(5); // initial + 2 changes a year
    for (const b of blocks) {
      expect(b).toMatch(/DTSTART:\d{8}T\d{6}/);
      expect(b).toMatch(/TZOFFSETFROM:[+-]\d{4}/);
      expect(b).toMatch(/TZOFFSETTO:[+-]\d{4}/);
    }
  });

  it('finds the real 2026 transitions: Berlin, New York, Sydney, none for Makassar', () => {
    const c = (z: string) => offsetChanges(z, 2026, 2026).changes.map((x) => [new Date(x.utcMs).toISOString(), x.from, x.to]);
    expect(c('Europe/Berlin')).toEqual([['2026-03-29T01:00:00.000Z', 60, 120], ['2026-10-25T01:00:00.000Z', 120, 60]]);
    expect(c('America/New_York')).toEqual([['2026-03-08T07:00:00.000Z', -300, -240], ['2026-11-01T06:00:00.000Z', -240, -300]]);
    expect(c('Australia/Sydney')).toEqual([['2026-04-04T16:00:00.000Z', 660, 600], ['2026-10-03T16:00:00.000Z', 600, 660]]);
    expect(c('Asia/Makassar')).toEqual([]);
  });

  it('keeps half-hour offsets', () => {
    expect(vtimezoneLines('Asia/Kolkata', 2026, 2026).join('\n')).toContain('TZOFFSETTO:+0530');
  });
});
