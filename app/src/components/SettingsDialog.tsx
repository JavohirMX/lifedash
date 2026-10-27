import { X, Cloud, Palette, Bell, BookOpen } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';

export default function SettingsDialog(props: {
  onClose: () => void;
  onSync: () => void;
  onAppearance: () => void;
  reminders: 'on' | 'off' | 'blocked' | 'unsupported';
  onToggleReminders: () => void;
  journalNudge: boolean;
  onToggleJournalNudge: () => void;
}) {
  const panel = useDialogFocus<HTMLDivElement>(props.onClose);
  return (
    <div className="palette-overlay" onClick={props.onClose}>
      <div ref={panel} className="import-panel settings-panel" role="dialog" aria-modal="true" aria-label="Settings" onClick={e => e.stopPropagation()}>
        <div className="import-head"><h2>Settings</h2><button className="icon-btn" aria-label="Close settings" onClick={props.onClose}><X size={18} /></button></div>
        <button className="settings-row" onClick={props.onSync}><Cloud size={19} /><span><strong>Sync</strong><small>Connect to your self-hosted server</small></span><span aria-hidden="true">→</span></button>
        <button className="settings-row" onClick={props.onAppearance}><Palette size={19} /><span><strong>Appearance</strong><small>Style, light mode and dark mode</small></span><span aria-hidden="true">→</span></button>
        <button className="settings-row" aria-pressed={props.reminders === 'on'} disabled={props.reminders === 'blocked' || props.reminders === 'unsupported'} onClick={props.onToggleReminders}>
          <Bell size={19} /><span><strong>Reminders</strong><small>Timed tasks notify only while Lifedash is open.</small></span><span>{props.reminders}</span>
        </button>
        {props.reminders === 'blocked' && <p className="rule-note">Allow notifications in your browser settings to use reminders.</p>}
        {props.reminders === 'unsupported' && <p className="rule-note">This browser does not support notifications.</p>}
        <button className="settings-row" aria-pressed={props.journalNudge} disabled={props.reminders !== 'on'} onClick={props.onToggleJournalNudge}>
          <BookOpen size={19} /><span><strong>Journal nudge</strong><small>One notification at 21:00 if today's journal is empty, only while the app is open.</small></span><span>{props.journalNudge ? 'on' : 'off'}</span>
        </button>
        {props.reminders !== 'on' && <p className="rule-note">Turn Reminders on first to enable the journal nudge.</p>}
      </div>
    </div>
  );
}
