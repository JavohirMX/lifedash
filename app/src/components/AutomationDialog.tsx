import { useState } from 'react';
import { X, Pencil, Trash2 } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import type { AutomationRules, UserRule } from '../automation';
import type { Project } from '../types';
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
  projects: Project[];
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
  const [projectId, setProjectId] = useState('');
  const [pinned, setPinned] = useState(false);

  const resetForm = () => {
    setEditingId(null);
    setKind('tag');
    setTag('');
    setWeekday(1);
    setTitle('');
    setProjectId('');
    setPinned(false);
  };

  const startEdit = (rule: UserRule) => {
    setEditingId(rule.id);
    setKind(rule.trigger.kind);
    setTag(rule.trigger.kind === 'tag' ? rule.trigger.tag : '');
    setWeekday(rule.trigger.kind === 'weekly' ? rule.trigger.weekday : 1);
    setTitle(rule.title);
    setProjectId(rule.projectId ?? '');
    setPinned(rule.pinned === true);
  };

  const projectName = (id: string) =>
    id === 'inbox' ? 'Inbox' : (props.projects.find((p) => p.id === id)?.name ?? 'a deleted project');
  const actionNote = (rule: UserRule): string => {
    const parts: string[] = [];
    if (rule.projectId) parts.push(`creates in ${projectName(rule.projectId)}`);
    if (rule.pinned === true) parts.push('pinned');
    return parts.length ? ` - ${parts.join(', ')}` : '';
  };

  const submit = () => {
    const cleanTitle = title.trim();
    const cleanTag = tag.trim().replace(/^#/, '').toLowerCase();
    if (!cleanTitle || (kind === 'tag' && !cleanTag)) return;
    const trigger = kind === 'tag' ? { kind: 'tag' as const, tag: cleanTag } : { kind: 'weekly' as const, weekday };
    const actions: Pick<UserRule, 'projectId' | 'pinned'> = { projectId: projectId || null, pinned };
    const saved = save(() => {
    if (editingId) {
      // In-place edit: id, createdAt and lastFired carry over, so an edited
      // weekly rule still fires at most once per day.
      props.onUserRulesChange(userRules.map((r) => (r.id === editingId ? { ...r, trigger, title: cleanTitle, ...actions } : r)));
    } else {
      props.onUserRulesChange([
        ...userRules,
        { id: `ur-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, trigger, title: cleanTitle, ...actions, createdAt: Date.now(), lastFired: null },
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
          Runs only while Lifedash is open.
        </p>
        {props.weeklyFailed && <div role="alert"><p>Couldn't finish running weekly rules. Some tasks may have been created or rule history may not have been saved. Check tasks and rules before trying again.</p><button className="btn-secondary" onClick={props.onDismissWeekly}>Dismiss weekly-rule notice</button></div>}
        {props.rolloverFailed && <div role="alert"><p>Couldn't finish moving overdue tasks to Today. Part of the change may have been saved. Check task dates before trying again. Your automation setting is unchanged.</p><button className="btn-secondary" onClick={props.onDismissRollover}>Dismiss rollover notice</button></div>}
        {saveError && <p role="alert" className="import-warnings">{saveError}</p>}
        <div className="rule-row">
          <div className="rule-copy">
            <strong>Roll overdue tasks into Today</strong>
            <span>Moves overdue tasks to Today when you open Lifedash.</span>
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
                  <span>{describeUserRule(rule)}{actionNote(rule)}</span>
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
          <div className="field">
            <span>Trigger</span>
            <select
              aria-label="Rule trigger"
              value={kind}
              onChange={(e) => setKind(e.target.value as 'tag' | 'weekly')}
            >
              <option value="tag">Tag task completes</option>
              <option value="weekly">Weekly on a day</option>
            </select>
          </div>
          {kind === 'tag' ? (
            <div className="field">
              <span>When tag completes</span>
              <input
                aria-label="Tag"
                placeholder="#tag"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
              />
            </div>
          ) : (
            <div className="field">
              <span>Day of week</span>
              <select aria-label="Weekday" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>{d}</option>
                ))}
              </select>
            </div>
          )}
          <div className="field" style={{ flex: '1 1 180px' }}>
            <span>Task to create</span>
            <input
              aria-label="Task to create"
              placeholder="e.g. Weekly review"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="field">
            <span>Project</span>
            <select aria-label="Project for the created task" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">{kind === 'tag' ? 'Same project as completed task' : 'Inbox (default)'}</option>
              <option value="inbox">Inbox</option>
              {props.projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <label className="rule-check">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            Pin the created task
          </label>
          <button type="submit" className="btn-primary">{editingId ? 'Save rule' : 'Add rule'}</button>
          {editingId && (
            <button type="button" className="btn-secondary" onClick={resetForm}>Cancel</button>
          )}
        </form>
        <p className="rule-note">Skips a rule when an open task with the same title is found.</p>
      </div>
    </div>
  );
}
