import { describe, expect, it } from 'vitest';
import { parseNatural } from './natural';

// Fixed "now": Tuesday 2026-10-20 at 12:00 local.
const NOW = new Date(2026, 9, 20, 12, 0, 0);
const parse = (s: string) => parseNatural(s, NOW);

describe('parseNatural - dates', () => {
  it('passes plain titles through untouched', () => {
    const r = parse('Buy coffee beans');
    expect(r).toMatchObject({ title: 'Buy coffee beans', dueDate: null, dueTime: null, recurrence: null, priority: 0 });
  });
  it('today / tomorrow / tonight', () => {
    expect(parse('Call mum today').dueDate).toBe('2026-10-20');
    expect(parse('Call mum tomorrow').dueDate).toBe('2026-10-21');
    const t = parse('Gym tonight');
    expect(t).toMatchObject({ dueDate: '2026-10-20', dueTime: '20:00' });
  });
  it('in N days / in a week / in N weeks', () => {
    expect(parse('Review in 3 days').dueDate).toBe('2026-10-23');
    expect(parse('Review in a week').dueDate).toBe('2026-10-27');
    expect(parse('Review in 2 weeks').dueDate).toBe('2026-11-03');
  });
  it('weekdays: bare means the coming one, next means the one after', () => {
    expect(parse('Standup monday').dueDate).toBe('2026-10-26'); // next Mon
    expect(parse('Standup next monday').dueDate).toBe('2026-11-02');
    expect(parse('Lunch on friday').dueDate).toBe('2026-10-23');
  });
  it('ISO dates and month names', () => {
    expect(parse('Renew passport 2026-11-05').dueDate).toBe('2026-11-05');
    expect(parse('Mom birthday nov 12').dueDate).toBe('2026-11-12');
    expect(parse('File taxes jan 15').dueDate).toBe('2027-01-15'); // past this year -> next
    expect(parse('Meeting feb 31').dueDate).toBeNull();
    expect(parse('Meeting apr 31').dueDate).toBeNull();
    expect(parse('Meeting 2026-02-31').dueDate).toBeNull();
  });
});

describe('parseNatural - times', () => {
  it('parses 12h and 24h times', () => {
    expect(parse('Dentist at 3pm').dueTime).toBe('15:00');
    expect(parse('Dentist 15:30').dueTime).toBe('15:30');
    expect(parse('Call at 12am').dueTime).toBe('00:00');
    expect(parse('Lunch noon').dueTime).toBe('12:00');
  });
  it('time-of-day words apply only once a date exists', () => {
    const r = parse('Presentation tomorrow morning');
    expect(r).toMatchObject({ dueDate: '2026-10-21', dueTime: '09:00', title: 'Presentation' });
    const bare = parse('morning run');
    expect(bare).toMatchObject({ title: 'morning run', dueTime: null });
  });
  it('eod / end of day means today 17:00', () => {
    expect(parse('Send report eod')).toMatchObject({ dueDate: '2026-10-20', dueTime: '17:00' });
    expect(parse('Send report end of day')).toMatchObject({ dueDate: '2026-10-20', dueTime: '17:00' });
  });
});

describe('parseNatural - priority and recurrence', () => {
  it('p1..p3 set priority and leave the title clean', () => {
    const r = parse('Fix the leak p1');
    expect(r).toMatchObject({ title: 'Fix the leak', priority: 1 });
  });
  it('every day / week / month build a recurrence and anchor the date', () => {
    const d = parse('Vitamins every day');
    expect(d.recurrence).toContain('RRULE:FREQ=DAILY');
    expect(d.dueDate).toBe('2026-10-21');
    const w = parse('Water plants every week');
    expect(w.recurrence).toContain('FREQ=WEEKLY');
    const m = parse('Rent every month');
    expect(m.recurrence).toContain('FREQ=MONTHLY');
    const n = parse('Backup every 4 days');
    expect(n.recurrence).toContain('INTERVAL=4');
  });
});
