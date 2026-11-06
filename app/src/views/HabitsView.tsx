import './workflow.css';
import './habits.css';
import { useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Flame, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import {
  addHabit,
  archiveHabit,
  restoreHabit,
  deleteHabit,
  toggleHabitForDate,
  setHabitValueForDate,
  updateHabit,
} from '../repo';
import {
  currentStreak,
  bestStreak,
  completionRate,
  isoMonthGrid,
  calculateHabitsSummary,
  isScheduledOn,
  isHabitDone,
} from '../habits';
import { todayStr, parseLocalDate } from '../dates';
import { EmptyState, PageHeader } from '../components/Page';
import type { Habit } from '../types';

const COLORS = [
  '#0f766e', // teal
  '#2563eb', // blue
  '#6366f1', // indigo
  '#8b5cf6', // purple
  '#d946ef', // fuchsia
  '#e11d48', // rose
  '#ea580c', // orange
  '#d97706', // amber
  '#16a34a', // green
  '#059669', // emerald
  '#0891b2', // cyan
  '#475569', // slate
];

const DAY_LETTERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ISO_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const UNIT_SUGGESTIONS = ['pages', 'ml', 'mins', 'steps', 'km', 'cal', 'times'];

type FilterKind = 'all' | 'due' | 'completed';

export default function HabitsView() {
  const habits = useLiveQuery(() => db.habits.orderBy('order').toArray(), []);
  const logs = useLiveQuery(() => db.habitLogs.toArray(), []);
  const [adding, setAdding] = useState(false);
  const writing = useRef(false);
  const [saving, setSaving] = useState<'create' | 'edit' | 'archive' | 'delete' | null>(null);
  const [createError, setCreateError] = useState('');
  const [editError, setEditError] = useState('');
  const [archiveError, setArchiveError] = useState('');
  const [saveStatus, setSaveStatus] = useState('');

  const [filter, setFilter] = useState<FilterKind>('all');

  // Create form state
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [weekdays, setWeekdays] = useState<number[] | null>(null); // null = daily
  const [targetType, setTargetType] = useState<'binary' | 'numeric'>('binary');
  const [targetValue, setTargetValue] = useState('');
  const [unit, setUnit] = useState('');

  const today = todayStr();
  const active = useMemo(() => (habits ?? []).filter((h) => !h.archived), [habits]);
  const archived = useMemo(() => (habits ?? []).filter((h) => h.archived), [habits]);
  const [showArchived, setShowArchived] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Edit form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(COLORS[0]);
  const [editWeekdays, setEditWeekdays] = useState<number[] | null>(null);
  const [editTargetType, setEditTargetType] = useState<'binary' | 'numeric'>('binary');
  const [editTargetValue, setEditTargetValue] = useState('');
  const [editUnit, setEditUnit] = useState('');

  // Daily Summary statistics
  const summary = useMemo(
    () => calculateHabitsSummary(habits ?? [], logs ?? [], today),
    [habits, logs, today],
  );

  function startEdit(h: Habit) {
    if (writing.current) return;
    setEditError('');
    setSaveStatus('');
    setEditingId(h.id);
    setEditName(h.name);
    setEditColor(h.color ?? COLORS[0]);
    setEditWeekdays(h.weekdays);
    setEditTargetType(h.targetType ?? 'binary');
    setEditTargetValue(h.targetValue ? String(h.targetValue) : '');
    setEditUnit(h.unit ?? '');
  }

  function toggleEditWd(d: number) {
    const cur = editWeekdays ?? [0, 1, 2, 3, 4, 5, 6];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort();
    setEditWeekdays(next.length === 7 ? null : next);
  }

  async function saveEdit() {
    if (writing.current || !editingId || !editName.trim()) return;
    writing.current = true;
    setSaving('edit');
    setEditError('');
    setSaveStatus('');
    try {
      const numVal = editTargetType === 'numeric' && editTargetValue ? Number(editTargetValue) : undefined;
      await updateHabit(editingId, {
        name: editName,
        color: editColor,
        weekdays: editWeekdays,
        targetType: editTargetType,
        targetValue: numVal,
        unit: editTargetType === 'numeric' ? editUnit : undefined,
      });
      setEditingId(null);
      setSaveStatus('Saved habit on this device.');
    } catch {
      setEditError("Couldn't save this habit. Your changes are still here. Try Save again.");
    } finally {
      writing.current = false;
      setSaving(null);
    }
  }

  async function changeArchived(habit: { id: string; name: string }, isArchiving: boolean) {
    if (writing.current) return;
    writing.current = true;
    setSaving('archive');
    setArchiveError('');
    setSaveStatus('');
    try {
      if (isArchiving) await archiveHabit(habit.id);
      else await restoreHabit(habit.id);
    } catch {
      setArchiveError(`Couldn't ${isArchiving ? 'archive' : 'restore'} "${habit.name}". Try the same button again.`);
    } finally {
      writing.current = false;
      setSaving(null);
    }
  }

  async function removePermanently(habit: { id: string; name: string }) {
    if (writing.current) return;
    writing.current = true;
    setSaving('delete');
    setArchiveError('');
    setSaveStatus('');
    try {
      await deleteHabit(habit.id);
      setDeleteConfirmId(null);
      setSaveStatus(`Deleted "${habit.name}" permanently.`);
    } catch {
      setArchiveError(`Couldn't delete "${habit.name}". Try again.`);
    } finally {
      writing.current = false;
      setSaving(null);
    }
  }

  const checking = useRef(new Set<string>());
  const [checkPending, setCheckPending] = useState<Set<string>>(new Set());
  const [checkErrors, setCheckErrors] = useState<Record<string, string>>({});

  async function handleToggleCheck(habit: Habit, date: string, currentlyDone: boolean) {
    const key = `${habit.id}:${date}`;
    if (checking.current.has(key)) return;
    checking.current.add(key);
    setCheckPending(new Set(checking.current));
    setCheckErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    try {
      if (habit.targetType === 'numeric' && habit.targetValue) {
        if (currentlyDone) {
          await setHabitValueForDate(habit.id, date, 0);
        } else {
          await setHabitValueForDate(habit.id, date, habit.targetValue);
        }
      } else {
        await toggleHabitForDate(habit.id, date);
      }
    } catch {
      setCheckErrors((current) => ({
        ...current,
        [key]: `Couldn't save the check-in for ${date}. Try that day again.`,
      }));
    } finally {
      checking.current.delete(key);
      setCheckPending(new Set(checking.current));
    }
  }

  async function changeHabitValue(habitId: string, date: string, value: number) {
    const key = `${habitId}:${date}`;
    if (checking.current.has(key)) return;
    checking.current.add(key);
    setCheckPending(new Set(checking.current));
    setCheckErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    try {
      await setHabitValueForDate(habitId, date, value);
    } catch {
      setCheckErrors((current) => ({
        ...current,
        [key]: `Couldn't save progress for ${date}. Try again.`,
      }));
    } finally {
      checking.current.delete(key);
      setCheckPending(new Set(checking.current));
    }
  }

  function toggleWd(d: number) {
    const cur = weekdays ?? [0, 1, 2, 3, 4, 5, 6];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort();
    setWeekdays(next.length === 7 ? null : next);
  }

  async function submitHabit() {
    if (writing.current || !name.trim()) return;
    writing.current = true;
    setSaving('create');
    setCreateError('');
    setSaveStatus('');
    try {
      const numVal = targetType === 'numeric' && targetValue ? Number(targetValue) : undefined;
      await addHabit(name, color, weekdays, {
        targetType,
        targetValue: numVal,
        unit: targetType === 'numeric' ? unit : undefined,
      });
      setName('');
      setColor(COLORS[(active.length + 1) % COLORS.length]);
      setWeekdays(null);
      setTargetType('binary');
      setTargetValue('');
      setUnit('');
      setAdding(false);
      setSaveStatus('Added habit on this device.');
    } catch {
      setCreateError("Couldn't add this habit. Your entries are still here. Try Add habit again.");
    } finally {
      writing.current = false;
      setSaving(null);
    }
  }

  // Filtered active habits
  const filteredActive = useMemo(() => {
    if (!logs) return active;
    const logsMap = new Map<string, (typeof logs)[0]>();
    for (const l of logs) if (l.date === today) logsMap.set(l.habitId, l);

    return active.filter((h) => {
      const isDone = isHabitDone(h, logsMap.get(h.id));
      const isSched = isScheduledOn(h, today);
      if (filter === 'due') return isSched && !isDone;
      if (filter === 'completed') return isSched && isDone;
      return true;
    });
  }, [active, logs, today, filter]);

  return (
    <section>
      <PageHeader
        eyebrow="Track · daily practice"
        title="Habits"
        meta={active.length > 0 ? `${active.length} active` : undefined}
        description="Small recurring actions, tracked one day at a time. Streaks follow the schedule you set."
        actions={(
          <button
            className="btn-secondary"
            disabled={saving !== null}
            onClick={() => {
              setAdding(!adding);
              setCreateError('');
              setSaveStatus('');
            }}
          >
            {adding ? (
              <>
                <X size={14} strokeWidth={2} aria-hidden="true" /> Cancel
              </>
            ) : (
              <>
                <Plus size={14} strokeWidth={2} aria-hidden="true" /> New habit
              </>
            )}
          </button>
        )}
      />

      <p className="form-save-status" role="status">
        {saving ? 'Saving…' : saveStatus}
      </p>
      {archiveError && (
        <p className="form-save-error" role="alert">
          {archiveError}
        </p>
      )}

      {/* Today's Momentum Summary Banner */}
      {active.length > 0 && (
        <div className="habits-summary-card">
          <div className="habits-summary-top">
            <div className="habits-summary-stats">
              <span className="habits-summary-count">
                {summary.completedCount} of {summary.scheduledCount}
              </span>
              <span className="habits-summary-label">habits completed today</span>
            </div>
            {summary.allDone ? (
              <span className="habits-all-done-banner" role="status">
                <Check size={14} strokeWidth={2.5} aria-hidden="true" /> All habits completed today!
              </span>
            ) : summary.bestActiveStreak ? (
              <span className="habits-summary-highlight">
                <Flame size={13} strokeWidth={2.5} aria-hidden="true" />
                {summary.bestActiveStreak.streak}-day streak on {summary.bestActiveStreak.habitName}
              </span>
            ) : null}
          </div>
          <div
            className="habits-progress-track"
            role="progressbar"
            aria-valuenow={summary.progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Today's habits completion percentage"
          >
            <div className="habits-progress-fill" style={{ width: `${summary.progressPct}%` }} />
          </div>
        </div>
      )}

      {/* Horizon Filter Tabs */}
      {active.length > 0 && (
        <div className="habits-filter-bar" role="tablist" aria-label="Filter habits by horizon">
          <button
            role="tab"
            aria-selected={filter === 'all'}
            className={`habits-filter-pill ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All habits ({active.length})
          </button>
          <button
            role="tab"
            aria-selected={filter === 'due'}
            className={`habits-filter-pill ${filter === 'due' ? 'active' : ''}`}
            onClick={() => setFilter('due')}
          >
            Due today ({summary.scheduledCount - summary.completedCount})
          </button>
          <button
            role="tab"
            aria-selected={filter === 'completed'}
            className={`habits-filter-pill ${filter === 'completed' ? 'active' : ''}`}
            onClick={() => setFilter('completed')}
          >
            Completed ({summary.completedCount})
          </button>
        </div>
      )}

      {/* New Habit Form */}
      {adding && (
        <fieldset className="habit-add save-form" disabled={saving !== null} aria-busy={saving === 'create'}>
          <legend className="quick-add-label--sr">New habit</legend>
          <input
            autoFocus
            value={name}
            placeholder="Habit name (e.g. Read 20 min)"
            aria-label="New habit name"
            enterKeyHint="done"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submitHabit();
              if (e.key === 'Escape' && !e.nativeEvent.isComposing) setAdding(false);
            }}
          />

          {/* Color Picker Swatches */}
          <div className="swatch-group" aria-label="Choose habit color">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch-btn ${color === c ? 'on' : ''}`}
                style={{ background: c }}
                aria-label={`Color ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
              />
            ))}
          </div>

          <div style={{ display: 'flex', gap: 14, margin: '6px 0', alignItems: 'center' }}>
            <label style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
              <input
                type="radio"
                name="newTargetType"
                checked={targetType === 'binary'}
                onChange={() => setTargetType('binary')}
              />
              <span>Simple check-in</span>
            </label>
            <label style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
              <input
                type="radio"
                name="newTargetType"
                checked={targetType === 'numeric'}
                onChange={() => setTargetType('numeric')}
              />
              <span>Numeric target</span>
            </label>
          </div>

          {targetType === 'numeric' && (
            <div style={{ margin: '4px 0 8px' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="number"
                  placeholder="Target value (e.g. 2000)"
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                  style={{ width: 180 }}
                  aria-label="Target numeric value"
                />
                <input
                  placeholder="Unit (e.g. ml, pages, steps)"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  style={{ width: 140 }}
                  aria-label="Unit of measurement"
                />
              </div>
              <div className="unit-chips">
                {UNIT_SUGGESTIONS.map((u) => (
                  <button key={u} type="button" className="unit-chip" onClick={() => setUnit(u)}>
                    {u}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Schedule Presets */}
          <div className="preset-chips">
            <button type="button" className="preset-chip" onClick={() => setWeekdays(null)}>
              Every day
            </button>
            <button type="button" className="preset-chip" onClick={() => setWeekdays([1, 2, 3, 4, 5])}>
              Weekdays (Mon-Fri)
            </button>
            <button type="button" className="preset-chip" onClick={() => setWeekdays([0, 6])}>
              Weekends (Sat-Sun)
            </button>
          </div>

          <div className="wd-picker">
            {DAY_LETTERS.map((l, i) => {
              const on = (weekdays ?? [0, 1, 2, 3, 4, 5, 6]).includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  className={`wd ${on ? 'on' : ''}`}
                  aria-label={DAY_NAMES[i]}
                  aria-pressed={on}
                  onClick={() => toggleWd(i)}
                >
                  {l}
                </button>
              );
            })}
            <span className="wd-hint">
              {weekdays === null ? 'Every day' : weekdays.length === 0 ? 'No days selected' : `${weekdays.length} days a week`}
            </span>
          </div>

          <div className="habit-edit-actions">
            <button className="btn-primary" disabled={!name.trim()} onClick={submitHabit}>
              Add habit
            </button>
            <button className="mini" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
          {createError && (
            <p className="form-save-error" role="alert">
              {createError}
            </p>
          )}
        </fieldset>
      )}

      {/* Empty State */}
      {active.length === 0 && !adding && (
        <EmptyState>
          {archived.length > 0
            ? 'No active habits. Add one or restore an archived habit below.'
            : 'No habits yet. Add one small practice to begin.'}
        </EmptyState>
      )}

      {/* Filtered Empty State */}
      {active.length > 0 && filteredActive.length === 0 && !adding && (
        <EmptyState>
          {filter === 'due'
            ? 'All habits scheduled for today are complete! Great work.'
            : 'No habits match this filter.'}
        </EmptyState>
      )}

      {/* Habit Cards */}
      {logs !== undefined &&
        filteredActive.map((h) => {
          const streak = currentStreak(h, logs, today);
          const best = bestStreak(h, logs);
          const rate = completionRate(h, logs, today);
          const total = logs.filter((l) => l.habitId === h.id).length;
          const grid = isoMonthGrid(h, logs, today, 4);

          const todayLog = logs.find((l) => l.habitId === h.id && l.date === today);
          const doneToday = isHabitDone(h, todayLog);
          const scheduledToday = isScheduledOn(h, today);
          const todayValue = todayLog?.value ?? 0;
          const targetVal = h.targetValue ?? 0;

          const isEditing = editingId === h.id;

          return (
            <div key={h.id} className="habit-card">
              {/* Header Row: Identity, Today's Action, Actions */}
              <div className="habit-header-row">
                <div className="habit-title-area">
                  <span className="habit-color-badge" style={{ background: h.color }} />
                  <div className="habit-header-text">
                    <h3 className="habit-name">{h.name}</h3>
                    <div className="habit-subtitle">
                      {streak >= 2 ? (
                        <span className="habit-streak-pill">
                          <Flame size={12} strokeWidth={2.5} aria-hidden="true" />
                          {streak}-day streak
                        </span>
                      ) : (
                        <span>
                          {h.weekdays === null
                            ? 'Daily'
                            : h.weekdays.length === 0
                              ? 'Unscheduled'
                              : `${h.weekdays.length} days/week`}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Primary Today Action in Header Area */}
                <div className="habit-today-controls">
                  {scheduledToday ? (
                    h.targetType === 'numeric' && h.targetValue ? (
                      <div className="numeric-habit-stepper">
                        <button
                          type="button"
                          className="stepper-btn"
                          disabled={checkPending.has(`${h.id}:${today}`) || todayValue <= 0}
                          onClick={() => {
                            const step = Math.max(1, Math.round(targetVal / 4));
                            void changeHabitValue(h.id, today, Math.max(0, todayValue - step));
                          }}
                          title="Subtract step"
                          aria-label={`Decrease ${h.name}`}
                        >
                          -
                        </button>
                        <span className="stepper-display">
                          {todayValue} / {targetVal} {h.unit ?? ''}
                        </span>
                        <button
                          type="button"
                          className="stepper-btn"
                          disabled={checkPending.has(`${h.id}:${today}`)}
                          onClick={() => {
                            const step = Math.max(1, Math.round(targetVal / 4));
                            void changeHabitValue(h.id, today, todayValue + step);
                          }}
                          title="Add step"
                          aria-label={`Increase ${h.name}`}
                        >
                          +
                        </button>
                        {doneToday && (
                          <span className="stepper-met-tag">
                            <Check size={12} strokeWidth={2.5} aria-hidden="true" /> Done
                          </span>
                        )}
                        <button
                          className={`habit-toggle ${doneToday ? 'done' : ''}`}
                          style={{ height: 28, padding: '0 10px', fontSize: '12px' }}
                          disabled={checkPending.has(`${h.id}:${today}`)}
                          onClick={() => void handleToggleCheck(h, today, doneToday)}
                        >
                          {doneToday ? 'Done today' : 'Mark done'}
                        </button>
                      </div>
                    ) : (
                      <button
                        className={`habit-toggle ${doneToday ? 'done' : ''}`}
                        disabled={checkPending.has(`${h.id}:${today}`)}
                        onClick={() => void handleToggleCheck(h, today, doneToday)}
                      >
                        {doneToday ? 'Done today' : 'Mark done'}
                      </button>
                    )
                  ) : (
                    <span className="att-size" style={{ fontStyle: 'italic' }}>
                      not scheduled today
                    </span>
                  )}
                </div>
              </div>

              {/* Status and Check Errors */}
              {[...checkPending].some((key) => key.startsWith(`${h.id}:`)) && (
                <p className="workflow-hint" role="status">
                  Saving check-in…
                </p>
              )}
              {Object.entries(checkErrors)
                .filter(([key]) => key.startsWith(`${h.id}:`))
                .map(([key, error]) => (
                  <p key={key} className="form-save-error" role="alert">
                    {error}
                  </p>
                ))}

              {/* Inline Edit Form */}
              {isEditing && (
                <fieldset
                  className="habit-add habit-edit save-form"
                  disabled={saving !== null}
                  aria-busy={saving === 'edit'}
                >
                  <legend className="quick-add-label--sr">Edit habit</legend>
                  <input
                    autoFocus
                    value={editName}
                    aria-label="Habit name"
                    enterKeyHint="done"
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveEdit();
                      if (e.key === 'Escape' && !e.nativeEvent.isComposing) setEditingId(null);
                    }}
                  />

                  {/* Edit Color Swatches */}
                  <div className="swatch-group" aria-label="Change habit color">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`swatch-btn ${editColor === c ? 'on' : ''}`}
                        style={{ background: c }}
                        aria-label={`Color ${c}`}
                        aria-pressed={editColor === c}
                        onClick={() => setEditColor(c)}
                      />
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: 14, margin: '6px 0', alignItems: 'center' }}>
                    <label
                      style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}
                    >
                      <input
                        type="radio"
                        name={`editTargetType_${h.id}`}
                        checked={editTargetType === 'binary'}
                        onChange={() => setEditTargetType('binary')}
                      />
                      <span>Simple check-in</span>
                    </label>
                    <label
                      style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}
                    >
                      <input
                        type="radio"
                        name={`editTargetType_${h.id}`}
                        checked={editTargetType === 'numeric'}
                        onChange={() => setEditTargetType('numeric')}
                      />
                      <span>Numeric target</span>
                    </label>
                  </div>

                  {editTargetType === 'numeric' && (
                    <div style={{ margin: '4px 0 8px' }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          type="number"
                          placeholder="Target value (e.g. 2000)"
                          value={editTargetValue}
                          onChange={(e) => setEditTargetValue(e.target.value)}
                          style={{ width: 180 }}
                          aria-label="Target numeric value"
                        />
                        <input
                          placeholder="Unit (e.g. ml, pages, steps)"
                          value={editUnit}
                          onChange={(e) => setEditUnit(e.target.value)}
                          style={{ width: 140 }}
                          aria-label="Unit of measurement"
                        />
                      </div>
                      <div className="unit-chips">
                        {UNIT_SUGGESTIONS.map((u) => (
                          <button key={u} type="button" className="unit-chip" onClick={() => setEditUnit(u)}>
                            {u}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Edit Presets */}
                  <div className="preset-chips">
                    <button type="button" className="preset-chip" onClick={() => setEditWeekdays(null)}>
                      Every day
                    </button>
                    <button type="button" className="preset-chip" onClick={() => setEditWeekdays([1, 2, 3, 4, 5])}>
                      Weekdays (Mon-Fri)
                    </button>
                    <button type="button" className="preset-chip" onClick={() => setEditWeekdays([0, 6])}>
                      Weekends (Sat-Sun)
                    </button>
                  </div>

                  <div className="wd-picker">
                    {DAY_LETTERS.map((l, i) => {
                      const on = (editWeekdays ?? [0, 1, 2, 3, 4, 5, 6]).includes(i);
                      return (
                        <button
                          key={i}
                          type="button"
                          className={`wd ${on ? 'on' : ''}`}
                          aria-label={DAY_NAMES[i]}
                          aria-pressed={on}
                          onClick={() => toggleEditWd(i)}
                        >
                          {l}
                        </button>
                      );
                    })}
                    <span className="wd-hint">
                      {editWeekdays === null ? 'every day' : 'custom days'}
                    </span>
                  </div>

                  <div className="habit-edit-actions">
                    <button className="mini" onClick={saveEdit} disabled={!editName.trim()}>
                      Save
                    </button>
                    <button className="mini" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                  {editError && (
                    <p className="form-save-error" role="alert">
                      {editError}
                    </p>
                  )}
                </fieldset>
              )}

              {/* 28-Day Consistency Grid with ISO Weekday Column Headers */}
              <div className="habit-grid-section">
                <div className="grid7-header" aria-hidden="true">
                  {ISO_DAYS.map((d) => (
                    <span key={d} className="grid7-day-name">
                      {d}
                    </span>
                  ))}
                </div>
                <div className="grid7">
                  {grid.map((c) => (
                    <div key={c.date} className="cell-wrap">
                      <button
                        type="button"
                        className={`cell ${c.done ? 'done' : ''} ${!c.scheduled ? 'off' : ''} ${c.isToday ? 'today' : ''} ${c.isFuture ? 'future' : ''}`}
                        title={`${c.date}${c.isFuture ? ' (upcoming)' : c.scheduled ? (c.done ? ' - tap to undo' : ' - tap to mark done') : ' (not scheduled)'}`}
                        aria-label={`${c.done ? 'Unmark' : 'Mark'} ${h.name} for ${c.date}`}
                        aria-pressed={c.done}
                        disabled={!c.scheduled || c.isFuture || checkPending.has(`${h.id}:${c.date}`)}
                        onClick={() => void handleToggleCheck(h, c.date, c.done)}
                      >
                        {h.targetType === 'numeric' && !c.isFuture && c.progressPct > 0 && !c.done && (
                          <span className="cell-partial" style={{ height: `${c.progressPct}%` }} />
                        )}
                      </button>
                      <span className="cell-label">
                        {c.date === grid[0].date || c.date.endsWith('-01')
                          ? parseLocalDate(c.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                          : Number(c.date.slice(8))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Footer Row: Consistency Stats & Lifecycle Actions */}
              <div className="habit-footer-row">
                <div className="habit-stats-group">
                  {best > 0 && (
                    <span className="habit-stat-badge">
                      <span>Best streak:</span>
                      <strong className="habit-stat-val">{best} days</strong>
                    </span>
                  )}
                  {rate !== null && (
                    <span className="habit-stat-badge">
                      <span>30-day rate:</span>
                      <strong className="habit-stat-val">{Math.round(rate * 100)}%</strong>
                    </span>
                  )}
                  {total > 0 && (
                    <span className="habit-stat-badge">
                      <span>Total:</span>
                      <strong className="habit-stat-val">{total}</strong>
                    </span>
                  )}
                </div>

                <div className="habit-card-actions">
                  <button
                    className="mini"
                    title="Edit habit"
                    disabled={saving !== null}
                    onClick={() => (editingId === h.id ? setEditingId(null) : startEdit(h))}
                  >
                    {editingId === h.id ? 'Close' : 'Edit'}
                  </button>
                  <button
                    className="mini"
                    title="Archive habit"
                    disabled={saving !== null}
                    onClick={() => void changeArchived(h, true)}
                  >
                    Archive
                  </button>
                </div>
              </div>
            </div>
          );
        })}

      {/* Archived Habits Section */}
      {archived.length > 0 && (
        <div className="archived-habits">
          <button
            className="archived-toggle"
            onClick={() => setShowArchived(!showArchived)}
            aria-expanded={showArchived}
          >
            Archived ({archived.length}){' '}
            {showArchived ? (
              <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
            ) : (
              <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
            )}
          </button>
          {showArchived && (
            <div className="archived-list">
              {archived.map((h) => (
                <div key={h.id} className="archived-row">
                  <span className="dot" style={{ background: h.color }} />
                  <span className="habit-name">{h.name}</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                      className="mini"
                      disabled={saving !== null}
                      onClick={() => void changeArchived(h, false)}
                    >
                      Restore
                    </button>
                    {deleteConfirmId === h.id ? (
                      <>
                        <button
                          className="mini danger"
                          disabled={saving !== null}
                          onClick={() => void removePermanently(h)}
                        >
                          Confirm delete
                        </button>
                        <button className="mini" onClick={() => setDeleteConfirmId(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="mini"
                        title="Delete permanently"
                        disabled={saving !== null}
                        onClick={() => setDeleteConfirmId(h.id)}
                      >
                        <Trash2 size={12} strokeWidth={2} aria-hidden="true" /> Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
