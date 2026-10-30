import { describe, expect, it } from 'vitest';
import { localPlan, type LocalPlanTask } from './localPlanner';

const mk = (title: string, over: Partial<LocalPlanTask> = {}): LocalPlanTask => ({
  title, dueDate: null, dueTime: null, priority: 0, status: 'active', ...over,
});
const NOW = new Date('2026-10-20T12:00:00');

describe('localPlan', () => {
  it('ranks overdue first, then due-today by time, then high-priority undated', () => {
    const out = localPlan('', [
      mk('later task', { dueDate: '2026-10-25' }),
      mk('undated high', { priority: 1 }),
      mk('today 5pm', { dueDate: '2026-10-20', dueTime: '17:00' }),
      mk('overdue one', { dueDate: '2026-10-18' }),
      mk('today 9am', { dueDate: '2026-10-20', dueTime: '09:00' }),
      mk('undated low', { priority: 3 }),
    ], NOW);
    const order = ['overdue one', 'today 9am', 'today 5pm', 'undated high', 'later task', 'undated low'];
    const positions = order.map((t) => out.indexOf(t));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // The high-priority bucket must hold the p1 task, not the p3 one (1=high, 3=low).
    const highSection = out.split('High priority, no date')[1]?.split('Coming up')[0] ?? '';
    expect(highSection).toContain('undated high');
    expect(highSection).not.toContain('undated low');
  });
  it('excludes done and archived tasks', () => {
    const out = localPlan('', [mk('done task', { status: 'done', dueDate: '2026-10-19' }), mk('live', { dueDate: '2026-10-20' })], NOW);
    expect(out).not.toContain('done task');
    expect(out).toContain('live');
  });
  it('says so when nothing active is shared', () => {
    const out = localPlan('anything', [], NOW);
    expect(out).toContain('No active tasks were shared');
  });
  it('labels itself as rule-based and notes free text is not interpreted', () => {
    const out = localPlan('plan my week', [mk('a', { dueDate: '2026-10-20' })], NOW);
    expect(out).toContain('rule-based');
    expect(out).toContain('cannot interpret free text');
    expect(out).toContain('plan my week');
  });
  it('never changes the input tasks', () => {
    const tasks = [mk('x', { dueDate: '2026-10-19' }), mk('y')];
    const before = JSON.stringify(tasks);
    localPlan('', tasks, NOW);
    expect(JSON.stringify(tasks)).toBe(before);
  });
});
