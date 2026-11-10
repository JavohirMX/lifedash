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
    expect(parse('Lunch this friday').dueDate).toBe('2026-10-23');
  });
  it('weekends: weekend, this weekend, next weekend, on the weekend', () => {
    // NOW is Tuesday 2026-10-20; coming Saturday is 2026-10-24, next Saturday is 2026-10-31
    expect(parse('Party weekend')).toMatchObject({ title: 'Party', dueDate: '2026-10-24' });
    expect(parse('Party this weekend')).toMatchObject({ title: 'Party', dueDate: '2026-10-24' });
    expect(parse('Hike next weekend')).toMatchObject({ title: 'Hike', dueDate: '2026-10-31' });
    expect(parse('Relax on the weekend')).toMatchObject({ title: 'Relax', dueDate: '2026-10-24' });
    expect(parse('Finish chores by the weekend')).toMatchObject({ title: 'Finish chores', dueDate: '2026-10-24' });
  });
  it('prepositions: by, due, on, before cleanly consumed without leaving dangling words', () => {
    expect(parse('Submit report by next friday')).toMatchObject({ title: 'Submit report', dueDate: '2026-10-30' });
    expect(parse('Submit report by friday')).toMatchObject({ title: 'Submit report', dueDate: '2026-10-23' });
    expect(parse('Submit report by tomorrow')).toMatchObject({ title: 'Submit report', dueDate: '2026-10-21' });
    expect(parse('Submit report by 5pm')).toMatchObject({ title: 'Submit report', dueTime: '17:00' });
    expect(parse('Taxes due next friday')).toMatchObject({ title: 'Taxes', dueDate: '2026-10-30' });
    expect(parse('Review on this friday')).toMatchObject({ title: 'Review', dueDate: '2026-10-23' });
    expect(parse('Call before noon')).toMatchObject({ title: 'Call', dueTime: '12:00' });
  });
  it('day after tomorrow / eow / eom', () => {
    expect(parse('Dentist day after tomorrow')).toMatchObject({ title: 'Dentist', dueDate: '2026-10-22' });
    expect(parse('Submit deliverables end of week')).toMatchObject({ title: 'Submit deliverables', dueDate: '2026-10-23', dueTime: '17:00' });
    expect(parse('Submit deliverables eow')).toMatchObject({ title: 'Submit deliverables', dueDate: '2026-10-23', dueTime: '17:00' });
    expect(parse('Close books end of month')).toMatchObject({ title: 'Close books', dueDate: '2026-10-31', dueTime: '17:00' });
    expect(parse('Close books eom')).toMatchObject({ title: 'Close books', dueDate: '2026-10-31', dueTime: '17:00' });
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
    expect(parse('Dentist at 3p').dueTime).toBe('15:00');
    expect(parse('Call at 9a').dueTime).toBe('09:00');
    expect(parse('Dentist 15:30').dueTime).toBe('15:30');
    expect(parse('Meeting 14.30').dueTime).toBe('14:30');
    expect(parse('Call at 12am').dueTime).toBe('00:00');
    expect(parse('Lunch noon').dueTime).toBe('12:00');
    expect(parse('Lunch midday').dueTime).toBe('12:00');
    expect(parse('Sleep midnight').dueTime).toBe('00:00');
  });
  it('relative hours and minutes: in 2 hours / in 30 mins', () => {
    // NOW is 12:00
    expect(parse('Quick check in 2 hours')).toMatchObject({ dueDate: '2026-10-20', dueTime: '14:00', title: 'Quick check' });
    expect(parse('Quick check in 30 mins')).toMatchObject({ dueDate: '2026-10-20', dueTime: '12:30', title: 'Quick check' });
    expect(parse('Break in an hour')).toMatchObject({ dueDate: '2026-10-20', dueTime: '13:00', title: 'Break' });
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
