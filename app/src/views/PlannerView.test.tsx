import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../repo', () => ({
  updateTask: vi.fn(),
  addTask: vi.fn(),
  deleteTask: vi.fn(),
  toggleComplete: vi.fn(),
}));
import PlannerView, { PlanEditor } from './PlannerView';
import type { Task } from '../types';

describe('Lifedash Day & Week Planner presentation', () => {
  it('renders Day, Week, 24h Circle tabs, capacity stats, and planning tray', () => {
    const h = renderToStaticMarkup(<PlannerView tasks={[]} onOpen={() => {}} />);
    expect(h).toContain('Planner');
    expect(h).toContain('Plan · Daily &amp; weekly time blocking');
    expect(h).toContain('Day');
    expect(h).toContain('Week');
    expect(h).toContain('24h Circle');
    expect(h).toContain('planned');
    expect(h).toContain('free');
    expect(h).toContain('Zoom');
    expect(h).toContain('Snap');
    expect(h).toContain('Tasks to Plan');
    expect(h).toContain('Recurring');
  });

  it('renders waiting tasks safely in the planning tray', () => {
    const t = {
      id: 'x',
      title: '<script>safe</script>',
      status: 'active',
      parentId: null,
      projectId: 'inbox',
      dueDate: null,
      dueTime: null,
      plannedDate: null,
      plannedTime: null,
      blockedBy: [],
      tags: [],
    } as unknown as Task;
    const h = renderToStaticMarkup(
      <PlannerView tasks={[t]} onOpen={() => {}} initialSideTab="tasks" />
    );
    expect(h).not.toContain('<script>safe</script>');
    expect(h).toContain('&lt;script&gt;safe&lt;/script&gt;');
  });

  it('preserves PlanEditor export for HomeView compatibility', () => {
    const t = {
      id: 'x',
      title: 'Important task',
      status: 'active',
      parentId: null,
      dueDate: '2026-11-05',
      plannedDate: '2026-11-05',
      plannedTime: '14:00',
      durationMinutes: 45,
      blockedBy: [],
      tags: [],
    } as unknown as Task;
    const h = renderToStaticMarkup(
      <PlanEditor task={t} date="2026-11-05" suggestedTime={null} close={() => {}} />
    );
    expect(h).toContain('Work plan for Important task');
    expect(h).toContain('Planned work date');
    expect(h).toContain('Planned start');
    expect(h).toContain('Estimate (minutes)');
    expect(h).toContain('Save plan');
  });
});
