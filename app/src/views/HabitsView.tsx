import './workflow.css';
import { useState } from 'react';
import { ChevronDown, ChevronRight, Flame, Plus } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { addHabit, archiveHabit, restoreHabit, toggleHabitForDate, updateHabit } from '../repo';
import { currentStreak, bestStreak, completionRate, weekGrid, logsByDate, isScheduledOn } from '../habits';
import { todayStr, parseLocalDate } from '../dates';

const COLORS = ['#6366f1', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#38bdf8'];
const DAY_LETTERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function HabitsView() {
  const habits = useLiveQuery(() => db.habits.orderBy('order').toArray(), []);
  const logs = useLiveQuery(() => db.habitLogs.toArray(), []);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [weekdays, setWeekdays] = useState<number[] | null>(null); // null = daily

  const today = todayStr();
  const active = (habits ?? []).filter((h) => !h.archived);
  const archived = (habits ?? []).filter((h) => h.archived);
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editWeekdays, setEditWeekdays] = useState<number[] | null>(null);

  function startEdit(h: { id: string; name: string; weekdays: number[] | null }) {
    setEditingId(h.id);
    setEditName(h.name);
    setEditWeekdays(h.weekdays);
  }

  function toggleEditWd(d: number) {
    const cur = editWeekdays ?? [0, 1, 2, 3, 4, 5, 6];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort();
    setEditWeekdays(next.length === 7 ? null : next);
  }

  function saveEdit() {
    if (!editingId || !editName.trim()) return;
    void updateHabit(editingId, { name: editName, weekdays: editWeekdays });
    setEditingId(null);
  }

  function toggleWd(d: number) {
    const cur = weekdays ?? [0, 1, 2, 3, 4, 5, 6];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort();
    setWeekdays(next.length === 7 ? null : next);
  }

  function submitHabit() {
    if (!name.trim()) return;
    void addHabit(name, COLORS[active.length % COLORS.length], weekdays);
    setName(''); setWeekdays(null); setAdding(false);
  }

  return (
    <section>
      <h1>
        Habits
        <button className="mini" style={{ marginLeft: 'auto' }} onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : <><Plus size={14} strokeWidth={2} aria-hidden="true" /> New habit</>}
        </button>
      </h1>

      {adding && (
        <div className="habit-add">
          <input
            autoFocus
            value={name}
            placeholder="Habit name (e.g. Read 20 min)"
            aria-label="New habit name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitHabit();
              if (e.key === 'Escape') setAdding(false);
            }}
          />
          <div className="wd-picker">
            {DAY_LETTERS.map((l, i) => {
              const on = (weekdays ?? [0, 1, 2, 3, 4, 5, 6]).includes(i);
              return (
                <button key={i} className={`wd ${on ? 'on' : ''}`} aria-label={DAY_NAMES[i]} aria-pressed={on} onClick={() => toggleWd(i)}>
                  {l}
                </button>
              );
            })}
            <span className="wd-hint">{weekdays === null ? 'Every day' : weekdays.length === 0 ? 'No days selected' : `${weekdays.length} days a week`}</span>
          </div>
          <div className="habit-edit-actions">
            <button className="btn-primary" disabled={!name.trim()} onClick={submitHabit}>Add habit</button>
            <button className="mini" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      {active.length === 0 && !adding && (
        <p className="empty">
          {archived.length > 0
            ? 'No active habits. Add a new one, or restore an archived one below.'
            : 'No habits yet. Add one - daily, or pick the weekdays.'}
        </p>
      )}

      {(logs !== undefined) &&
        active.map((h) => {
          const streak = currentStreak(h, logs, today);
          const best = bestStreak(h, logs);
          const rate = completionRate(h, logs, today);
          const total = logs.filter((l) => l.habitId === h.id).length;
          const grid = weekGrid(h, logs, today, 28);
          const doneToday = logsByDate(logs, h.id).has(today);
          const scheduledToday = isScheduledOn(h, today);
          return (
            <div key={h.id} className="habit-card">
              <div className="habit-head">
                <div className="habit-identity"><span className="dot" style={{ background: h.color }} /><span className="habit-name">{h.name}</span></div>
                <div className="habit-metrics">
                {streak >= 2 && <span className="streak"><Flame size={12} strokeWidth={2} aria-hidden="true" /> {streak}-day streak</span>}
                {total > 0 && (
                  <span className="habit-stats num">
                    {best > streak && <>best {best} · </>}
                    {rate !== null && <>{Math.round(rate * 100)}% · </>}
                    {total} total
                  </span>
                )}
                </div><div className="habit-actions">
                <button className="mini" title="Edit habit" onClick={() => (editingId === h.id ? setEditingId(null) : startEdit(h))}>
                  {editingId === h.id ? 'Close' : 'Edit'}
                </button>
                <button className="mini" title="Archive habit" onClick={() => void archiveHabit(h.id)}>
                  Archive
                </button></div>
              </div>
              {editingId === h.id && (
                <div className="habit-add habit-edit">
                  <input
                    autoFocus
                    value={editName}
                    aria-label="Habit name"
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                  />
                  <div className="wd-picker">
                    {DAY_LETTERS.map((l, i) => {
                      const on = (editWeekdays ?? [0, 1, 2, 3, 4, 5, 6]).includes(i);
                      return (
                        <button key={i} className={`wd ${on ? 'on' : ''}`} aria-label={DAY_NAMES[i]} aria-pressed={on} onClick={() => toggleEditWd(i)}>
                          {l}
                        </button>
                      );
                    })}
                    <span className="wd-hint">{editWeekdays === null ? 'every day' : 'custom days'}</span>
                  </div>
                  <div className="habit-edit-actions">
                    <button className="mini" onClick={saveEdit} disabled={!editName.trim()}>Save</button>
                    <button className="mini" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </div>
              )}
              <div className="habit-body">
                <div className="grid7">
                  {grid.map((c) => (
                    <div key={c.date} className="cell-wrap">
                      <button
                        className={`cell ${c.done ? 'done' : ''} ${!c.scheduled ? 'off' : ''} ${c.isToday ? 'today' : ''}`}
                        title={`${c.date}${c.scheduled ? (c.done ? ' - tap to undo' : ' - tap to mark done') : ' (not scheduled)'}`}
                        aria-label={`${c.done ? 'Unmark' : 'Mark'} ${h.name} for ${c.date}`}
                        aria-pressed={c.done}
                        disabled={!c.scheduled}
                        onClick={() => void toggleHabitForDate(h.id, c.date)}
                      />
                      <span className="cell-label">{c.date === grid[0].date || c.date.endsWith('-01')
                        ? parseLocalDate(c.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                        : Number(c.date.slice(8))}</span>
                    </div>
                  ))}
                </div>
                {scheduledToday && (
                  <button
                    className={`habit-toggle ${doneToday ? 'done' : ''}`}
                    onClick={() => void toggleHabitForDate(h.id, today)}
                  >
                    {doneToday ? 'Done today' : 'Mark done'}
                  </button>
                )}
                {!scheduledToday && <span className="att-size">not scheduled today</span>}
              </div>
            </div>
          );
        })}
      {archived.length > 0 && (
        <div className="archived-habits">
          <button className="archived-toggle" onClick={() => setShowArchived(!showArchived)} aria-expanded={showArchived}>
            Archived ({archived.length}) {showArchived ? <ChevronDown size={13} strokeWidth={2} aria-hidden="true" /> : <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />}
          </button>
          {showArchived && (
            <div className="archived-list">
              {archived.map((h) => (
                <div key={h.id} className="archived-row">
                  <span className="dot" style={{ background: h.color }} />
                  <span className="habit-name">{h.name}</span>
                  <button className="mini" onClick={() => void restoreHabit(h.id)}>Restore</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
