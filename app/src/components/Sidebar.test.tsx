// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Sidebar, { type Selection } from './Sidebar';
import type { Project } from '../types';

const sampleProjects: Project[] = [
  { id: 'proj-1', name: 'Work', color: '#2563eb', order: 0, archived: false, parentId: null },
  { id: 'proj-2', name: 'Lifedash', color: '#0f766e', order: 1, archived: false, parentId: 'proj-1' },
  { id: 'proj-3', name: 'Personal', color: '#b45309', order: 2, archived: false, parentId: null },
];

describe('Sidebar UI/UX Improvements', () => {
  it('renders active state with aria-current="page" on selected nav item', () => {
    const markup = renderToStaticMarkup(
      <Sidebar
        projects={sampleProjects}
        selection={{ kind: 'today' }}
        onSelect={vi.fn()}
        counts={{ today: 5, backlog: 12 }}
        activeByProject={{ 'proj-1': 3, 'proj-2': 2 }}
        onAutomation={vi.fn()}
        journalNudge={false}
        onToggleJournalNudge={vi.fn()}
        onSync={vi.fn()}
        reminders="off"
        onToggleReminders={vi.fn()}
        onAppearance={vi.fn()}
        onSettings={vi.fn()}
        onPalette={vi.fn()}
        onCapture={vi.fn()}
      />
    );

    // Active item has .active and aria-current="page"
    expect(markup).toContain('class="nav active "');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('Today');
    expect(markup).toContain('5'); // Today count
    expect(markup).toContain('12'); // Backlog count
  });

  it('renders project tree with nesting and quick add subproject button', () => {
    const markup = renderToStaticMarkup(
      <Sidebar
        projects={sampleProjects}
        selection={{ kind: 'project', id: 'proj-2' }}
        onSelect={vi.fn()}
        counts={{ today: 0, backlog: 0 }}
        activeByProject={{ 'proj-1': 1, 'proj-2': 4 }}
        onAutomation={vi.fn()}
        journalNudge={false}
        onToggleJournalNudge={vi.fn()}
        onSync={vi.fn()}
        reminders="off"
        onToggleReminders={vi.fn()}
        onAppearance={vi.fn()}
        onSettings={vi.fn()}
      />
    );

    // proj-1 has children (proj-2), so it renders the tree collapse toggle
    expect(markup).toContain('project-tree-toggle');
    expect(markup).toContain('Collapse subprojects of Work');

    // proj-2 is nested, so it renders nested styling
    expect(markup).toContain('project-row-wrap nested');

    // proj-2 is selected
    expect(markup).toContain('aria-label="Project: Lifedash" aria-current="page"');

    // Quick add subproject button
    expect(markup).toContain('Add subproject inside Work');
    expect(markup).toContain('Add subproject inside Lifedash');
  });

  it('renders desktop resizer element on sidebar', () => {
    const markup = renderToStaticMarkup(
      <Sidebar
        projects={sampleProjects}
        selection={{ kind: 'home' }}
        onSelect={vi.fn()}
        counts={{ today: 0, backlog: 0 }}
        onAutomation={vi.fn()}
        journalNudge={false}
        onToggleJournalNudge={vi.fn()}
        onSync={vi.fn()}
        reminders="off"
        onToggleReminders={vi.fn()}
        onAppearance={vi.fn()}
        onSettings={vi.fn()}
      />
    );

    expect(markup).toContain('class="sidebar-resizer"');
    expect(markup).toContain('title="Drag to resize sidebar, double-click to reset"');
    expect(markup).toContain('role="separator"');
  });

  it('renders search shortcut badge when onPalette is provided', () => {
    const markup = renderToStaticMarkup(
      <Sidebar
        projects={sampleProjects}
        selection={{ kind: 'home' }}
        onSelect={vi.fn()}
        counts={{ today: 0, backlog: 0 }}
        onAutomation={vi.fn()}
        journalNudge={false}
        onToggleJournalNudge={vi.fn()}
        onSync={vi.fn()}
        reminders="off"
        onToggleReminders={vi.fn()}
        onAppearance={vi.fn()}
        onSettings={vi.fn()}
        onPalette={vi.fn()}
      />
    );

    expect(markup).toContain('class="search-shortcut-badge"');
    expect(markup).toContain('Command palette');
  });

  it('renders mobile sheet handle and bottom dock', () => {
    const markup = renderToStaticMarkup(
      <Sidebar
        projects={sampleProjects}
        selection={{ kind: 'home' }}
        onSelect={vi.fn()}
        counts={{ today: 3, backlog: 1 }}
        onAutomation={vi.fn()}
        journalNudge={false}
        onToggleJournalNudge={vi.fn()}
        onSync={vi.fn()}
        reminders="off"
        onToggleReminders={vi.fn()}
        onAppearance={vi.fn()}
        onSettings={vi.fn()}
      />
    );

    expect(markup).toContain('class="bottombar"');
    expect(markup).toContain('class="mobile-topbar"');
  });

  it('renders capture task button as a distinct primary action button with shortcut badge', () => {
    const markup = renderToStaticMarkup(
      <Sidebar
        projects={sampleProjects}
        selection={{ kind: 'home' }}
        onSelect={vi.fn()}
        counts={{ today: 0, backlog: 0 }}
        onAutomation={vi.fn()}
        journalNudge={false}
        onToggleJournalNudge={vi.fn()}
        onSync={vi.fn()}
        reminders="off"
        onToggleReminders={vi.fn()}
        onAppearance={vi.fn()}
        onSettings={vi.fn()}
        onCapture={vi.fn()}
      />
    );

    // Primary button styling, distinct from input
    expect(markup).toContain('class="sidebar-capture btn-primary"');
    expect(markup).toContain('aria-label="Capture task"');
    expect(markup).toContain('class="sidebar-capture-kbd"');
    expect(markup).toContain('>n</kbd>');
  });

  it('hides TV dashboard button when tvEnabled is false or omitted', () => {
    const markup = renderToStaticMarkup(
      <Sidebar
        projects={sampleProjects}
        selection={{ kind: 'home' }}
        onSelect={vi.fn()}
        counts={{ today: 0, backlog: 0 }}
        onAutomation={vi.fn()}
        journalNudge={false}
        onToggleJournalNudge={vi.fn()}
        onSync={vi.fn()}
        reminders="off"
        onToggleReminders={vi.fn()}
        onAppearance={vi.fn()}
        onSettings={vi.fn()}
      />
    );
    expect(markup).not.toContain('TV dashboard');
  });

  it('renders TV dashboard button when tvEnabled is true', () => {
    const markup = renderToStaticMarkup(
      <Sidebar
        projects={sampleProjects}
        selection={{ kind: 'home' }}
        onSelect={vi.fn()}
        counts={{ today: 0, backlog: 0 }}
        onAutomation={vi.fn()}
        journalNudge={false}
        onToggleJournalNudge={vi.fn()}
        onSync={vi.fn()}
        reminders="off"
        onToggleReminders={vi.fn()}
        onAppearance={vi.fn()}
        onSettings={vi.fn()}
        tvEnabled={true}
      />
    );
    expect(markup).toContain('TV dashboard');
  });
});
