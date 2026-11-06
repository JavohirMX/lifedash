import { useState } from 'react';
import { ExternalLink, Trash2 } from 'lucide-react';
import type { Task } from '../../types';
import { parseTime, fmt } from '../../dayPlanner';

export function TaskPlanModal(props: {
  task: Task;
  date: string;
  onClose: () => void;
  onOpenDetail: () => void;
  onSave: (patch: {
    title: string;
    plannedDate: string | null;
    plannedTime: string | null;
    durationMinutes: number | null;
  }) => Promise<void>;
  onUnschedule: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { task, date, onClose, onOpenDetail, onSave, onUnschedule, onDelete } = props;
  const [title, setTitle] = useState(task.title);
  const [planDate, setPlanDate] = useState(task.plannedDate || date);
  const [planTime, setPlanTime] = useState(task.plannedTime || '09:00');
  const [duration, setDuration] = useState(
    task.durationMinutes ? String(task.durationMinutes) : '45'
  );

  const startMin = parseTime(planTime);
  const durMin = Math.max(1, Number(duration) || 45);

  return (
    <div className="planner-modal-overlay" onClick={onClose}>
      <div className="planner-modal-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Plan Work Block</h3>
          <button
            type="button"
            className="btn-quiet"
            onClick={onOpenDetail}
            title="Open full task detail"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}
          >
            Full detail <ExternalLink size={13} />
          </button>
        </div>

        <label>Task Title</label>
        <input
          type="text"
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />

        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ flex: 1 }}>
            <label>Work Date</label>
            <input
              type="date"
              value={planDate}
              onChange={(e) => setPlanDate(e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label>Start Time</label>
            <input
              type="time"
              value={planTime}
              onChange={(e) => setPlanTime(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
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
          <div style={{ flex: 1, alignSelf: 'flex-end', paddingBottom: '8px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--muted)' }}>
              Ends at {fmt(startMin + durMin)}
            </span>
          </div>
        </div>

        <div className="planner-modal-actions">
          <span>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void onUnschedule()}
            >
              Unschedule
            </button>
            <button
              type="button"
              className="icon-btn"
              style={{ color: 'var(--negative)', marginLeft: '6px' }}
              onClick={() => void onDelete()}
              title="Delete task"
            >
              <Trash2 size={16} />
            </button>
          </span>
          <span style={{ display: 'flex', gap: '8px' }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                void onSave({
                  title: title.trim() || task.title,
                  plannedDate: planDate,
                  plannedTime: planTime,
                  durationMinutes: durMin,
                });
              }}
            >
              Save
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
