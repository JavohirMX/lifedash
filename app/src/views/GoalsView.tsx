import GoalNextAction from '../components/GoalNextAction';
import GoalConnections from '../components/GoalConnections';
import WeeklyReview from '../components/WeeklyReview';
import type { Selection } from '../components/Sidebar';
import './workflow.css';
import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ChevronDown, ChevronRight, Pencil, Plus, Target, X } from 'lucide-react';
import { db } from '../db';
import { addGoal, updateGoal } from '../repo';
import TaskList from '../components/TaskList';
import { todayStr, friendlyDate } from '../dates';
import type { Goal, Task } from '../types';

function goalProgress(tasks: Task[], goalId: string): { done: number; total: number } {
  const linked = tasks.filter((t) => t.goalId === goalId && t.status !== 'archived');
  return { done: linked.filter((t) => t.status === 'done').length, total: linked.length };
}

export default function GoalsView(props: { tasks: Task[]; onOpen: (id: string) => void; onNavigate: (s: Selection) => void }) {
  const goals = useLiveQuery(() => db.goals.orderBy('order').toArray(), []);
  const [adding, setAdding] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const writing = useRef(false);
  const [saving, setSaving] = useState<'create' | 'edit' | 'status' | null>(null);
  const [createError, setCreateError] = useState('');
  const [editError, setEditError] = useState('');
  const [saveStatus, setSaveStatus] = useState('');

  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editTarget, setEditTarget] = useState('');

  function startEdit(g: Goal) {
    if (writing.current) return;
    setEditError(''); setSaveStatus('');
    setEditingId(g.id);
    setEditTitle(g.title);
    setEditTarget(g.targetDate ?? '');
  }

  async function saveEdit() {
    if (writing.current || !editingId || !editTitle.trim()) return;
    writing.current = true; setSaving('edit'); setEditError(''); setSaveStatus('');
    try {
      await updateGoal(editingId, { title: editTitle.trim(), targetDate: editTarget || null });
      setEditingId(null);
      setSaveStatus('Saved goal on this device.');
    } catch { setEditError("Couldn't save this goal. Your changes are still here. Try Save again."); }
    finally { writing.current = false; setSaving(null); }
  }
  const [statusError, setStatusError] = useState('');
  async function changeStatus(goal: Goal, status: Goal['status']) {
    if (writing.current) return;
    writing.current = true; setSaving('status'); setStatusError(''); setSaveStatus('');
    try { await updateGoal(goal.id, { status }); }
    catch { setStatusError(`Couldn't change the status of "${goal.title}". Try the same button again.`); }
    finally { writing.current = false; setSaving(null); }
  }
  const today = todayStr();

  const active = (goals ?? []).filter((g) => g.status === 'active');
  const done = (goals ?? []).filter((g) => g.status === 'done');

  async function submit() {
    if (writing.current || !title.trim()) return;
    writing.current = true; setSaving('create'); setCreateError(''); setSaveStatus('');
    try {
      await addGoal(title, target || null);
      setTitle(''); setTarget('');
      setAdding(false);
      setSaveStatus('Added goal on this device.');
    } catch { setCreateError("Couldn't add this goal. Your entries are still here. Try Add goal again."); }
    finally { writing.current = false; setSaving(null); }
  }

  return (
    <section>
      <h1>
        Goals <span className="date-sub">{active.length} active</span>
        <button className="mini" style={{ marginLeft: 'auto' }} disabled={saving !== null} onClick={() => { setAdding(!adding); setCreateError(''); setSaveStatus(''); }} aria-label="New goal">
          <Plus size={14} strokeWidth={2} aria-hidden="true" /> Goal
        </button>
      </h1>
      {!reviewOpen && <button className="mini" onClick={() => setReviewOpen(true)}>Weekly review</button>}
      {reviewOpen && <WeeklyReview tasks={props.tasks} onOpen={props.onOpen} onNavigate={props.onNavigate} onClose={() => setReviewOpen(false)} />}
      <p className="workflow-hint">Progress tracks linked tasks. Marking a goal done is separate.</p>
      <p className="form-save-status" role="status">{saving ? 'Saving…' : saveStatus}</p>
      {statusError && <p className="form-save-error" role="alert">{statusError}</p>}
      {adding && (
        <fieldset className="goal-add save-form" disabled={saving !== null} aria-busy={saving === 'create'}>
          <input
            autoFocus
            value={title}
            placeholder="Goal (e.g. Run a 10k)"
            aria-label="New goal title"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit();
              if (e.key === 'Escape' && !e.nativeEvent.isComposing) setAdding(false);
            }}
          />
          <input type="date" value={target} aria-label="Target date (optional)" onChange={(e) => setTarget(e.target.value)} />
          <button className="btn-primary" onClick={submit} disabled={!title.trim()}>Add goal</button>
          <button className="mini" onClick={() => setAdding(false)}>Cancel</button>
        {createError && <p className="form-save-error" role="alert">{createError}</p>}
        </fieldset>
      )}
      {active.length === 0 && !adding && (
        <div className="empty goals-empty">
          <Target size={28} strokeWidth={1.5} aria-hidden="true" />
          <p>No active goals. Add a goal, then choose its next action.</p>
        </div>
      )}
      <div className="goal-list">
        {active.map((g) => {
          const p = goalProgress(props.tasks, g.id);
          const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
          const overdue = g.targetDate !== null && g.targetDate < today;
          return (
            <div key={g.id} className="goal-card">
              <div className="goal-top">
                <strong>{g.title}</strong>
                <div className="goal-actions">
                  <button className="icon-btn" aria-label={`Edit ${g.title}`} title="Edit" disabled={saving !== null}
                    onClick={() => (editingId === g.id ? setEditingId(null) : startEdit(g))}>
                    <Pencil size={15} strokeWidth={2} />
                  </button>
                  <button className="icon-btn" aria-label={`Mark ${g.title} done`} title="Mark done" disabled={saving !== null}
                    onClick={() => void changeStatus(g, 'done')}>
                    <Check size={15} strokeWidth={2} />
                  </button>
                  <button className="icon-btn" aria-label={`Archive ${g.title}`} title="Archive" disabled={saving !== null}
                    onClick={() => void changeStatus(g, 'archived')}>
                    <X size={15} strokeWidth={2} />
                  </button>
                </div>
              </div>
              {editingId === g.id ? (
                <fieldset className="goal-add goal-edit save-form" disabled={saving !== null} aria-busy={saving === 'edit'}>
                  <input
                    autoFocus
                    value={editTitle}
                    aria-label="Goal title"
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveEdit(); if (e.key === 'Escape' && !e.nativeEvent.isComposing) setEditingId(null); }}
                  />
                  <input type="date" value={editTarget} aria-label="Target date (optional)" onChange={(e) => setEditTarget(e.target.value)} />
                  <button className="btn-primary" onClick={saveEdit} disabled={!editTitle.trim()}>Save</button>
                  <button className="mini" onClick={() => setEditingId(null)}>Cancel</button>
                {editError && <p className="form-save-error" role="alert">{editError}</p>}
                </fieldset>
              ) : (
                <>
                  <div className="progress"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
                  <div className="goal-meta">
                    {p.total > 0 ? (
                      <button
                        className="goal-tasks-toggle num"
                        aria-expanded={expandedId === g.id}
                        onClick={() => setExpandedId((cur) => (cur === g.id ? null : g.id))}
                      >
                        {expandedId === g.id
                          ? <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
                          : <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />}
                        {pct}% · {p.done} of {p.total} tasks
                      </button>
                    ) : (
                      <span className="num">No linked tasks yet</span>
                    )}
                    {g.targetDate && (
                      <span className={overdue ? 'goal-when overdue' : 'goal-when'}>{friendlyDate(g.targetDate, today)}</span>
                    )}
                  </div>
                  <GoalNextAction goalId={g.id} />
                  <GoalConnections goal={g} />
                  {expandedId === g.id && p.total > 0 && (
                    <div className="goal-tasks">
                      <TaskList
                        tasks={props.tasks
                          .filter((t) => t.goalId === g.id && t.status !== 'archived')
                          .sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0) || a.order - b.order)}
                        allTasks={props.tasks}
                        showDate
                        onOpen={props.onOpen}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      {done.length > 0 && (
        <>
          <h2 className="goal-done-h">Done</h2>
          <div className="goal-list">
            {done.map((g) => (
              <div key={g.id} className="goal-card done">
                <div className="goal-top">
                  <strong>{g.title}</strong>
                  <button className="icon-btn" aria-label={`Reopen ${g.title}`} title="Reopen" disabled={saving !== null}
                    onClick={() => void changeStatus(g, 'active')}>
                    <Check size={15} strokeWidth={2} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
