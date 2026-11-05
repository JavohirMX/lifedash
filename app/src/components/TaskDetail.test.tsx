// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TaskPriority from './TaskPriority';
import TaskDateField from './TaskDateField';
import TaskDelete from './TaskDelete';
import type { Task } from '../types';

describe('Task Detail Component Improvements', () => {
  it('TaskPriority renders an accessible segmented control with radiogroup', () => {
    const markup = renderToStaticMarkup(<TaskPriority id="test-1" priority={1} />);
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('Priority');
    expect(markup).toContain('role="radio"');
    expect(markup).toContain('P1');
    expect(markup).toContain('P2');
    expect(markup).toContain('P3');
    expect(markup).toContain('None');
    expect(markup).toContain('selected prio-opt-1');
  });

  it('TaskDateField renders quick presets for dueDate', () => {
    const markup = renderToStaticMarkup(
      <TaskDateField id="test-1" field="dueDate" value="2026-11-05" label="Due date" type="date" />
    );
    expect(markup).toContain('date-presets');
    expect(markup).toContain('Today');
    expect(markup).toContain('Tomorrow');
    expect(markup).toContain('Next Mon');
    expect(markup).toContain('Clear');
  });

  it('TaskDateField does not render presets for dueTime', () => {
    const markup = renderToStaticMarkup(
      <TaskDateField id="test-1" field="dueTime" value="14:00" label="Deadline time" type="time" />
    );
    expect(markup).not.toContain('date-presets');
    expect(markup).toContain('type="time"');
  });

  it('TaskDelete renders safe initial trigger and guards immediate deletion', () => {
    const sampleTask: Task = {
      id: 'task-1',
      title: 'Sample Task',
      status: 'active',
      priority: 0,
      projectId: 'inbox',
      parentId: null,
      goalId: null,
      noteId: null,
      order: 0,
      createdAt: 1000,
      updatedAt: 1000,
      completedAt: null,
      note: '',
      noteDoc: null,
      dueDate: null,
      dueTime: null,
      recurrence: null,
      pinned: false,
      blockedBy: [],
      tags: [],
      seriesId: null,
    };
    const markup = renderToStaticMarkup(<TaskDelete task={sampleTask} onClose={vi.fn()} />);
    expect(markup).toContain('Delete task');
    expect(markup).not.toContain('Confirm delete');
  });
});
