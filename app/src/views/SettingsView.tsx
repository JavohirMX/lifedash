import { useRef, useState } from 'react';
import { Cloud, Palette, Bell, BookOpen, KeyRound, Upload, Download, FileJson, FileText, CalendarDays } from 'lucide-react';
import '../components/settings.css';
import { STYLES, getStyle, getTheme } from '../theme';
import { PageHeader, PageSection } from '../components/Page';
import { db } from '../db';
import { exportJson, countAttachments } from '../repo';
import { tasksToMarkdown } from '../exportMd';
import { tasksToIcs } from '../ics';
import { todayStr } from '../dates';

export default function SettingsView(props: {
  onSync: () => void;
  onDataBackup?: () => void;
  onAppearance: () => void;
  onGoogleCalendar?: () => void;
  onAgentKeys?: () => void;
  onImport: () => void;
  onRestore: () => void;
  reminders: 'on' | 'off' | 'blocked' | 'unsupported' | 'needs-permission';
  onToggleReminders: () => void;
  notificationError?: string;
  notificationBusy?: boolean;
  journalNudge: boolean;
  onToggleJournalNudge: () => void;
}) {
  const remindersAvailable = props.reminders === 'on';
  const reminderLabel = props.reminders === 'blocked' ? 'Blocked' : props.reminders === 'unsupported' ? 'Unavailable' : props.reminders === 'needs-permission' ? 'Permission needed' : remindersAvailable ? 'On' : 'Off';
  const nudgeLabel = !remindersAvailable && props.journalNudge ? 'Paused' : props.journalNudge ? 'On' : 'Off';

  const exporting = useRef(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState('');
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
    exporting.current = true; setExportBusy(true); setExportError('');
    try {
      if (format === 'JSON') {
        const [json, files] = await Promise.all([exportJson(), countAttachments()]);
        downloadFile(json, 'application/json', `lifedash-export-${new Date().toISOString().slice(0, 10)}.json`);
        if (files > 0) window.alert(`Exported. Note: ${files} attachment file${files === 1 ? ' stays' : 's stay'} on this device - the export keeps only their names and metadata.`);
      } else {
        const [tasks, projects] = await Promise.all([db.tasks.toArray(), db.projects.toArray()]);
        if (format === 'Markdown') downloadFile(tasksToMarkdown(tasks, projects), 'text/markdown', `lifedash-tasks-${todayStr()}.md`);
        else downloadFile(tasksToIcs(tasks, projects), 'text/calendar', `lifedash-tasks-${todayStr()}.ics`);
      }
    } catch { setExportError(`Couldn't prepare the ${format} export. Choose ${format} again.`); }
    finally { exporting.current = false; setExportBusy(false); }
  }

  return (
    <section className="settings-page settings-scope" aria-label="Settings">
      <PageHeader title="Settings" description="Connection, data, display and notifications for this device." />

      <PageSection title="Connection & display" className="settings-group">
        {props.onDataBackup && <button className="settings-row" onClick={props.onDataBackup}><Cloud size={19}/><span><strong>Data &amp; backups</strong><small>Device status and complete portable backup</small></span><span aria-hidden="true">→</span></button>}
        <button className="settings-row" onClick={props.onSync}><Cloud size={19} /><span><strong>Sync</strong><small>Connect to your self-hosted server</small></span><span aria-hidden="true">→</span></button>
        <button className="settings-row" onClick={props.onAppearance}><Palette size={19} /><span><strong>Appearance</strong><small>Style, mode, fonts and wallpaper</small><small className="settings-current-appearance" aria-hidden="true">{STYLES.find(s => s.id === getStyle())?.name} · {getTheme() === 'system' ? 'System mode' : `${getTheme()} mode`}</small></span><span aria-hidden="true">→</span></button>
        {props.onGoogleCalendar && <button className="settings-row" onClick={props.onGoogleCalendar}><Cloud size={19}/><span><strong>Google Calendar</strong><small>Optional read-only events, using your self-hosted server</small></span><span aria-hidden="true">→</span></button>}
        {props.onAgentKeys && <button className="settings-row" onClick={props.onAgentKeys}><KeyRound size={19}/><span><strong>Agent API keys</strong><small>Let AI agents read or change your data through your server</small></span><span aria-hidden="true">→</span></button>}
      </PageSection>

      <PageSection title="Import & export" className="settings-group">
        <button className="settings-row" onClick={props.onImport}><Upload size={19}/><span><strong>Import</strong><small>Bring tasks in from another app or file</small></span><span aria-hidden="true">→</span></button>
        <button className="settings-row" onClick={props.onRestore}><Upload size={19}/><span><strong>Restore backup</strong><small>Merge a Lifedash backup file into this device</small></span><span aria-hidden="true">→</span></button>
        {exportBusy && <p role="status">Preparing export…</p>}
        {exportError && <p className="form-save-error" role="alert">{exportError}</p>}
        <button className="settings-row" disabled={exportBusy} onClick={() => void exportData('JSON')}><FileJson size={19}/><span><strong>Export JSON backup</strong><small>App data and attachment metadata; files stay on this device</small></span><span aria-hidden="true"><Download size={15}/></span></button>
        <button className="settings-row" disabled={exportBusy} onClick={() => void exportData('Markdown')}><FileText size={19}/><span><strong>Export Markdown</strong><small>Tasks only, readable anywhere</small></span><span aria-hidden="true"><Download size={15}/></span></button>
        <button className="settings-row" disabled={exportBusy} onClick={() => void exportData('Calendar')}><CalendarDays size={19}/><span><strong>Export calendar (.ics)</strong><small>Open dated tasks; calendar import file, not live sync</small></span><span aria-hidden="true"><Download size={15}/></span></button>
      </PageSection>

      <PageSection title="Notifications" className="settings-group">
        {props.notificationBusy && <p role="status">Checking notification permission…</p>}
        {props.notificationError && <p className="form-save-error" role="alert">{props.notificationError}</p>}
        <p className="settings-help">Notifications only arrive while Lifedash is open on this device.</p>
        <button className="settings-row" aria-describedby="settings-reminder-help" aria-pressed={props.reminders === 'on'} disabled={props.notificationBusy || props.reminders === 'blocked' || props.reminders === 'unsupported'} onClick={props.onToggleReminders}>
          <Bell size={19} /><span><strong>Reminders</strong><small>Notify me when a timed task is due.</small></span><span className="settings-state" data-active={remindersAvailable}>{reminderLabel}</span>
        </button>
        <p id="settings-reminder-help" className="settings-help settings-state-help">
          {props.reminders === 'blocked' ? 'Allow notifications in your browser settings, then turn Reminders on.' : props.reminders === 'unsupported' ? 'This browser does not support notifications.' : props.reminders === 'needs-permission' ? 'Reminders are on, but this browser has not been asked for notification permission yet. Tap to allow.' : remindersAvailable ? 'Task reminders are on.' : 'Turn on to allow timed-task notifications.'}
        </p>
        <button className="settings-row" aria-describedby="settings-nudge-help" aria-pressed={props.journalNudge} disabled={props.notificationBusy || props.reminders !== 'on'} onClick={props.onToggleJournalNudge}>
          <BookOpen size={19} /><span><strong>Journal nudge</strong><small>At 21:00, remind me if today's journal is empty.</small></span><span className="settings-state" data-active={remindersAvailable && props.journalNudge}>{nudgeLabel}</span>
        </button>
        <p id="settings-nudge-help" className="settings-help settings-state-help">
          {!remindersAvailable ? props.journalNudge ? props.reminders === 'needs-permission' ? 'Your journal nudge is saved, but paused until notification permission is allowed.' : 'Your journal nudge is saved, but paused until Reminders is on.' : 'Turn Reminders on first to enable the journal nudge.' : props.journalNudge ? 'Your evening journal nudge is on.' : 'Optional. Turn on for one evening journal reminder.'}
        </p>
      </PageSection>
    </section>
  );
}
