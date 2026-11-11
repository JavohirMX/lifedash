// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../components/WeeklyReview', () => ({ default: () => null }));
import HomeView from './HomeView';
import type { Task } from '../types';

function makeBacklogTask(partial: Partial<Task> & { id: string; title: string }): Task {
  return {
    note: '',
    noteDoc: null,
    projectId: 'inbox',
    parentId: null,
    goalId: null,
    noteId: null,
    status: 'active',
    pinned: false,
    priority: 0,
    dueDate: null,
    dueTime: null,
    plannedDate: null,
    plannedTime: null,
    durationMinutes: null,
    recurrence: null,
    blockedBy: [],
    tags: [],
    order: 0,
    seriesId: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    completedAt: null,
    ...partial,
  };
}

describe('HomeView', () => {
  it('renders without inline customize or widget toggle controls', () => {
    const html = renderToStaticMarkup(
      <HomeView tasks={[]} onSelect={vi.fn()} onOpen={vi.fn()} onNavigate={vi.fn()} />
    );

    expect(html).toContain('One thing at a time');
    expect(html).not.toContain('home-customize');
    expect(html).not.toContain('Home screen settings');
    expect(html).not.toContain('Home Screen settings');
    expect(html).not.toContain('widget-settings');
  });

  it('surfaces backlog tasks oldest-first within priority tier when nothing is due today', () => {
    const tasks = [
      makeBacklogTask({
        id: 'newer-med',
        title: 'Newer medium task',
        priority: 2,
        createdAt: 1_700_000_200_000,
        updatedAt: 1_700_000_200_000,
      }),
      makeBacklogTask({
        id: 'older-med',
        title: 'Oldest medium task',
        priority: 2,
        createdAt: 1_700_000_010_000,
        updatedAt: 1_700_000_010_000,
      }),
    ];

    const html = renderToStaticMarkup(
      <HomeView tasks={tasks} onSelect={vi.fn()} onOpen={vi.fn()} onNavigate={vi.fn()} />
    );

    expect(html).toContain('Oldest medium task');
    expect(html.indexOf('Oldest medium task')).toBeLessThan(html.indexOf('Newer medium task'));
  });
});
