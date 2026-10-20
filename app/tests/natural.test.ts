import { describe, it, expect } from 'vitest';
import { parseNatural } from '../src/natural';

const NOW = new Date('2026-10-20T15:00:00'); // a Tuesday

describe('parseNatural', () => {
  it('passes plain titles through untouched', () => {
    expect(parseNatural('Buy milk', NOW)).toEqual({ title: 'Buy milk', dueDate: null, dueTime: null, recurrence: null });
  });
  it('today and tomorrow', () => {
    expect(parseNatural('Call bank today', NOW).dueDate).toBe('2026-10-20');
    expect(parseNatural('Call bank tomorrow', NOW).dueDate).toBe('2026-10-21');
  });
  it('in N days / in a week', () => {
    expect(parseNatural('Water plants in 3 days', NOW).dueDate).toBe('2026-10-23');
    expect(parseNatural('Check pipes in a week', NOW).dueDate).toBe('2026-10-27');
  });
  it('bare weekday means the coming one, next weekday the one after', () => {
    expect(parseNatural('Gym friday', NOW).dueDate).toBe('2026-10-23');
    expect(parseNatural('Gym next friday', NOW).dueDate).toBe('2026-10-30');
    expect(parseNatural('Gym on monday', NOW).dueDate).toBe('2026-10-26');
  });
  it('named weekday = today means a week out', () => {
    expect(parseNatural('Review tuesday', NOW).dueDate).toBe('2026-10-27');
  });
  it('next week', () => {
    expect(parseNatural('Plan sprint next week', NOW).dueDate).toBe('2026-10-27');
  });
  it('ISO dates and month names', () => {
    expect(parseNatural('Trip 2026-11-05', NOW).dueDate).toBe('2026-11-05');
    expect(parseNatural('Trip nov 5', NOW).dueDate).toBe('2026-11-05');
    expect(parseNatural('Renew passport jan 10', NOW).dueDate).toBe('2027-01-10');
    expect(parseNatural('Pay on oct 3rd', NOW).dueDate).toBe('2027-10-03'); // past this year -> next
  });
  it('times: 5pm, at 5pm, 17:30, noon, tonight', () => {
    expect(parseNatural('Call 5pm', NOW).dueTime).toBe('17:00');
    expect(parseNatural('Call at 8:30am', NOW).dueTime).toBe('08:30');
    expect(parseNatural('Call 17:30', NOW).dueTime).toBe('17:30');
    expect(parseNatural('Lunch noon', NOW).dueTime).toBe('12:00');
    expect(parseNatural('Movie tonight', NOW)).toMatchObject({ dueDate: '2026-10-20', dueTime: '20:00' });
  });
  it('recurrence: every day starts tomorrow', () => {
    const r = parseNatural('Stretch every day', NOW);
    expect(r.title).toBe('Stretch');
    expect(r.dueDate).toBe('2026-10-21');
    expect(r.recurrence).toContain('FREQ=DAILY');
  });
  it('recurrence: every monday anchors on the coming monday', () => {
    const r = parseNatural('Team sync every monday', NOW);
    expect(r.dueDate).toBe('2026-10-26');
    expect(r.recurrence).toContain('FREQ=WEEKLY');
    expect(r.recurrence).toContain('BYDAY=MO');
  });
  it('recurrence: every 3 days', () => {
    const r = parseNatural('Backup every 3 days', NOW);
    expect(r.recurrence).toContain('INTERVAL=3');
  });
  it('recurrence: every month', () => {
    const r = parseNatural('Pay rent every month', NOW);
    expect(r.recurrence).toContain('FREQ=MONTHLY');
  });
  it('date + time combine and leave a clean title', () => {
    const r = parseNatural('Dentist tomorrow at 4pm', NOW);
    expect(r).toMatchObject({ title: 'Dentist', dueDate: '2026-10-21', dueTime: '16:00' });
  });
  it('does not eat ordinary words', () => {
    expect(parseNatural('Everyday carry list', NOW).title).toBe('Everyday carry list');
    expect(parseNatural('Next steps doc', NOW).title).toBe('Next steps doc');
    expect(parseNatural('Call at once', NOW).title).toBe('Call at once');
  });
});
