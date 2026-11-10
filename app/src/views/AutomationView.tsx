import React, { useState } from 'react';
import {
  Zap,
  Repeat,
  Plus,
  Pencil,
  Trash2,
  Calendar,
  Tag,
  AlertTriangle,
  Pin,
  CheckCircle2,
} from 'lucide-react';
import { PageHeader } from '../components/Page';
import type { AutomationRules, UserRule } from '../automation';
import type { Project } from '../types';
import { describeUserRule } from '../automation';
import type { Selection } from '../components/Sidebar';
import './automation-view.css';

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export interface AutomationViewProps {
  weeklyFailed?: boolean;
  onDismissWeekly?: () => void;
  rolloverFailed?: boolean;
  onDismissRollover?: () => void;
  rules: AutomationRules;
  onChange: (rules: AutomationRules) => void;
  userRules: UserRule[];
  onUserRulesChange: (rules: UserRule[]) => void;
  projects: Project[];
  onNavigate?: (s: Selection) => void;
}

export default function AutomationView(props: AutomationViewProps) {
  const { rules, userRules } = props;
  const [saveError, setSaveError] = useState('');

  const save = (action: () => void): boolean => {
    setSaveError('');
    try {
      action();
      return true;
    } catch {
      setSaveError(
        "Couldn't save this automation change. Your saved rules are unchanged. Try again."
      );
      return false;
    }
  };

  const setSystemRule = (patch: Partial<AutomationRules>) =>
    save(() => props.onChange({ ...rules, ...patch }));

  // Form state
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

    // Scroll to form smoothly
    const formEl = document.getElementById('automation-form-card');
    formEl?.scrollIntoView({ behavior: 'smooth' });
  };

  const projectName = (id: string) =>
    id === 'inbox'
      ? 'Inbox'
      : props.projects.find((p) => p.id === id)?.name ?? 'a deleted project';

  const actionNote = (rule: UserRule): string => {
    const parts: string[] = [];
    if (rule.projectId) parts.push(`creates in ${projectName(rule.projectId)}`);
    if (rule.pinned === true) parts.push('pinned');
    return parts.length ? ` · ${parts.join(', ')}` : '';
  };

  const submit = () => {
    const cleanTitle = title.trim();
    const cleanTag = tag.trim().replace(/^#/, '').toLowerCase();
    if (!cleanTitle || (kind === 'tag' && !cleanTag)) return;

    const trigger =
      kind === 'tag'
        ? { kind: 'tag' as const, tag: cleanTag }
        : { kind: 'weekly' as const, weekday };
    const actions: Pick<UserRule, 'projectId' | 'pinned'> = {
      projectId: projectId || null,
      pinned,
    };

    const saved = save(() => {
      if (editingId) {
        props.onUserRulesChange(
          userRules.map((r) =>
            r.id === editingId
              ? { ...r, trigger, title: cleanTitle, ...actions }
              : r
          )
        );
      } else {
        props.onUserRulesChange([
          ...userRules,
          {
            id: `ur-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            trigger,
            title: cleanTitle,
            ...actions,
            createdAt: Date.now(),
            lastFired: null,
          },
        ]);
      }
    });

    if (saved) resetForm();
  };

  return (
    <div className="automation-view">
      <div className="automation-container">
        <PageHeader
          title="Automation"
          description="Configure automatic task rollovers, recurrence workflows, and tag triggers."
        />

        {/* Notices */}
        {props.weeklyFailed && (
          <div className="automation-alert automation-alert-error" role="alert">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={18} />
              <span>
                Couldn't finish running weekly rules. Check tasks and rules before trying again.
              </span>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={props.onDismissWeekly}
            >
              Dismiss
            </button>
          </div>
        )}

        {props.rolloverFailed && (
          <div className="automation-alert automation-alert-error" role="alert">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={18} />
              <span>
                Couldn't finish moving overdue tasks to Today. Part of the change may have been saved.
              </span>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={props.onDismissRollover}
            >
              Dismiss
            </button>
          </div>
        )}

        {saveError && (
          <div className="automation-alert automation-alert-error" role="alert">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={18} />
              <span>{saveError}</span>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSaveError('')}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Section 1: System Automation */}
        <div className="automation-card">
          <div className="automation-card-head">
            <div className="automation-card-title-group">
              <span className="automation-card-icon">
                <Zap size={18} strokeWidth={2} />
              </span>
              <h2 className="automation-card-title">System Rules</h2>
            </div>
            <span className="automation-card-badge">Built-in</span>
          </div>
          <p className="automation-card-desc">
            Core automated behaviors executed securely on your device while Lifedash is running.
          </p>

          <div className="automation-rule-list">
            <div className="automation-rule-item">
              <div className="automation-rule-copy">
                <span className="automation-rule-name">Roll overdue tasks into Today</span>
                <span className="automation-rule-detail">
                  Automatically shifts incomplete tasks due before today into Today's focus when you open Lifedash.
                </span>
              </div>
              <button
                type="button"
                className={`switch${rules.rollover ? ' on' : ''}`}
                role="switch"
                aria-checked={rules.rollover}
                aria-label="Roll overdue tasks into Today"
                onClick={() => setSystemRule({ rollover: !rules.rollover })}
              >
                <span className="knob" />
              </button>
            </div>

            <div className="automation-rule-item">
              <div className="automation-rule-copy">
                <span className="automation-rule-name">Complete parents automatically</span>
                <span className="automation-rule-detail">
                  When all subtasks of a parent are done, the parent completes automatically. Recurring parents schedule their next occurrence.
                </span>
              </div>
              <button
                type="button"
                className={`switch${rules.completeParent ? ' on' : ''}`}
                role="switch"
                aria-checked={rules.completeParent}
                aria-label="Complete parents automatically"
                onClick={() => setSystemRule({ completeParent: !rules.completeParent })}
              >
                <span className="knob" />
              </button>
            </div>
          </div>
        </div>

        {/* Section 2: Custom Automation Rules */}
        <div className="automation-card">
          <div className="automation-card-head">
            <div className="automation-card-title-group">
              <span className="automation-card-icon">
                <Repeat size={18} strokeWidth={2} />
              </span>
              <h2 className="automation-card-title">Custom Rules</h2>
            </div>
            <span className="automation-card-badge">
              {userRules.length} {userRules.length === 1 ? 'Rule' : 'Rules'}
            </span>
          </div>
          <p className="automation-card-desc">
            Trigger follow-up tasks when specific tags complete or on recurring weekly days.
          </p>

          {userRules.length === 0 ? (
            <div className="automation-empty-state">
              No custom rules yet. Create one below to automate your recurring workflows.
            </div>
          ) : (
            <div className="automation-rule-list">
              {userRules.map((rule) => (
                <div className="automation-rule-item" key={rule.id}>
                  <div className="automation-rule-copy">
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                      <span className="automation-trigger-tag">
                        {rule.trigger.kind === 'tag' ? (
                          <>
                            <Tag size={12} /> #{rule.trigger.tag}
                          </>
                        ) : (
                          <>
                            <Calendar size={12} /> {WEEKDAYS[rule.trigger.weekday]}
                          </>
                        )}
                      </span>
                      <strong className="automation-rule-name">{rule.title}</strong>
                    </div>
                    <span className="automation-rule-detail">
                      {describeUserRule(rule)}
                      {actionNote(rule)}
                    </span>
                  </div>
                  <div className="automation-rule-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Edit rule ${rule.title}`}
                      title="Edit rule"
                      onClick={() => startEdit(rule)}
                    >
                      <Pencil size={15} strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Delete rule ${rule.title}`}
                      title="Delete rule"
                      onClick={() =>
                        save(() =>
                          props.onUserRulesChange(
                            userRules.filter((r) => r.id !== rule.id)
                          )
                        )
                      }
                    >
                      <Trash2 size={15} strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section 3: Add / Edit Rule Form */}
        <div className="automation-card" id="automation-form-card">
          <div className="automation-card-head">
            <div className="automation-card-title-group">
              <span className="automation-card-icon">
                <Plus size={18} strokeWidth={2} />
              </span>
              <h2 className="automation-card-title">
                {editingId ? 'Edit Rule' : 'New Automation Rule'}
              </h2>
            </div>
          </div>
          <p className="automation-card-desc">
            Define a trigger event and the corresponding action Lifedash should execute.
          </p>

          <form
            className="automation-form"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="automation-form-grid">
              <div className="automation-field">
                <label htmlFor="rule-trigger">Trigger Event</label>
                <select
                  id="rule-trigger"
                  aria-label="Rule trigger"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as 'tag' | 'weekly')}
                >
                  <option value="tag">When a tagged task completes</option>
                  <option value="weekly">Weekly on a specific day</option>
                </select>
              </div>

              {kind === 'tag' ? (
                <div className="automation-field">
                  <label htmlFor="rule-tag">Tag</label>
                  <input
                    id="rule-tag"
                    aria-label="Tag"
                    placeholder="e.g. #meeting, #review"
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                  />
                </div>
              ) : (
                <div className="automation-field">
                  <label htmlFor="rule-weekday">Day of Week</label>
                  <select
                    id="rule-weekday"
                    aria-label="Weekday"
                    value={weekday}
                    onChange={(e) => setWeekday(Number(e.target.value))}
                  >
                    {WEEKDAYS.map((d, i) => (
                      <option key={d} value={i}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="automation-form-grid">
              <div className="automation-field">
                <label htmlFor="rule-task-title">Task to Create</label>
                <input
                  id="rule-task-title"
                  aria-label="Task to create"
                  placeholder="e.g. Send meeting summary and action items"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="automation-field">
                <label htmlFor="rule-project">Destination Project</label>
                <select
                  id="rule-project"
                  aria-label="Project for the created task"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  <option value="">
                    {kind === 'tag'
                      ? 'Same project as completed task'
                      : 'Inbox (default)'}
                  </option>
                  <option value="inbox">Inbox</option>
                  {props.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="automation-check-label">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
              />
              <span>Pin the created task to the top of its view</span>
            </label>

            <div className="automation-form-actions">
              <button type="submit" className="btn-primary">
                {editingId ? 'Save Rule' : 'Add Rule'}
              </button>
              {editingId && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={resetForm}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
