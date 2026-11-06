import type { MutableRefObject } from 'react';
import {
  GripVertical,
  ListPlus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Repeat,
} from 'lucide-react';
import type { Task } from '../../types';
import { type RecurringPlan, fmt, fmtD, parseTime } from '../../dayPlanner';

export interface PlannerTrayProps {
  trayCollapsed: boolean;
  toggleTray: () => void;
  trayTab: 'tasks' | 'recurring';
  setTrayTab: (tab: 'tasks' | 'recurring') => void;
  unscheduledTasks: Task[];
  recurringPlans: RecurringPlan[];
  taskSearch: string;
  setTaskSearch: (s: string) => void;
  projectColors: Map<string, string>;
  date: string;
  dragPayload: MutableRefObject<any>;
  handleQuickSchedule: (task: Task) => Promise<void>;
  setEditingRecurring: (plan: RecurringPlan | null) => void;
}

export function PlannerTray(props: PlannerTrayProps) {
  const {
    trayCollapsed,
    toggleTray,
    trayTab,
    setTrayTab,
    unscheduledTasks,
    recurringPlans,
    taskSearch,
    setTaskSearch,
    projectColors,
    date,
    dragPayload,
    handleQuickSchedule,
    setEditingRecurring,
  } = props;

  return (
    <aside className={`planner-tray ${trayCollapsed ? 'collapsed' : ''}`}>
      <div
        className="planner-tray-head"
        onClick={trayCollapsed ? toggleTray : undefined}
        role={trayCollapsed ? 'button' : undefined}
        tabIndex={trayCollapsed ? 0 : undefined}
        aria-label={trayCollapsed ? 'Expand tasks to plan' : undefined}
        onKeyDown={
          trayCollapsed
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleTray();
                }
              }
            : undefined
        }
      >
        <h2 className="planner-tray-title">
          {trayCollapsed ? (
            <span className="planner-tray-collapsed-label">
              <ListPlus size={15} aria-hidden="true" />
              <span>Tasks to Plan ({unscheduledTasks.length})</span>
            </span>
          ) : (
            trayTab === 'tasks' ? 'Tasks to Plan' : 'Recurring Plans'
          )}
        </h2>
        <button
          type="button"
          className="icon-btn"
          onClick={(e) => {
            e.stopPropagation();
            toggleTray();
          }}
          title={trayCollapsed ? 'Expand planning tray' : 'Collapse planning tray'}
        >
          {trayCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      {!trayCollapsed && (
        <>
          {/* Tab Selector */}
          <div className="planner-tray-tabs">
            <button
              type="button"
              className={`planner-tray-tab-btn ${trayTab === 'tasks' ? 'active' : ''}`}
              onClick={() => setTrayTab('tasks')}
            >
              Tasks ({unscheduledTasks.length})
            </button>
            <button
              type="button"
              className={`planner-tray-tab-btn ${trayTab === 'recurring' ? 'active' : ''}`}
              onClick={() => setTrayTab('recurring')}
            >
              Recurring ({recurringPlans.length})
            </button>
          </div>

          {trayTab === 'tasks' ? (
            <>
              <input
                type="text"
                className="planner-tray-search"
                placeholder="Search tasks to plan…"
                value={taskSearch}
                onChange={(e) => setTaskSearch(e.target.value)}
              />
              <div className="planner-tray-list">
                {unscheduledTasks.map((t) => {
                  const color =
                    projectColors.get(t.projectId) ||
                    (t.priority === 1
                      ? '#dc2626'
                      : t.priority === 2
                      ? '#d97706'
                      : '#0f766e');
                  return (
                    <div
                      key={t.id}
                      className="planner-tray-card"
                      draggable
                      onDragStart={(e) => {
                        dragPayload.current = { type: 'task', id: t.id };
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', t.title);
                      }}
                      onDragEnd={() => {
                        dragPayload.current = null;
                      }}
                    >
                      <GripVertical size={13} className="planner-card-grip" />
                      <span
                        className="planner-card-color"
                        style={{ background: color }}
                      />
                      <div className="planner-card-info">
                        <div className="planner-card-title">{t.title}</div>
                        <div className="planner-card-meta">
                          {t.dueDate === date
                            ? 'Due today'
                            : t.dueDate
                            ? `Due ${t.dueDate}`
                            : 'No deadline'}
                          {t.durationMinutes ? ` · ${fmtD(t.durationMinutes)}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="planner-card-add-btn"
                        title="Schedule at next slot"
                        onClick={() => void handleQuickSchedule(t)}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  );
                })}
                {!unscheduledTasks.length && (
                  <p className="workflow-hint" style={{ margin: '16px 0', textAlign: 'center' }}>
                    No waiting tasks. All set!
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Recurring Plans List */}
              <button
                type="button"
                className="btn-secondary planner-tray-add-header-btn"
                onClick={() => {
                  setEditingRecurring({
                    id: `rec-${Date.now()}`,
                    title: '',
                    color: '#0f766e',
                    startTime: '09:00',
                    durationMinutes: 60,
                    recurrence: 'weekdays',
                    active: true,
                  });
                }}
              >
                <Plus size={14} />
                <span>Add recurring plan</span>
              </button>

              <div className="planner-tray-list">
                {recurringPlans.map((r) => (
                  <div
                    key={r.id}
                    className="planner-tray-card"
                    style={{ opacity: r.active ? 1 : 0.55 }}
                    onClick={() => setEditingRecurring(r)}
                  >
                    <Repeat size={13} className="planner-card-grip" />
                    <span
                      className="planner-card-color"
                      style={{ background: r.color }}
                    />
                    <div className="planner-card-info">
                      <div className="planner-card-title">{r.title}</div>
                      <div className="planner-card-meta">
                        <span>{fmt(parseTime(r.startTime))}</span>
                        <span>·</span>
                        <span>{fmtD(r.durationMinutes)}</span>
                        <span>·</span>
                        <span>
                          {r.recurrence === 'daily'
                            ? 'Daily'
                            : r.recurrence === 'weekdays'
                            ? 'Mon–Fri'
                            : r.recurrence === 'weekends'
                            ? 'Sat–Sun'
                            : 'Custom'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </aside>
  );
}
