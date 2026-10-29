import { X, Cloud, Palette, Bell, BookOpen, KeyRound } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import './SettingsDialog.css';
import { STYLES, getStyle, getTheme } from '../theme';

export default function SettingsDialog(props: {
  onClose: () => void;
  onSync: () => void;
  onDataBackup?: () => void;
  onAppearance: () => void;
  onGoogleCalendar?: () => void;
  onAgentKeys?: () => void;
  reminders: 'on' | 'off' | 'blocked' | 'unsupported' | 'needs-permission';
  onToggleReminders: () => void;
  notificationError?: string;
  notificationBusy?: boolean;
  journalNudge: boolean;
  onToggleJournalNudge: () => void;
}) {
  const panel = useDialogFocus<HTMLDivElement>(props.onClose);
  const remindersAvailable = props.reminders === 'on';
  const reminderLabel = props.reminders === 'blocked' ? 'Blocked' : props.reminders === 'unsupported' ? 'Unavailable' : props.reminders === 'needs-permission' ? 'Permission needed' : remindersAvailable ? 'On' : 'Off';
  const nudgeLabel = !remindersAvailable && props.journalNudge ? 'Paused' : props.journalNudge ? 'On' : 'Off';
  return (
    <div className="palette-overlay" onClick={props.onClose}>
      <div ref={panel} className="import-panel settings-panel" role="dialog" aria-modal="true" aria-label="Settings" onClick={e => e.stopPropagation()}>
        <div className="import-head"><h2>Settings</h2><button className="icon-btn" aria-label="Close settings" onClick={props.onClose}><X size={18} /></button></div>
        <section className="settings-group" aria-labelledby="settings-device-heading">
        <h3 id="settings-device-heading">Connection &amp; display</h3>
        {props.onDataBackup && <button className="settings-row" onClick={props.onDataBackup}><Cloud size={19}/><span><strong>Data &amp; backups</strong><small>Device status and complete portable backup</small></span><span aria-hidden="true">→</span></button>}
        <button className="settings-row" onClick={props.onSync}><Cloud size={19} /><span><strong>Sync</strong><small>Connect to your self-hosted server</small></span><span aria-hidden="true">→</span></button>
        <button className="settings-row" onClick={props.onAppearance}><Palette size={19} /><span><strong>Appearance</strong><small>Style, mode, fonts and wallpaper</small><small className="settings-current-appearance" aria-hidden="true">{STYLES.find(s => s.id === getStyle())?.name} · {getTheme() === 'system' ? 'System mode' : `${getTheme()} mode`}</small></span><span aria-hidden="true">→</span></button>
        {props.onGoogleCalendar && <button className="settings-row" onClick={props.onGoogleCalendar}><Cloud size={19}/><span><strong>Google Calendar</strong><small>Optional read-only events, using your self-hosted server</small></span><span aria-hidden="true">→</span></button>}
        {props.onAgentKeys && <button className="settings-row" onClick={props.onAgentKeys}><KeyRound size={19}/><span><strong>Agent API keys</strong><small>Let AI agents read or change your data through your server</small></span><span aria-hidden="true">→</span></button>}
        </section>
        <section className="settings-group" aria-labelledby="settings-notifications-heading">
        <h3 id="settings-notifications-heading">Notifications</h3>
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
        </section>
      </div>
    </div>
  );
}
