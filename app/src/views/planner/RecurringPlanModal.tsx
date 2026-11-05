import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  type RecurringPlan,
  type RecurrenceType,
  LIFEDASH_PALETTE,
  parseTime,
  fmt,
  fmtD,
} from '../../dayPlanner';

export function RecurringPlanModal(props: {
  plan: RecurringPlan;
  onClose: () => void;
  onSave: (updated: RecurringPlan) => void;
  onDelete: (id: string) => void;
}) {
  const { plan, onClose, onSave, onDelete } = props;
  const [title, setTitle] = useState(plan.title);
  const [recurrence, setRecurrence] = useState<RecurrenceType>(plan.recurrence);
  const [weekdays, setWeekdays] = useState<number[]>(plan.weekdays || [1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState(plan.startTime);
  const [duration, setDuration] = useState(String(plan.durationMinutes));
  const [color, setColor] = useState(plan.color);
  const [active, setActive] = useState(plan.active);

  const startMin = parseTime(startTime);
  const durMin = Math.max(5, Number(duration) || 30);

  const toggleWeekday = (dayNum: number) => {
    setWeekdays((prev) =>
      prev.includes(dayNum) ? prev.filter((d) => d !== dayNum) : [...prev, dayNum].sort()
    );
  };

  const WEEKDAY_NAMES = [
    { num: 1, label: 'Mo' },
    { num: 2, label: 'Tu' },
    { num: 3, label: 'We' },
    { num: 4, label: 'Th' },
    { num: 5, label: 'Fr' },
    { num: 6, label: 'Sa' },
    { num: 0, label: 'Su' },
  ];

  return (
    <div className="planner-modal-overlay" onClick={onClose}>
      <div className="planner-modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>{plan.title ? `Edit Recurring: ${plan.title}` : 'New Recurring Plan'}</h3>

        <label>Title</label>
        <input
          type="text"
          value={title}
          autoFocus
          placeholder="e.g. Deep Work, Gym, Sleep…"
          onChange={(e) => setTitle(e.target.value)}
        />

        <label>Repeats</label>
        <select
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value as RecurrenceType)}
        >
          <option value="daily">Daily (Every day)</option>
          <option value="weekdays">Weekdays (Mon–Fri)</option>
          <option value="weekends">Weekends (Sat–Sun)</option>
          <option value="weekly">Custom days of the week</option>
        </select>

        {recurrence === 'weekly' && (
          <div className="planner-weekday-chips">
            {WEEKDAY_NAMES.map((wd) => (
              <button
                key={wd.num}
                type="button"
                className={`planner-weekday-chip ${weekdays.includes(wd.num) ? 'active' : ''}`}
                onClick={() => toggleWeekday(wd.num)}
              >
                {wd.label}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ flex: 1 }}>
            <label>Start Time</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label>Duration (minutes)</label>
            <input
              type="number"
              min="5"
              step="5"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
        </div>

        <div style={{ margin: '6px 0', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: 'var(--muted)' }}>
          Runs from {startTime} to {fmt(startMin + durMin)} ({fmtD(durMin)})
        </div>

        <label>Color</label>
        <select
          value={color}
          onChange={(e) => setColor(e.target.value)}
          style={{ width: '100%', marginBottom: '10px' }}
        >
          {LIFEDASH_PALETTE.map((c) => (
            <option key={c} value={c}>
              ● {c}
            </option>
          ))}
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Active in schedule
        </label>

        <div className="planner-modal-actions">
          <span>
            {plan.id.startsWith('rec-') && (
              <button
                type="button"
                className="icon-btn"
                style={{ color: 'var(--negative)' }}
                onClick={() => onDelete(plan.id)}
                title="Delete recurring plan"
              >
                <Trash2 size={16} />
              </button>
            )}
          </span>
          <span style={{ display: 'flex', gap: '8px' }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                onSave({
                  ...plan,
                  title: title.trim() || 'Untitled Recurring Plan',
                  recurrence,
                  weekdays,
                  startTime,
                  durationMinutes: durMin,
                  color,
                  active,
                });
              }}
            >
              Save Recurring Plan
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
