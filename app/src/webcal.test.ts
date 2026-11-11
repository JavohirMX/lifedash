import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeWebcalUrl,
  unfoldIcsLines,
  parseIcs,
  webcalEventsToDayBlocks,
  type WebcalFeed,
  type WebcalEvent,
} from './webcal';

describe('Webcal and ICS utilities', () => {
  beforeEach(() => {
    // Freeze "today" inside the Nov 2026 fixture range so parseIcs windows stay deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 5, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });
  it('normalizes webcal:// and webcals:// URLs to https://', () => {
    expect(normalizeWebcalUrl('webcal://calendar.google.com/ical/basic.ics')).toBe(
      'https://calendar.google.com/ical/basic.ics'
    );
    expect(normalizeWebcalUrl('webcals://example.com/feed.ics')).toBe(
      'https://example.com/feed.ics'
    );
    expect(normalizeWebcalUrl('https://example.com/feed.ics ')).toBe(
      'https://example.com/feed.ics'
    );
  });

  it('unfolds RFC 5545 wrapped lines correctly', () => {
    const folded = [
      'BEGIN:VCALENDAR',
      'DESCRIPTION:This is a very long line that has been folded ',
      ' across multiple lines according to the RFC 5545 ',
      '\tspecification.',
      'END:VCALENDAR',
    ].join('\r\n');

    const lines = unfoldIcsLines(folded);
    expect(lines).toContain(
      'DESCRIPTION:This is a very long line that has been folded across multiple lines according to the RFC 5545 specification.'
    );
  });

  it('parses basic single-occurrence VEVENT with escaped text', () => {
    const ics = `
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:test-uid-1@lifedash
DTSTART:20261105T100000Z
DTEND:20261105T113000Z
SUMMARY:Project Review\\, Roadmap & Planning\\; Q4
END:VEVENT
END:VCALENDAR
    `.trim();

    const events = parseIcs(ics, 'feed-1', 'Work', '#2563eb');
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('test-uid-1@lifedash');
    expect(events[0].title).toBe('Project Review, Roadmap & Planning; Q4');
    expect(events[0].allDay).toBe(false);
    expect(events[0].color).toBe('#2563eb');
    expect(events[0].feedName).toBe('Work');
  });

  it('parses all-day events correctly with VALUE=DATE', () => {
    const ics = `
BEGIN:VCALENDAR
BEGIN:VEVENT
UID:allday-1
DTSTART;VALUE=DATE:20261105
DTEND;VALUE=DATE:20261106
SUMMARY:Company Holiday
END:VEVENT
END:VCALENDAR
    `.trim();

    const events = parseIcs(ics, 'feed-1', 'Holidays', '#dc2626');
    expect(events).toHaveLength(1);
    expect(events[0].allDay).toBe(true);
    expect(events[0].start).toBe('2026-11-05');
    expect(events[0].end).toBe('2026-11-06');
    expect(events[0].title).toBe('Company Holiday');
  });

  it('expands recurring events via RRULE', () => {
    const ics = `
BEGIN:VCALENDAR
BEGIN:VEVENT
UID:recur-1
DTSTART:20261101T090000
DTEND:20261101T100000
RRULE:FREQ=DAILY;COUNT=5
SUMMARY:Daily Standup
END:VEVENT
END:VCALENDAR
    `.trim();

    const events = parseIcs(ics, 'feed-1', 'Team', '#059669', -5, 10);
    // Recurring events expand for the window
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].title).toBe('Daily Standup');
    expect(events[0].color).toBe('#059669');
  });

  it('converts timed Webcal events to Day Planner ScheduledBlocks', () => {
    const events: WebcalEvent[] = [
      {
        id: 'ev-1',
        feedId: 'feed-1',
        feedName: 'Personal',
        color: '#0284c7',
        title: 'Dentist Appointment',
        start: '2026-11-05T14:30',
        end: '2026-11-05T15:30',
        allDay: false,
      },
      {
        id: 'ev-2',
        feedId: 'feed-1',
        feedName: 'Personal',
        color: '#0284c7',
        title: 'Nov 6 Meetup',
        start: '2026-11-06T10:00',
        end: '2026-11-06T11:00',
        allDay: false,
      },
      {
        id: 'ev-3',
        feedId: 'feed-1',
        feedName: 'Personal',
        color: '#0284c7',
        title: 'All Day Birthday',
        start: '2026-11-05',
        end: '2026-11-06',
        allDay: true,
      },
    ];

    const blocks = webcalEventsToDayBlocks(events, '2026-11-05');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('webcal-ev-1');
    expect(blocks[0].title).toBe('Dentist Appointment (Personal)');
    expect(blocks[0].start).toBe(14 * 60 + 30); // 870 min
    expect(blocks[0].dur).toBe(60);
    expect(blocks[0].color).toBe('#0284c7');
  });
});
