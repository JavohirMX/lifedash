import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpDown,
  BookOpen,
  Check,
  House,
  LayoutGrid,
  ListChecks,
  RotateCcw,
  X,
} from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import {
  BACKLOG_LIMIT_OPTIONS,
  BACKLOG_SORT_OPTIONS,
  HOME_WIDGET_OPTIONS,
  resetHomePreferences,
  saveHomePreference,
  saveWidgetVisibility,
  useHomePreferences,
} from '../homePreferences';
import type { BacklogSortOrder } from '../logic';
import './settings.css';
import './HomeSettingsDialog.css';

export interface HomeSettingsDialogProps {
  onClose: () => void;
  onBack?: () => void;
}

interface HomeToggleRowProps {
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}

function HomeToggleRow({ icon, title, description, checked, onToggle }: HomeToggleRowProps) {
  return (
    <button
      type="button"
      className="settings-row settings-toggle-row"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
    >
      <div className="settings-icon-box" aria-hidden="true">
        {icon}
      </div>
      <span className="settings-row-main">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <span className="settings-row-action" aria-hidden="true">
        <span className={`settings-switch-visual ${checked ? 'on' : ''}`}>
          <span className="settings-switch-thumb" />
        </span>
        <span className="settings-state" data-active={checked}>
          {checked ? 'On' : 'Off'}
        </span>
      </span>
    </button>
  );
}

/** Modal dialog for configuring Home screen backlog order, header display, and briefing sections. */
export default function HomeSettingsDialog(props: HomeSettingsDialogProps) {
  const panel = useDialogFocus<HTMLDivElement>(props.onClose);
  const homePrefs = useHomePreferences();
  const [prefError, setPrefError] = useState('');

  const handleSaveHomePref = async <K extends keyof Omit<typeof homePrefs, 'hiddenWidgets'>>(
    key: K,
    value: (typeof homePrefs)[K]
  ) => {
    setPrefError('');
    try {
      await saveHomePreference(key, value);
    } catch {
      setPrefError('Could not save Home screen settings. Please try again.');
    }
  };

  const handleToggleHomeWidget = async (id: string, visible: boolean) => {
    setPrefError('');
    try {
      await saveWidgetVisibility(id, visible);
    } catch {
      setPrefError('Could not update Home briefing sections. Please try again.');
    }
  };

  const handleResetHomePrefs = async () => {
    setPrefError('');
    try {
      await resetHomePreferences();
    } catch {
      setPrefError('Could not reset Home screen settings. Please try again.');
    }
  };

  const activeSortOption =
    BACKLOG_SORT_OPTIONS.find((opt) => opt.value === homePrefs.backlogSort) ?? BACKLOG_SORT_OPTIONS[0];
  const visibleSectionsCount = HOME_WIDGET_OPTIONS.filter(
    (widget) => !homePrefs.hiddenWidgets.includes(widget.id)
  ).length;

  return (
    <div className="palette-overlay" onClick={props.onClose}>
      <div
        ref={panel}
        className="import-panel home-settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Home screen settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="import-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {props.onBack && (
              <button className="icon-btn" aria-label="Back to Settings" onClick={props.onBack}>
                <ArrowLeft size={18} />
              </button>
            )}
            <h2>Home screen</h2>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={props.onClose}>
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        <div className="home-settings-summary">
          <p className="home-settings-current" role="status">
            Order: <strong>{activeSortOption.label}</strong> · {visibleSectionsCount}/
            {HOME_WIDGET_OPTIONS.length} sections visible
          </p>
          <button
            type="button"
            className="btn-secondary mini home-settings-reset"
            onClick={() => void handleResetHomePrefs()}
            title="Restore default Home screen settings"
          >
            <RotateCcw size={12} aria-hidden="true" />
            <span>Reset defaults</span>
          </button>
        </div>

        {prefError && (
          <div className="settings-notice settings-notice-error" role="alert">
            <span className="settings-notice-icon" aria-hidden="true">
              <AlertCircle size={16} />
            </span>
            <span className="settings-notice-text">{prefError}</span>
            <button
              type="button"
              className="settings-notice-dismiss"
              onClick={() => setPrefError('')}
              aria-label="Dismiss message"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div className="home-settings-section">
          <h3 className="home-settings-section-title">Backlog &amp; next action</h3>
          <div className="settings-card">
            <div className="settings-row settings-control-row">
              <div className="settings-icon-box" aria-hidden="true">
                <ArrowUpDown size={18} />
              </div>
              <span className="settings-row-main">
                <strong>Backlog task order</strong>
                <small>{activeSortOption.description}</small>
              </span>
              <div className="settings-row-control">
                <select
                  aria-label="Backlog task order"
                  className="settings-select"
                  value={homePrefs.backlogSort}
                  onChange={(e) =>
                    void handleSaveHomePref('backlogSort', e.target.value as BacklogSortOrder)
                  }
                >
                  {BACKLOG_SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <HomeToggleRow
              icon={<ListChecks size={18} />}
              title="Surface backlog tasks"
              description="Suggest unblocked backlog tasks when nothing is due today"
              checked={homePrefs.showBacklog}
              onToggle={() => void handleSaveHomePref('showBacklog', !homePrefs.showBacklog)}
            />

            <div className="settings-row settings-control-row">
              <div className="settings-icon-box" aria-hidden="true">
                <House size={18} />
              </div>
              <span className="settings-row-main">
                <strong>Ready tray task limit</strong>
                <small>Maximum number of backlog tasks listed in the Ready tray</small>
              </span>
              <div className="settings-row-control">
                <select
                  aria-label="Ready tray task limit"
                  className="settings-select settings-select-compact"
                  value={homePrefs.backlogLimit}
                  disabled={!homePrefs.showBacklog}
                  onChange={(e) => void handleSaveHomePref('backlogLimit', Number(e.target.value))}
                >
                  {BACKLOG_LIMIT_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n} tasks
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="home-settings-section">
          <h3 className="home-settings-section-title">Header &amp; schedule</h3>
          <div className="settings-card">
            <HomeToggleRow
              icon={<BookOpen size={18} />}
              title="Greeting & orientation"
              description="Show calm greeting and daily task summary text in header"
              checked={homePrefs.showGreeting}
              onToggle={() => void handleSaveHomePref('showGreeting', !homePrefs.showGreeting)}
            />
            <HomeToggleRow
              icon={<Check size={18} />}
              title="Daily progress bar"
              description="Show completion progress indicator below the Home greeting"
              checked={homePrefs.showProgressBar}
              onToggle={() =>
                void handleSaveHomePref('showProgressBar', !homePrefs.showProgressBar)
              }
            />
            <HomeToggleRow
              icon={<Check size={18} />}
              title="Completed today accordion"
              description="Show collapsible list of completed tasks inside Today's schedule"
              checked={homePrefs.showCompletedToday}
              onToggle={() =>
                void handleSaveHomePref('showCompletedToday', !homePrefs.showCompletedToday)
              }
            />
          </div>
        </div>

        <div className="home-settings-section">
          <h3 className="home-settings-section-title">Briefing sections</h3>
          <div className="settings-card">
            <div className="settings-widgets-block" role="group" aria-label="Home briefing sections">
              <div className="settings-widgets-head">
                <div className="settings-icon-box" aria-hidden="true">
                  <LayoutGrid size={18} />
                </div>
                <div className="settings-row-main">
                  <strong>Visible widgets &amp; cards</strong>
                  <small>Choose which sections and supporting cards appear on Home</small>
                </div>
              </div>
              <div className="settings-widget-grid">
                {HOME_WIDGET_OPTIONS.map((widget) => {
                  const checked = !homePrefs.hiddenWidgets.includes(widget.id);
                  return (
                    <label key={widget.id} className="settings-widget-item">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => void handleToggleHomeWidget(widget.id, e.target.checked)}
                      />
                      <span className="settings-widget-copy">
                        <span className="settings-widget-name">{widget.label}</span>
                        <span className="settings-widget-desc">{widget.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
