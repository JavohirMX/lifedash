// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SettingsView from './SettingsView';

describe('SettingsView', () => {
  const defaultProps = {
    onSync: vi.fn(),
    onDataBackup: vi.fn(),
    onAppearance: vi.fn(),
    onAiSettings: vi.fn(),
    onGoogleCalendar: vi.fn(),
    onAgentKeys: vi.fn(),
    onShortcuts: vi.fn(),
    onAutomation: vi.fn(),
    onImport: vi.fn(),
    onRestore: vi.fn(),
    reminders: 'on' as const,
    onToggleReminders: vi.fn(),
    journalNudge: true,
    onToggleJournalNudge: vi.fn(),
    tvDashboard: true,
    onToggleTvDashboard: vi.fn(),
  };

  it('renders all primary section headers and search nav bar', () => {
    const html = renderToStaticMarkup(<SettingsView {...defaultProps} />);

    expect(html).toContain('Settings');
    expect(html).toContain('Appearance &amp; Display');
    expect(html).toContain('Sync &amp; Integrations');
    expect(html).toContain('AI &amp; Automation');
    expect(html).toContain('Data &amp; Storage');
    expect(html).toContain('Notifications');
    expect(html).toContain('Device &amp; Storage');

    // Verify search input and category pills
    expect(html).toContain('placeholder="Filter settings…"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('Appearance &amp; Display</button>');
    expect(html).toContain('Sync &amp; Integrations</button>');
  });

  it('renders key accessible buttons with expected labels and attributes', () => {
    const html = renderToStaticMarkup(<SettingsView {...defaultProps} />);

    // Appearance & Shortcuts
    expect(html).toContain('<strong>Appearance</strong>');
    expect(html).toContain('<small>Style, mode, fonts and wallpaper</small>');
    expect(html).toContain('<strong>Keyboard shortcuts</strong>');
    expect(html).toContain('<strong>Automation &amp; rules</strong>');

    // Sync & Keys
    expect(html).toContain('<strong>Sync</strong>');
    expect(html).toContain('<small>Connect to your self-hosted server</small>');
    expect(html).toContain('<strong>Agent API keys</strong>');

    // Data, Restore & Exports
    expect(html).toContain('<strong>Data &amp; backups</strong>');
    expect(html).toContain('<strong>Restore backup</strong>');
    expect(html).toContain('<strong>Export JSON backup</strong>');
    expect(html).toContain('<strong>Export Markdown</strong>');
    expect(html).toContain('<strong>Export calendar (.ics)</strong>');

    // Reminders & Journal Nudge with switches
    expect(html).toContain('<strong>Reminders</strong>');
    expect(html).toContain('settings-switch-visual on');
    expect(html).toContain('<strong>Journal nudge</strong>');
    expect(html).toContain('<strong>TV dashboard</strong>');
    expect(html).toContain('Full-screen kiosk display for ambient monitors and wall screens');
    expect(html).toContain('Local-first');
  });

  it('renders disabled switch visual when reminders and tv dashboard are off', () => {
    const html = renderToStaticMarkup(
      <SettingsView {...defaultProps} reminders="off" journalNudge={false} tvDashboard={false} />
    );
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('settings-switch-visual ');
    expect(html).toContain('data-active="false"');
  });
});
