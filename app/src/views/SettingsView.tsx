import { useEffect, useRef, useState, useMemo } from 'react';
import {
  Palette,
  Bell,
  BookOpen,
  KeyRound,
  Upload,
  Download,
  FileJson,
  FileText,
  CalendarDays,
  Sparkles,
  Search,
  X,
  Keyboard,
  SlidersHorizontal,
  HardDrive,
  RefreshCw,
  ChevronRight,
  ShieldCheck,
  Check,
  Laptop,
  AlertCircle,
  Database,
  Loader2,
  Monitor,
} from 'lucide-react';
import '../components/settings.css';
import { STYLES, getStyle, getTheme } from '../theme';
import { PageHeader, EmptyState } from '../components/Page';
import { db } from '../db';
import { exportJson, countAttachments } from '../repo';
import { tasksToMarkdown } from '../exportMd';
import { tasksToIcs } from '../ics';
import { todayStr } from '../dates';
import { useAiSettings, AI_PRESETS } from '../ai/aiSettings';
import { loadSyncSettings } from '../sync';
import { getDeviceId, getDeviceLabel } from '../deviceSettings';

type SettingsCategory = 'all' | 'display' | 'sync' | 'ai' | 'data' | 'notifications';

const CATEGORIES: { id: SettingsCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'display', label: 'Appearance & Display' },
  { id: 'sync', label: 'Sync & Integrations' },
  { id: 'ai', label: 'AI & Automation' },
  { id: 'data', label: 'Data & Storage' },
  { id: 'notifications', label: 'Notifications' },
];

export default function SettingsView(props: {
  onSync: () => void;
  onDataBackup?: () => void;
  onAppearance: () => void;
  onAiSettings?: () => void;
  onGoogleCalendar?: () => void;
  onWebcal?: () => void;
  onAgentKeys?: () => void;
  onShortcuts?: () => void;
  onAutomation?: () => void;
  onImport: () => void;
  onRestore: () => void;
  reminders: 'on' | 'off' | 'blocked' | 'unsupported' | 'needs-permission';
  onToggleReminders: () => void;
  notificationError?: string;
  notificationBusy?: boolean;
  journalNudge: boolean;
  onToggleJournalNudge: () => void;
  tvDashboard?: boolean;
  onToggleTvDashboard?: () => void;
}) {
  const remindersAvailable = props.reminders === 'on';
  const reminderLabel =
    props.reminders === 'blocked'
      ? 'Blocked'
      : props.reminders === 'unsupported'
      ? 'Unavailable'
      : props.reminders === 'needs-permission'
      ? 'Permission needed'
      : remindersAvailable
      ? 'On'
      : 'Off';
  const nudgeLabel = !remindersAvailable && props.journalNudge ? 'Paused' : props.journalNudge ? 'On' : 'Off';

  const aiSettings = useAiSettings();
  const aiPreset = AI_PRESETS.find((p) => p.id === aiSettings.preset);
  const syncSettings = loadSyncSettings();
  const deviceLabel = getDeviceLabel();
  const deviceId = getDeviceId();
  const currentStyle = STYLES.find((s) => s.id === getStyle());

  // UI state for search and filtering
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('all');

  // Local storage counts
  const [dbCounts, setDbCounts] = useState<{
    tasks: number;
    projects: number;
    notes: number;
    habits: number;
    attachments: number;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      db.tasks.count(),
      db.projects.count(),
      db.notes.count(),
      db.habits.count(),
      db.attachments.count(),
    ])
      .then(([tasks, projects, notes, habits, attachments]) => {
        if (mounted) setDbCounts({ tasks, projects, notes, habits, attachments });
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  // Export handlers and feedback banner
  const exporting = useRef(false);
  const [exportBusy, setExportBusy] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);

  const downloadFile = (content: string, type: string, name: string) => {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  async function exportData(format: 'JSON' | 'Markdown' | 'Calendar') {
    if (exporting.current) return;
    exporting.current = true;
    setExportBusy(format);
    setExportNotice(null);
    try {
      if (format === 'JSON') {
        const [json, files] = await Promise.all([exportJson(), countAttachments()]);
        downloadFile(json, 'application/json', `lifedash-export-${new Date().toISOString().slice(0, 10)}.json`);
        if (files > 0) {
          setExportNotice({
            type: 'warning',
            message: `JSON backup downloaded. Note: ${files} attachment file${files === 1 ? ' stays' : 's stay'} on this device — the export keeps their names and metadata.`,
          });
        } else {
          setExportNotice({
            type: 'success',
            message: 'JSON backup downloaded successfully.',
          });
        }
      } else {
        const [tasks, projects] = await Promise.all([db.tasks.toArray(), db.projects.toArray()]);
        if (format === 'Markdown') {
          downloadFile(tasksToMarkdown(tasks, projects), 'text/markdown', `lifedash-tasks-${todayStr()}.md`);
          setExportNotice({
            type: 'success',
            message: 'Markdown task file downloaded successfully.',
          });
        } else {
          downloadFile(tasksToIcs(tasks, projects), 'text/calendar', `lifedash-tasks-${todayStr()}.ics`);
          setExportNotice({
            type: 'success',
            message: 'Calendar (.ics) export downloaded successfully.',
          });
        }
      }
    } catch {
      setExportNotice({
        type: 'error',
        message: `Couldn't prepare the ${format} export. Choose ${format} again.`,
      });
    } finally {
      exporting.current = false;
      setExportBusy(null);
    }
  }

  // Filter helper: check if query matches keyword tokens
  const q = searchQuery.trim().toLowerCase();
  const matches = (terms: (string | undefined)[]) => {
    if (!q) return true;
    return terms.some((t) => t && t.toLowerCase().includes(q));
  };

  // Section visibility checks
  const showDisplay =
    (activeCategory === 'all' || activeCategory === 'display') &&
    matches(['appearance', 'style', 'mode', 'theme', 'font', 'wallpaper', 'dark mode', 'keyboard', 'shortcuts', 'hotkeys', 'tv', 'kiosk', 'dashboard']);

  const showSync =
    (activeCategory === 'all' || activeCategory === 'sync') &&
    matches(['sync', 'server', 'self-host', 'cloud', 'google calendar', 'events', 'agent', 'api keys', 'token', 'keys']);

  const showAi =
    (activeCategory === 'all' || activeCategory === 'ai') &&
    matches(['ai', 'artificial intelligence', 'assistant', 'ollama', 'openai', 'anthropic', 'model', 'automation', 'rules', 'rollover']);

  const showData =
    (activeCategory === 'all' || activeCategory === 'data') &&
    matches(['data', 'backup', 'backups', 'portable', 'storage', 'import', 'restore', 'export', 'json', 'markdown', 'calendar', 'ics']);

  const showNotifications =
    (activeCategory === 'all' || activeCategory === 'notifications') &&
    matches(['notifications', 'reminders', 'nudge', 'journal', 'alerts', 'due']);

  const showAbout =
    activeCategory === 'all' &&
    matches(['device', 'storage', 'privacy', 'indexeddb', 'about', 'local-first', 'counts']);

  const hasAnyResults = showDisplay || showSync || showAi || showData || showNotifications || showAbout;

  return (
    <section className="settings-page settings-scope" aria-label="Settings">
      <PageHeader
        title="Settings"
        description="Connection, data, display, intelligence, and notifications for this device."
      />

      {/* Quick Search & Category Filters */}
      <div className="settings-nav-bar">
        <div className="settings-search-wrap">
          <Search size={16} className="settings-search-icon" aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter settings…"
            className="settings-search-input"
            aria-label="Filter settings"
          />
          {searchQuery && (
            <button
              type="button"
              className="settings-search-clear"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {!searchQuery && (
          <div className="settings-category-tabs" role="tablist" aria-label="Settings categories">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                role="tab"
                aria-selected={activeCategory === cat.id}
                className={`settings-tab-pill ${activeCategory === cat.id ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat.id)}
              >
                {cat.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!hasAnyResults && (
        <EmptyState
          action={
            <button
              className="btn btn-secondary"
              onClick={() => {
                setSearchQuery('');
                setActiveCategory('all');
              }}
            >
              Show all settings
            </button>
          }
        >
          No settings match &ldquo;{searchQuery}&rdquo;.
        </EmptyState>
      )}

      {/* 1. Appearance & Display */}
      {showDisplay && (
        <div className="settings-card-group">
          <div className="settings-card-header">
            <h3>Appearance &amp; Display</h3>
            <span className="settings-card-subtitle">Visual theme, typography, shortcuts and wallpaper</span>
          </div>
          <div className="settings-card">
            {matches(['appearance', 'style', 'mode', 'theme', 'font', 'wallpaper', 'dark mode']) && (
              <button className="settings-row" onClick={props.onAppearance}>
                <div className="settings-icon-box" aria-hidden="true">
                  <Palette size={18} />
                </div>
                <span className="settings-row-main">
                  <strong>Appearance</strong>
                  <small>Style, mode, fonts and wallpaper</small>
                  <small className="settings-current-appearance" aria-hidden="true">
                    {currentStyle?.name} · {getTheme() === 'system' ? 'System mode' : `${getTheme()} mode`}
                  </small>
                </span>
                <span className="settings-row-action" aria-hidden="true">
                  <span className="settings-pill-badge">
                    {currentStyle?.name} · {getTheme() === 'system' ? 'System' : getTheme()}
                  </span>
                  <ChevronRight size={16} />
                </span>
              </button>
            )}

            {props.onShortcuts && matches(['keyboard', 'shortcuts', 'hotkeys']) && (
              <button className="settings-row" onClick={props.onShortcuts}>
                <div className="settings-icon-box" aria-hidden="true">
                  <Keyboard size={18} />
                </div>
                <span className="settings-row-main">
                  <strong>Keyboard shortcuts</strong>
                  <small>Hotkeys for navigation, rapid capture, search and editing</small>
                </span>
                <span className="settings-row-action" aria-hidden="true">
                  <span className="settings-shortcut-hint">? / F1</span>
                  <ChevronRight size={16} />
                </span>
              </button>
            )}

            {props.onToggleTvDashboard && matches(['tv', 'kiosk', 'dashboard', 'ambient', 'wall', 'screen']) && (
              <div className="settings-row-wrap">
                <button
                  className="settings-row settings-toggle-row"
                  aria-describedby="settings-tv-help"
                  aria-pressed={props.tvDashboard ?? false}
                  onClick={props.onToggleTvDashboard}
                >
                  <div className="settings-icon-box" aria-hidden="true">
                    <Monitor size={18} />
                  </div>
                  <span className="settings-row-main">
                    <strong>TV dashboard</strong>
                    <small>Full-screen kiosk display for ambient monitors and wall screens</small>
                  </span>
                  <span className="settings-row-action" aria-hidden="true">
                    <span className={`settings-switch-visual ${props.tvDashboard ? 'on' : ''}`}>
                      <span className="settings-switch-thumb" />
                    </span>
                    <span className="settings-state" data-active={props.tvDashboard ?? false}>
                      {props.tvDashboard ? 'On' : 'Off'}
                    </span>
                  </span>
                </button>
                <p id="settings-tv-help" className="settings-help settings-state-help">
                  {props.tvDashboard
                    ? 'TV dashboard is active and visible under Tools in the sidebar.'
                    : 'Turn on to show TV dashboard in the sidebar and enable kiosk mode.'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. Sync & Integrations */}
      {showSync && (
        <div className="settings-card-group">
          <div className="settings-card-header">
            <h3>Sync &amp; Integrations</h3>
            <span className="settings-card-subtitle">Server connection, calendar overlays and agent API keys</span>
          </div>
          <div className="settings-card">
            {matches(['sync', 'server', 'self-host', 'cloud']) && (
              <button className="settings-row" onClick={props.onSync}>
                <div className="settings-icon-box" aria-hidden="true">
                  <RefreshCw size={18} />
                </div>
                <span className="settings-row-main">
                  <strong>Sync</strong>
                  <small>Connect to your self-hosted server</small>
                </span>
                <span className="settings-row-action" aria-hidden="true">
                  <span className={`settings-pill-badge ${syncSettings ? 'active' : ''}`}>
                    {syncSettings ? 'Connected' : 'Local only'}
                  </span>
                  <ChevronRight size={16} />
                </span>
              </button>
            )}

            {props.onGoogleCalendar && matches(['google calendar', 'events', 'calendar']) && (
              <button className="settings-row" onClick={props.onGoogleCalendar}>
                <div className="settings-icon-box" aria-hidden="true">
                  <CalendarDays size={18} />
                </div>
                <span className="settings-row-main">
                  <strong>Google Calendar</strong>
                  <small>Optional read-only events, using your self-hosted server</small>
                </span>
                <span className="settings-row-action" aria-hidden="true">
                  <ChevronRight size={16} />
                </span>
              </button>
            )}

            {props.onWebcal && matches(['webcal', 'ics', 'calendar feeds', 'subscriptions', 'calendar']) && (
              <button className="settings-row" onClick={props.onWebcal}>
                <div className="settings-icon-box" aria-hidden="true">
                  <CalendarDays size={18} />
                </div>
                <span className="settings-row-main">
                  <strong>Calendar Feeds (Webcal / ICS)</strong>
                  <small>Subscribe to any Google, Apple, or Outlook calendar via .ics link</small>
                </span>
                <span className="settings-row-action" aria-hidden="true">
                  <ChevronRight size={16} />
                </span>
              </button>
            )}

            {props.onAgentKeys && matches(['agent', 'api keys', 'token', 'keys']) && (
              <button className="settings-row" onClick={props.onAgentKeys}>
                <div className="settings-icon-box" aria-hidden="true">
                  <KeyRound size={18} />
                </div>
                <span className="settings-row-main">
                  <strong>Agent API keys</strong>
                  <small>Let AI agents read or change your data through your server</small>
                </span>
                <span className="settings-row-action" aria-hidden="true">
                  <ChevronRight size={16} />
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3. AI & Automation */}
      {showAi && (
        <div className="settings-card-group">
          <div className="settings-card-header">
            <h3>AI &amp; Automation</h3>
            <span className="settings-card-subtitle">Local or cloud intelligence and background workflows</span>
          </div>
          <div className="settings-card">
            {props.onAiSettings && matches(['ai', 'artificial intelligence', 'assistant', 'ollama', 'openai', 'anthropic', 'model']) && (
              <button className="settings-row" onClick={props.onAiSettings}>
                <div className="settings-icon-box" aria-hidden="true">
                  <Sparkles size={18} />
                </div>
                <span className="settings-row-main">
                  <strong>AI features</strong>
                  <small>{aiSettings.enabled ? `${aiPreset?.name || 'Custom'} · ${aiSettings.model || 'Configured'}` : 'Turned off for this device'}</small>
                </span>
                <span className="settings-row-action" aria-hidden="true">
                  <span className="settings-state" data-active={aiSettings.enabled}>{aiSettings.enabled ? 'On' : 'Off'}</span>
                  <ChevronRight size={16} />
                </span>
              </button>
            )}

            {props.onAutomation && matches(['automation', 'rules', 'rollover', 'cleanup']) && (
              <button className="settings-row" onClick={props.onAutomation}>
                <div className="settings-icon-box" aria-hidden="true">
                  <SlidersHorizontal size={18} />
                </div>
                <span className="settings-row-main">
                  <strong>Automation &amp; rules</strong>
                  <small>Task rollover rules, weekly cleanup and recurring automation</small>
                </span>
                <span className="settings-row-action" aria-hidden="true">
                  <ChevronRight size={16} />
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 4. Data & Storage */}
      {showData && (
        <div className="settings-card-group">
          <div className="settings-card-header">
            <h3>Data &amp; Storage</h3>
            <span className="settings-card-subtitle">Local storage backups, task imports and format exports</span>
          </div>

          {exportNotice && (
            <div className={`settings-notice settings-notice-${exportNotice.type}`} role={exportNotice.type === 'error' ? 'alert' : 'status'}>
              <div className="settings-notice-icon">
                {exportNotice.type === 'error' ? <AlertCircle size={16} /> : exportNotice.type === 'warning' ? <AlertCircle size={16} /> : <Check size={16} />}
              </div>
              <div className="settings-notice-text">{exportNotice.message}</div>
              <button type="button" className="settings-notice-dismiss" onClick={() => setExportNotice(null)} aria-label="Dismiss notice">
                <X size={14} />
              </button>
            </div>
          )}

          <div className="settings-card">
            {props.onDataBackup && matches(['data & backups', 'data', 'backup', 'portable', 'device status']) && (
              <button className="settings-row" onClick={props.onDataBackup}>
                <div className="settings-icon-box" aria-hidden="true">
                  <HardDrive size={18} />
                </div>
                <span className="settings-row-main">
                  <strong>Data &amp; backups</strong>
                  <small>Device status and complete portable backup</small>
                </span>
                <span className="settings-row-action" aria-hidden="true">
                  <ChevronRight size={16} />
                </span>
              </button>
            )}

            {matches(['restore backup', 'restore', 'backup']) && (
              <button className="settings-row" onClick={props.onRestore}>
                <div className="settings-icon-box" aria-hidden="true">
                  <Upload size={18} />
                </div>
                <span className="settings-row-main">
                  <strong>Restore backup</strong>
                  <small>Merge a Lifedash backup file into this device</small>
                </span>
                <span className="settings-row-action" aria-hidden="true">
                  <ChevronRight size={16} />
                </span>
              </button>
            )}

            {matches(['import', 'tasks', 'todoist', 'markdown', 'reminders']) && (
              <button className="settings-row" onClick={props.onImport}>
                <div className="settings-icon-box" aria-hidden="true">
                  <Upload size={18} />
                </div>
                <span className="settings-row-main">
                  <strong>Import</strong>
                  <small>Bring tasks in from another app or file</small>
                </span>
                <span className="settings-row-action" aria-hidden="true">
                  <ChevronRight size={16} />
                </span>
              </button>
            )}

            {matches(['export json backup', 'export', 'json', 'backup']) && (
              <button className="settings-row" disabled={exportBusy !== null} onClick={() => void exportData('JSON')}>
                <div className="settings-icon-box" aria-hidden="true">
                  <FileJson size={18} />
                </div>
                <span className="settings-row-main">
                  <strong>Export JSON backup</strong>
                  <small>App data and attachment metadata; files stay on this device</small>
                </span>
                <span className="settings-row-action" aria-hidden="true">
                  {exportBusy === 'JSON' ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
                </span>
              </button>
            )}

            {matches(['export markdown', 'export', 'markdown', 'md']) && (
              <button className="settings-row" disabled={exportBusy !== null} onClick={() => void exportData('Markdown')}>
                <div className="settings-icon-box" aria-hidden="true">
                  <FileText size={18} />
                </div>
                <span className="settings-row-main">
                  <strong>Export Markdown</strong>
                  <small>Tasks only, readable anywhere</small>
                </span>
                <span className="settings-row-action" aria-hidden="true">
                  {exportBusy === 'Markdown' ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
                </span>
              </button>
            )}

            {matches(['export calendar', 'calendar', 'ics', 'export']) && (
              <button className="settings-row" disabled={exportBusy !== null} onClick={() => void exportData('Calendar')}>
                <div className="settings-icon-box" aria-hidden="true">
                  <CalendarDays size={18} />
                </div>
                <span className="settings-row-main">
                  <strong>Export calendar (.ics)</strong>
                  <small>Open dated tasks; calendar import file, not live sync</small>
                </span>
                <span className="settings-row-action" aria-hidden="true">
                  {exportBusy === 'Calendar' ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 5. Notifications */}
      {showNotifications && (
        <div className="settings-card-group">
          <div className="settings-card-header">
            <h3>Notifications</h3>
            <span className="settings-card-subtitle">Active alerts and evening journal reflection prompts</span>
          </div>

          {props.notificationBusy && <p className="settings-status-line" role="status">Checking notification permission…</p>}
          {props.notificationError && <p className="form-save-error" role="alert">{props.notificationError}</p>}
          <p className="settings-help">Notifications only arrive while Lifedash is open on this device.</p>

          <div className="settings-card">
            {matches(['reminders', 'notifications', 'timed task', 'due']) && (
              <div className="settings-row-wrap">
                <button
                  className="settings-row settings-toggle-row"
                  aria-describedby="settings-reminder-help"
                  aria-pressed={remindersAvailable}
                  disabled={props.notificationBusy || props.reminders === 'blocked' || props.reminders === 'unsupported'}
                  onClick={props.onToggleReminders}
                >
                  <div className="settings-icon-box" aria-hidden="true">
                    <Bell size={18} />
                  </div>
                  <span className="settings-row-main">
                    <strong>Reminders</strong>
                    <small>Notify me when a timed task is due.</small>
                  </span>
                  <span className="settings-row-action" aria-hidden="true">
                    <span className={`settings-switch-visual ${remindersAvailable ? 'on' : ''}`}>
                      <span className="settings-switch-thumb" />
                    </span>
                    <span className="settings-state" data-active={remindersAvailable}>
                      {reminderLabel}
                    </span>
                  </span>
                </button>
                <p id="settings-reminder-help" className="settings-help settings-state-help">
                  {props.reminders === 'blocked'
                    ? 'Allow notifications in your browser settings, then turn Reminders on.'
                    : props.reminders === 'unsupported'
                    ? 'This browser does not support notifications.'
                    : props.reminders === 'needs-permission'
                    ? 'Reminders are on, but this browser has not been asked for notification permission yet. Tap to allow.'
                    : remindersAvailable
                    ? 'Task reminders are active on this device.'
                    : 'Turn on to allow timed-task notifications.'}
                </p>
              </div>
            )}

            {matches(['journal nudge', 'nudge', 'journal', 'evening', 'reflection']) && (
              <div className="settings-row-wrap">
                <button
                  className="settings-row settings-toggle-row"
                  aria-describedby="settings-nudge-help"
                  aria-pressed={props.journalNudge}
                  disabled={props.notificationBusy || props.reminders !== 'on'}
                  onClick={props.onToggleJournalNudge}
                >
                  <div className="settings-icon-box" aria-hidden="true">
                    <BookOpen size={18} />
                  </div>
                  <span className="settings-row-main">
                    <strong>Journal nudge</strong>
                    <small>At 21:00, remind me if today&apos;s journal is empty.</small>
                  </span>
                  <span className="settings-row-action" aria-hidden="true">
                    <span className={`settings-switch-visual ${remindersAvailable && props.journalNudge ? 'on' : ''}`}>
                      <span className="settings-switch-thumb" />
                    </span>
                    <span className="settings-state" data-active={remindersAvailable && props.journalNudge}>
                      {nudgeLabel}
                    </span>
                  </span>
                </button>
                <p id="settings-nudge-help" className="settings-help settings-state-help">
                  {!remindersAvailable
                    ? props.journalNudge
                      ? props.reminders === 'needs-permission'
                        ? 'Your journal nudge is saved, but paused until notification permission is allowed.'
                        : 'Your journal nudge is saved, but paused until Reminders is on.'
                      : 'Turn Reminders on first to enable the journal nudge.'
                    : props.journalNudge
                    ? 'Your evening journal nudge is on.'
                    : 'Optional. Turn on for one evening journal reminder.'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 6. Device & Local Storage Overview Card */}
      {showAbout && (
        <div className="settings-card-group settings-about-group">
          <div className="settings-card-header">
            <h3>Device &amp; Storage</h3>
            <span className="settings-card-subtitle">Offline-first local database and device credentials</span>
          </div>
          <div className="settings-card settings-about-card">
            <div className="settings-about-row">
              <div className="settings-icon-box" aria-hidden="true">
                <Laptop size={18} />
              </div>
              <div className="settings-about-info">
                <strong>{deviceLabel}</strong>
                <small className="settings-device-id" title={deviceId}>Device ID: {deviceId.slice(0, 16)}…</small>
              </div>
              <div className="settings-about-badge">
                <ShieldCheck size={14} />
                <span>Local-first</span>
              </div>
            </div>

            {dbCounts && (
              <div className="settings-storage-stats">
                <div className="settings-stat-item">
                  <span className="settings-stat-num">{dbCounts.tasks}</span>
                  <span className="settings-stat-label">Tasks</span>
                </div>
                <div className="settings-stat-item">
                  <span className="settings-stat-num">{dbCounts.projects}</span>
                  <span className="settings-stat-label">Projects</span>
                </div>
                <div className="settings-stat-item">
                  <span className="settings-stat-num">{dbCounts.notes}</span>
                  <span className="settings-stat-label">Notes</span>
                </div>
                <div className="settings-stat-item">
                  <span className="settings-stat-num">{dbCounts.habits}</span>
                  <span className="settings-stat-label">Habits</span>
                </div>
                <div className="settings-stat-item">
                  <span className="settings-stat-num">{dbCounts.attachments}</span>
                  <span className="settings-stat-label">Files</span>
                </div>
              </div>
            )}

            <div className="settings-about-privacy">
              <Database size={14} className="settings-privacy-icon" />
              <span>Data is stored directly in IndexedDB on this browser. Backups and exports remain unencrypted files under your control.</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
