// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CaptureDialog from './CaptureDialog';
import type { Project } from '../types';

const sampleProjects: Project[] = [
  { id: 'inbox', name: 'Inbox', color: '#0f766e', order: 0, archived: false, parentId: null },
  { id: 'proj-1', name: 'Work', color: '#2563eb', order: 1, archived: false, parentId: null },
  { id: 'proj-2', name: 'Personal', color: '#b45309', order: 2, archived: false, parentId: null },
];

describe('CaptureDialog Component', () => {
  it('renders modal with dialog role, header, and close button when open', () => {
    const markup = renderToStaticMarkup(
      <CaptureDialog open={true} projects={sampleProjects} onClose={vi.fn()} />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-label="Capture task"');
    expect(markup).toContain('<h2>Capture task</h2>');
    expect(markup).toContain('aria-label="Close capture"');
  });

  it('is hidden when open is false', () => {
    const markup = renderToStaticMarkup(
      <CaptureDialog open={false} projects={sampleProjects} onClose={vi.fn()} />,
    );

    expect(markup).toContain('style="display:none"');
  });

  it('renders rich task controls: title, project select, date chips, and priority chips', () => {
    const markup = renderToStaticMarkup(
      <CaptureDialog open={true} projects={sampleProjects} onClose={vi.fn()} />,
    );

    // Title input
    expect(markup).toContain('id="');
    expect(markup).toContain('placeholder="e.g. Review budget tomorrow 6pm +work #home p1"');

    // Project select & chips
    expect(markup).toContain('aria-label="Capture project"');
    expect(markup).toContain('aria-label="Quick project"');
    expect(markup).toContain('Work');
    expect(markup).toContain('Personal');

    // Due date input & chips
    expect(markup).toContain('aria-label="Capture due date"');
    expect(markup).toContain('aria-label="Quick due date"');
    expect(markup).toContain('Today');
    expect(markup).toContain('Tomorrow');
    expect(markup).toContain('No date');
    expect(markup).toContain('Use parsed date');

    // Priority chips
    expect(markup).toContain('aria-label="Priority"');
    expect(markup).toContain('P1');
    expect(markup).toContain('P2');
    expect(markup).toContain('P3');

    // Preview
    expect(markup).toContain('aria-label="Task preview"');
    expect(markup).toContain('<strong>Will add</strong>');

    // Footer actions
    expect(markup).toContain('class="btn-secondary capture-done-btn"');
    expect(markup).toContain('Done');
    expect(markup).toContain('class="btn-primary quick-add-submit"');
    expect(markup).toContain('Add');

    // Autocomplete disabled and no suggestion pills row
    expect(markup).toContain('autoComplete="off"');
    expect(markup).not.toContain('class="qa-suggest-pill"');
  });
});
