import { useState } from 'react';
import { X, Pencil, Trash2 } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import type { AutomationRules, UserRule } from '../automation';
import { describeUserRule } from '../automation';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function AutomationDialog(props: {
  weeklyFailed?: boolean;
  onDismissWeekly?: () => void;
  rolloverFailed?: boolean;
  onDismissRollover?: () => void;
  rules: AutomationRules;
  onChange: (rules: AutomationRules) => void;
  userRules: UserRule[];
  onUserRulesChange: (rules: UserRule[]) => void;
  onClose: () => void;
}) {
  const { rules, userRules } = props;
  const panel = useDialogFocus<HTMLDivElement>(props.onClose, '.switch, .rule-form input, .rule-form select, .rule-form button');
  const [saveError, setSaveError] = useState('');
  const save = (action: () => void): boolean => {
    setSaveError('');
    try { action(); return true; }
    catch { setSaveError("Couldn't save this automation change. Your saved rules are unchanged. Try the same action again."); return false; }
  };
  const set = (patch: Partial<AutomationRules>) => save(() => props.onChange({ ...rules, ...patch }));

  const [editingId, setEditingId] = useState<string | null>(null);
  const [kind, setKind] = useState<'tag' | 'weekly'>('tag');
  const [tag, setTag] = useState('');
  const [weekday, setWeekday] = useState(1);
  const [title, setTitle] = useState('');

  const resetForm = () => {
    setEditingId(null);
    setKind('tag');
    setTag('');
    setWeekday(1);
    setTitle('');
  };

  const startEdit = (rule: UserRule) => {
    setEditingId(rule.id);
    setKind(rule.trigger.kind);
    setTag(rule.trigger.kind === 'tag' ? rule.trigger.tag : '');
    setWeekday(rule.trigger.kind === 'weekly' ? rule.trigger.weekday : 1);
    setTitle(rule.title);
  };

  const submit = () => {
    const cleanTitle = title.trim();
    const cleanTag = tag.trim().replace(/^#/, '').toLowerCase();
    if (!cleanTitle || (kind === 'tag' && !cleanTag)) return;
    const trigger = kind === 'tag' ? { kind: 'tag' as const, tag: cleanTag } : { kind: 'weekly' as const, weekday };
    const saved = save(() => {
    if (editingId) {
      // In-place edit: id, createdAt and lastFired carry over, so an edited
      // weekly rule still fires at most once per day.
      props.onUserRulesChange(userRules.map((r) => (r.id === editingId ? { ...r, trigger, title: cleanTitle } : r)));
    } else {
      props.onUserRulesChange([
        ...userRules,
        { id: `ur-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, trigger, title: cleanTitle, createdAt: Date.now(), lastFired: null },
      ]);
    }
    });
    if (saved) resetForm();
  };

  return (
    <div className="palette-overlay" onClick={props.onClose}>
      <div ref={panel} className="import-panel automation-panel" role="dialog" aria-modal="true" aria-label="Automation rules" onClick={(e) => e.stopPropagation()}>
        <div className="import-head">
          <h2>Automation</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label="Close">
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        <p className="rule-note">
          Optional automatic behaviors. They run while Lifedash is open - never in the background or while the app is closed.
        </p>
        {props.weeklyFailed && <div role="alert"><p>Couldn't finish running weekly rules. Some tasks may have been created or rule history may not have been saved. Check tasks and rules before trying again.</p><button className="btn-secondary" onClick={props.onDismissWeekly}>Dismiss weekly-rule notice</button></div>}
        {props.rolloverFailed && <div role="alert"><p>Couldn't finish moving overdue tasks to Today. Part of the change may have been saved. Check task dates before trying again. Your automation setting is unchanged.</p><button className="btn-secondary" onClick={props.onDismissRollover}>Dismiss rollover notice</button></div>}
        {saveError && <p role="alert" className="import-warnings">{saveError}</p>}
        <div className="rule-row">
          <div className="rule-copy">
            <strong>Roll overdue tasks into Today</strong>
            <span>When you open Lifedash, anything past its due date moves to today so nothing slips by.</span>
          </div>
          <button
            className={`switch${rules.rollover ? ' on' : ''}`}
            role="switch"
            aria-checked={rules.rollover}
            aria-label="Roll overdue tasks into Today"
            onClick={() => set({ rollover: !rules.rollover })}
          >
            <span className="knob" />
          </button>
        </div>
        <div className="rule-row">
          <div className="rule-copy">
            <strong>Complete parents automatically</strong>
            <span>When the last open subtask is done, its parent completes too - recurring parents spawn the next occurrence.</span>
          </div>
          <button
            className={`switch${rules.completeParent ? ' on' : ''}`}
            role="switch"
            aria-checked={rules.completeParent}
            aria-label="Complete parents automatically"
            onClick={() => set({ completeParent: !rules.completeParent })}
          >
            <span className="knob" />
          </button>
        </div>

        {userRules.length > 0 && (
          <div className="rule-user-list">
            {userRules.map((rule) => (
              <div className="rule-row" key={rule.id}>
                <div className="rule-copy">
                  <strong>{rule.title}</strong>
                  <span>{describeUserRule(rule)}</span>
                </div>
                <button className="icon-btn" aria-label={`Edit rule ${rule.title}`} title="Edit rule" onClick={() => startEdit(rule)}>
                  <Pencil size={15} strokeWidth={1.75} />
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Delete rule ${rule.title}`}
                  title="Delete rule"
                  onClick={() => save(() => props.onUserRulesChange(userRules.filter((r) => r.id !== rule.id)))}
                >
                  <Trash2 size={15} strokeWidth={1.75} />
                </button>
              </div>
            ))}
          </div>
        )}

        <form
          className="rule-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <select
            aria-label="Rule trigger"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'tag' | 'weekly')}
          >
            <option value="tag">Tag task completes</option>
            <option value="weekly">Weekly on a day</option>
          </select>
          {kind === 'tag' ? (
            <input
              aria-label="Tag"
              placeholder="#tag"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
            />
          ) : (
            <select aria-label="Weekday" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>{d}</option>
              ))}
            </select>
          )}
          <input
            aria-label="Task to create"
            placeholder="Task to create"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button type="submit" className="btn-primary">{editingId ? 'Save rule' : 'Add rule'}</button>
          {editingId && (
            <button type="button" className="btn-secondary" onClick={resetForm}>Cancel</button>
          )}
        </form>
        <p className="rule-note">A rule never creates a duplicate: it skips while an open task with the same title exists.</p>
      </div>
    </div>
  );
}
