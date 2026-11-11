// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import HomeSettingsDialog from './HomeSettingsDialog';

describe('HomeSettingsDialog', () => {
  it('renders Home screen settings controls inside its dedicated dialog', () => {
    const html = renderToStaticMarkup(<HomeSettingsDialog onClose={vi.fn()} onBack={vi.fn()} />);

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Home screen settings"');
    expect(html).toContain('aria-label="Back to Settings"');
    expect(html).toContain('Reset defaults');
    expect(html).toContain('5/8 sections visible');

    // Backlog controls
    expect(html).toContain('aria-label="Backlog task order"');
    expect(html).toContain('Priority first, then oldest to newest');
    expect(html).toContain('Oldest to newest (FIFO)');
    expect(html).toContain('Priority first, then recently updated');
    expect(html).toContain('Recently updated first');
    expect(html).toContain('<strong>Surface backlog tasks</strong>');
    expect(html).toContain('aria-label="Ready tray task limit"');

    // Header & schedule switches
    expect(html).toContain('<strong>Greeting &amp; orientation</strong>');
    expect(html).toContain('<strong>Daily progress bar</strong>');
    expect(html).toContain('<strong>Completed today accordion</strong>');

    // Briefing sections
    expect(html).toContain('Today&#x27;s schedule');
    expect(html).toContain('Needs attention');
    expect(html).toContain('This week');
    expect(html).toContain('Goals');
  });

  it('omits Back button when opened without onBack', () => {
    const html = renderToStaticMarkup(<HomeSettingsDialog onClose={vi.fn()} />);
    expect(html).not.toContain('aria-label="Back to Settings"');
  });
});
