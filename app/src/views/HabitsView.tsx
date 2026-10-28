import './workflow.css';
import { useRef, useState } from 'react';
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
  const writing = useRef(false);
  const [saving, setSaving] = useState<'create' | 'edit' | 'archive' | null>(null);
  const [createError, setCreateError] = useState('');
  const [editError, setEditError] = useState('');
  const [saveStatus, setSaveStatus] = useState('');

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
    if (writing.current) return;
    setEditError(''); setSaveStatus('');
    setEditingId(h.id);
    setEditName(h.name);
    setEditWeekdays(h.weekdays);
  }

  function toggleEditWd(d: number) {
    const cur = editWeekdays ?? [0, 1, 2, 3, 4, 5, 6];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort();
    setEditWeekdays(next.length === 7 ? null : next);
  }

  async function saveEdit() {
    if (writing.current || !editingId || !editName.trim()) return;
    writing.current = true; setSaving('edit'); setEditError(''); setSaveStatus('');
    try {
      await updateHabit(editingId, { name: editName, weekdays: editWeekdays });
      setEditingId(null);
      setSaveStatus('Saved habit on this device.');
    } catch { setEditError("Couldn't save this habit. Your changes are still here. Try Save again."); }
    finally { writing.current = false; setSaving(null); }
  }

  const [archiveError, setArchiveError] = useState('');
  async function changeArchived(habit: { id: string; name: string }, archived: boolean) {
    if (writing.current) return;
    writing.current = true; setSaving('archive'); setArchiveError(''); setSaveStatus('');
    try { if (archived) await archiveHabit(habit.id); else await restoreHabit(habit.id); }
    catch { setArchiveError(`Couldn't ${archived ? 'archive' : 'restore'} "${habit.name}". Try the same button again.`); }
    finally { writing.current = false; setSaving(null); }
  }

  const checking = useRef(new Set<string>());
  const [checkPending, setCheckPending] = useState<Set<string>>(new Set());
  const [checkErrors, setCheckErrors] = useState<Record<string, string>>({});
  async function toggleCheck(habitId: string, date: string) {
    const key = `${habitId}:${date}`;
    if (checking.current.has(key)) return;
    checking.current.add(key); setCheckPending(new Set(checking.current));
    setCheckErrors(current => { const next = { ...current }; delete next[key]; return next; });
    try { await toggleHabitForDate(habitId, date); }
    catch { setCheckErrors(current => ({ ...current, [key]: `Couldn't save the check-in for ${date}. Try that day again.` })); }
    finally { checking.current.delete(key); setCheckPending(new Set(checking.current)); }
  }

  function toggleWd(d: number) {
    const cur = weekdays ?? [0, 1, 2, 3, 4, 5, 6];
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort();
    setWeekdays(next.length === 7 ? null : next);
  }

  async function submitHabit() {
    if (writing.current || !name.trim()) return;
    writing.current = true; setSaving('create'); setCreateError(''); setSaveStatus('');
    try {
      await addHabit(name, COLORS[active.length % COLORS.length], weekdays);
      setName(''); setWeekdays(null);
      setAdding(false);
      setSaveStatus('Added habit on this device.');
    } catch { setCreateError("Couldn't add this habit. Your entries are still here. Try Add habit again."); }
    finally { writing.current = false; setSaving(null); }
  }

  return (
    <section>
      <h1>
        Habits
        <button className="mini" style={{ marginLeft: 'auto' }} disabled={saving !== null} onClick={() => { setAdding(!adding); setCreateError(''); setSaveStatus(''); }}>
          {adding ? 'Cancel' : <><Plus size={14} strokeWidth={2} aria-hidden="true" /> New habit</>}
        </button>
      </h1>

      <p className="form-save-status" role="status">{saving ? 'Saving…' : saveStatus}</p>
      {archiveError && <p className="form-save-error" role="alert">{archiveError}</p>}
      {adding && (
        <fieldset className="habit-add save-form" disabled={saving !== null} aria-busy={saving === 'create'}>
          <input
            autoFocus
            value={name}
            placeholder="Habit name (e.g. Read 20 min)"
            aria-label="New habit name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submitHabit();
              if (e.key === 'Escape' && !e.nativeEvent.isComposing) setAdding(false);
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
        {createError && <p className="form-save-error" role="alert">{createError}</p>}
        </fieldset>
      )}

      {active.length === 0 && !adding && (
        <p className="empty">
          {archived.length > 0
            ? 'No active habits. Add one or restore an archived habit below.'
            : 'No habits yet.'}
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
                <button className="mini" title="Edit habit" disabled={saving !== null} onClick={() => (editingId === h.id ? setEditingId(null) : startEdit(h))}>
                  {editingId === h.id ? 'Close' : 'Edit'}
                </button>
                <button className="mini" title="Archive habit" disabled={saving !== null} onClick={() => void changeArchived(h, true)}>
                  Archive
                </button></div>
              </div>
              {editingId === h.id && (
                <fieldset className="habit-add habit-edit save-form" disabled={saving !== null} aria-busy={saving === 'edit'}>
                  <input
                    autoFocus
                    value={editName}
                    aria-label="Habit name"
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveEdit(); if (e.key === 'Escape' && !e.nativeEvent.isComposing) setEditingId(null); }}
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
                {editError && <p className="form-save-error" role="alert">{editError}</p>}
                </fieldset>
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
                        disabled={!c.scheduled || checkPending.has(`${h.id}:${c.date}`)}
                        onClick={() => void toggleCheck(h.id, c.date)}
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
                    disabled={checkPending.has(`${h.id}:${today}`)}
                    onClick={() => void toggleCheck(h.id, today)}
                  >
                    {doneToday ? 'Done today' : 'Mark done'}
                  </button>
                )}
                {[...checkPending].some(key => key.startsWith(`${h.id}:`)) && <p className="workflow-hint" role="status">Saving check-in…</p>}
                {Object.entries(checkErrors).filter(([key]) => key.startsWith(`${h.id}:`)).map(([key, error]) => <p key={key} className="form-save-error" role="alert">{error}</p>)}
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
                  <button className="mini" disabled={saving !== null} onClick={() => void changeArchived(h, false)}>Restore</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
