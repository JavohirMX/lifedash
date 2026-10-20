import { useEffect, useRef } from 'react';
import { X, Zap } from 'lucide-react';
import type { AutomationRules } from '../automation';

export default function AutomationDialog(props: {
  rules: AutomationRules;
  onChange: (rules: AutomationRules) => void;
  onClose: () => void;
}) {
  const { rules } = props;
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const set = (patch: Partial<AutomationRules>) => props.onChange({ ...rules, ...patch });
  return (
    <div className="palette-overlay" onClick={props.onClose}>
      <div className="import-panel automation-panel" role="dialog" aria-modal="true" aria-label="Automation rules" onClick={(e) => e.stopPropagation()}>
        <div className="import-head">
          <h2>Automation</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label="Close">
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        <p className="rule-note">
          Rules run quietly in the background. Each one can be switched off at any time.
        </p>
        <div className="rule-row">
          <div className="rule-copy">
            <strong>Roll overdue tasks into Today</strong>
            <span>When you open Lifedash, anything past its due date moves to today so nothing slips by.</span>
          </div>
          <button
            ref={firstRef}
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
        <div className="rule-coming">
          <Zap size={14} strokeWidth={1.75} aria-hidden="true" />
          More rules arrive with sync: scheduled reminders, backlog sweeps, and habit-linked tasks.
        </div>
      </div>
    </div>
  );
}
