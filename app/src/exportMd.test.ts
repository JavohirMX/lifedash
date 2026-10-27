import { describe, expect, it } from 'vitest';
import { tasksToMarkdown } from './exportMd';
import { parseObsidianMd } from './import';
import type { Task, Project } from './types';

const projects: Project[] = [
  { id: 'inbox', name: 'Inbox', color: '#000', order: 0, archived: false },
  { id: 'work', name: 'Work', color: '#111', order: 1, archived: false },
  { id: 'old', name: 'Old', color: '#222', order: 2, archived: true },
];

const mk = (id: string, over: Partial<Task> = {}): Task => ({
  id, title: id, note: '', noteDoc: null, projectId: 'inbox', parentId: null,
  goalId: null, noteId: null, status: 'active', pinned: false, priority: 0,
  dueDate: null, dueTime: null, recurrence: null, blockedBy: [], tags: [],
  order: 0, seriesId: null, createdAt: 0, updatedAt: 0, completedAt: null,
  ...over,
});

describe('tasksToMarkdown', () => {
  it('groups tasks under project headings as checklist lines', () => {
    const md = tasksToMarkdown([mk('a'), mk('b', { projectId: 'work' })], projects);
    expect(md).toContain('# Inbox');
    expect(md).toContain('# Work');
    expect(md).toContain('- [ ] a');
    expect(md).toContain('- [ ] b');
  });

  it('marks done tasks and puts them after open ones', () => {
    const md = tasksToMarkdown([mk('open'), mk('shut', { status: 'done' })], projects);
    expect(md.indexOf('- [ ] open')).toBeLessThan(md.indexOf('- [x] shut'));
  });

  it('sorts open tasks pinned-first', () => {
    const md = tasksToMarkdown([mk('plain'), mk('star', { pinned: true })], projects);
    expect(md.indexOf('- [ ] star')).toBeLessThan(md.indexOf('- [ ] plain'));
  });

  it('emits tags and a due date in the importer syntax', () => {
    const md = tasksToMarkdown([mk('x', { tags: ['home', 'daily'], dueDate: '2026-10-25' })], projects);
    expect(md).toContain('- [ ] x #home #daily 📅 2026-10-25');
  });

  it('indents subtasks two spaces per level', () => {
    const md = tasksToMarkdown([
      mk('parent'),
      mk('child', { parentId: 'parent' }),
      mk('grand', { parentId: 'child' }),
    ], projects);
    expect(md).toContain('\n  - [ ] child');
    expect(md).toContain('\n    - [ ] grand');
  });

  it('puts archived-project and orphaned tasks under Other', () => {
    const md = tasksToMarkdown([mk('orphan', { projectId: 'gone' }), mk('oldtask', { projectId: 'old' })], projects);
    expect(md).toContain('# Other');
    expect(md).toContain('- [ ] orphan');
    expect(md).toContain('- [ ] oldtask');
    expect(md).not.toContain('# Old');
  });

  it('round-trips through parseObsidianMd without losing core fields', () => {
    const md = tasksToMarkdown([
      mk('Write the report', { projectId: 'work', tags: ['work'], dueDate: '2026-10-25' }),
      mk('Sub item', { projectId: 'work', parentId: 'Write the report' }),
      mk('Old chore', { status: 'done' }),
    ], projects);
    const parsed = parseObsidianMd(md);
    expect(parsed.warnings).toEqual([]);
    const byTitle = new Map(parsed.tasks.map((t) => [t.title, t]));
    expect(byTitle.get('Write the report')).toMatchObject({ done: false, dueDate: '2026-10-25', tags: ['work'], project: 'Work', indent: 0 });
    expect(byTitle.get('Sub item')).toMatchObject({ project: 'Work', indent: 1 });
    expect(byTitle.get('Old chore')).toMatchObject({ done: true, project: 'Inbox' });
  });
});
