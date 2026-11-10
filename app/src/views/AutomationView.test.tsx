import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AutomationView from './AutomationView';
import type { AutomationRules, UserRule } from '../automation';
import type { Project } from '../types';

describe('AutomationView', () => {
  const sampleProjects: Project[] = [
    { id: 'proj-1', name: 'Work', color: '#0f766e', order: 0, archived: false },
    { id: 'proj-2', name: 'Personal', color: '#2563eb', order: 1, archived: false },
  ];

  const sampleRules: AutomationRules = {
    rollover: true,
    completeParent: false,
  };

  const sampleUserRules: UserRule[] = [
    {
      id: 'ur-1',
      trigger: { kind: 'tag', tag: 'urgent' },
      title: 'Follow up on urgent task',
      projectId: 'proj-1',
      pinned: true,
      createdAt: 1000,
      lastFired: null,
    },
    {
      id: 'ur-2',
      trigger: { kind: 'weekly', weekday: 1 }, // Monday
      title: 'Weekly planning review',
      projectId: null,
      pinned: false,
      createdAt: 2000,
      lastFired: null,
    },
  ];

  it('renders system rules and custom rules correctly', () => {
    const html = renderToStaticMarkup(
      <AutomationView
        rules={sampleRules}
        onChange={vi.fn()}
        userRules={sampleUserRules}
        onUserRulesChange={vi.fn()}
        projects={sampleProjects}
      />
    );

    // Header and section titles
    expect(html).toContain('Automation');
    expect(html).toContain('System Rules');
    expect(html).toContain('Custom Rules');

    // System rule switches
    expect(html).toContain('Roll overdue tasks into Today');
    expect(html).toContain('Complete parents automatically');

    // Custom user rules
    expect(html).toContain('Follow up on urgent task');
    expect(html).toContain('#urgent');
    expect(html).toContain('Weekly planning review');
    expect(html).toContain('Monday');

    // Add rule form
    expect(html).toContain('New Automation Rule');
    expect(html).toContain('Task to Create');
    expect(html).toContain('Destination Project');
  });

  it('renders failure notices when flags are passed', () => {
    const html = renderToStaticMarkup(
      <AutomationView
        weeklyFailed={true}
        rolloverFailed={true}
        rules={sampleRules}
        onChange={vi.fn()}
        userRules={[]}
        onUserRulesChange={vi.fn()}
        projects={sampleProjects}
      />
    );

    expect(html).toContain('finish running weekly rules');
    expect(html).toContain('finish moving overdue tasks to Today');
    expect(html).toContain('No custom rules yet');
  });
});
