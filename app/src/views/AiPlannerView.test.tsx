import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AiPlannerView from './AiPlannerView';
import type { Task } from '../types';

describe('AiPlannerView', () => {
  const sampleTasks: Task[] = [
    {
      id: 'task-1',
      title: 'Finish monthly report',
      status: 'active',
      projectId: 'proj-1',
      priority: 1,
      dueDate: '2026-11-15',
      dueTime: null,
      plannedDate: null,
      plannedTime: null,
      durationMinutes: null,
      tags: ['work'],
      note: '',
      noteDoc: null,
      parentId: null,
      goalId: null,
      noteId: null,
      seriesId: null,
      blockedBy: [],
      order: 0,
      createdAt: 1000,
      updatedAt: 1000,
      completedAt: null,
      recurrence: null,
      pinned: false,
    },
    {
      id: 'task-2',
      title: 'Buy groceries',
      status: 'active',
      projectId: 'inbox',
      priority: 0,
      dueDate: null,
      dueTime: null,
      plannedDate: null,
      plannedTime: null,
      durationMinutes: null,
      tags: ['personal'],
      note: '',
      noteDoc: null,
      parentId: null,
      goalId: null,
      noteId: null,
      seriesId: null,
      blockedBy: [],
      order: 1,
      createdAt: 2000,
      updatedAt: 2000,
      completedAt: null,
      recurrence: null,
      pinned: false,
    },
  ];

  it('renders Plan with AI page header, prompt presets, task picker, and ready state', () => {
    const html = renderToStaticMarkup(
      <AiPlannerView
        tasks={sampleTasks}
        onNavigate={vi.fn()}
        onOpenAiSettings={vi.fn()}
      />
    );

    // Header & badge
    expect(html).toContain('Plan with AI');
    expect(html).toContain('Configure AI');

    // Presets
    expect(html).toContain('Prioritize tasks');
    expect(html).toContain('Plan day schedule');
    expect(html).toContain('Find bottlenecks');
    expect(html).toContain('Suggest subtasks');

    // Tasks list
    expect(html).toContain('Finish monthly report');
    expect(html).toContain('Buy groceries');

    // Empty ready state
    expect(html).toContain('Ready to build your plan');
  });
});
