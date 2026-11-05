import './weekly-review.css';
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Sparkles } from 'lucide-react';
import { db } from '../db';
import { getOrCreateJournalEntry, updateJournalEntry } from '../repo';
import { todayStr, friendlyDate } from '../dates';
import { goalsWithoutNextAction, reviewHabit, reviewTasks } from '../review';
import type { Selection } from './Sidebar';
import type { Task } from '../types';
import GoalNextAction from './GoalNextAction';
import { useAiSettings, loadAiSettings } from '../ai/aiSettings';
import { reviewRequest, requestAdvice } from '../ai/provider';

const drafts = new Map<string, { reflection: string; focus: string }>();
window.addEventListener('beforeunload', event => {
  if (drafts.size) { event.preventDefault(); event.returnValue = ''; }
});
// Manual, optional flow. No reminder, automatic changes or scoring.
export default function WeeklyReview({ tasks, onOpen, onNavigate, onClose }: { tasks: Task[]; onOpen: (id: string) => void; onNavigate: (s: Selection) => void; onClose: () => void }) {
  const aiSettings = useAiSettings();
  const [today] = useState(() => [...drafts.keys()].filter(key => key.startsWith(`${db.name}:`)).map(key => key.slice(db.name.length + 1)).sort().at(-1) ?? todayStr());
  const goals = useLiveQuery(() => db.goals.toArray(), []);
  const habits = useLiveQuery(() => db.habits.toArray(), []);
  const logs = useLiveQuery(() => db.habitLogs.toArray(), []);
  const entries = useLiveQuery(() => db.journal.where('date').equals(today).toArray(), [today]);
  const entry = entries?.[0];
  const [step, setStep] = useState(0);
  const draftKey = `${db.name}:${today}`;
  const [reflection, setReflection] = useState<string | null>(() => drafts.get(draftKey)?.reflection ?? null);
  const [focus, setFocus] = useState<string | null>(() => drafts.get(draftKey)?.focus ?? null);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const lists = reviewTasks(tasks, today);
  const noAction = goalsWithoutNextAction(goals ?? [], tasks);
  const labels = ['Inbox', 'Tasks', 'Goals', 'Habits', 'Reflect'];
  const note = reflection ?? entry?.weeklyReview?.reflection ?? '';
  const next = focus ?? entry?.weeklyReview?.focus ?? '';
  const dirty = !saved && (reflection !== null || focus !== null);
  const [draftingAi, setDraftingAi] = useState(false);

  async function handleAiDraftReview() {
    setDraftingAi(true);
    try {
      const s = loadAiSettings();
      const habitSummary = (habits ?? []).filter(h => !h.archived).map(h => {
        const r = reviewHabit(h, logs ?? [], today);
        return `${h.name}: ${r.done}/${r.scheduled} days`;
      }).join(', ');
      const prompt = `Based on my past week:
- Inbox tasks: ${lists.inbox.length}
- Overdue tasks: ${lists.overdue.length}
- Goals without next action: ${noAction.length}
- Habit compliance: ${habitSummary || 'none'}
Draft a concise 2-sentence reflection on progress and 1 clear sentence for next week's core focus. Output format:
Reflection: [text]
Focus: [text]`;

      if (s.baseUrl && s.model) {
        const reviewed = reviewRequest({ baseUrl: s.baseUrl, model: s.model, apiKey: s.apiKey }, prompt, '');
        const res = await requestAdvice({ baseUrl: s.baseUrl, model: s.model, apiKey: s.apiKey }, reviewed, true);
        const refMatch = res.match(/Reflection:\s*([\s\S]*?)(?=Focus:|$)/i);
        const focMatch = res.match(/Focus:\s*([\s\S]*?)$/i);
        const rText = refMatch ? refMatch[1].trim() : res.trim();
        const fText = focMatch ? focMatch[1].trim() : 'Maintain steady momentum on top priorities.';
        setReflection(rText);
        setFocus(fText);
        drafts.set(draftKey, { reflection: rText, focus: fText });
        setSaved(false);
        setDraftingAi(false);
        return;
      }
    } catch {
      // Fallback to local heuristic draft
    }

    const rText = lists.overdue.length > 0
      ? `Focused on core work but accumulated ${lists.overdue.length} overdue task${lists.overdue.length === 1 ? '' : 's'}. Habits and routine remained consistent.`
      : 'Had a clean week with steady task throughput and good progress on active commitments.';
    const fText = noAction.length > 0
      ? `Re-align open goals by defining clear next actions and reducing inbox backlog.`
      : 'Protect deep-work blocks and maintain daily habit consistency.';

    setReflection(rText);
    setFocus(fText);
    drafts.set(draftKey, { reflection: rText, focus: fText });
    setSaved(false);
    setDraftingAi(false);
  }
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function leave(action: () => void) { if (!dirty || window.confirm('Leave without saving this review?')) { drafts.delete(draftKey); action(); } }
  function navigate(s: Selection) { leave(() => onNavigate(s)); }
  async function save() {
    if (writing.current || entries === undefined) return;
    writing.current = true; setBusy(true); setError(''); setSaved(false);
    try {
      await db.transaction('rw', db.journal, async () => {
        const target = await getOrCreateJournalEntry(today);
        await updateJournalEntry(target.id, { weeklyReview: { reflection: note.trim(), focus: next.trim(), reviewedAt: Date.now() } });
      });
      drafts.delete(draftKey); setSaved(true);
    } catch { setError("Couldn't save your review. Your words are still here. Try Save review again."); }
    finally { writing.current = false; setBusy(false); }
  }
  const taskButtons = (items: Task[]) => <ul className="review-links">{items.map(t => <li key={t.id}><button className="mini" onClick={() => leave(() => onOpen(t.id))}>{t.title}</button>{t.dueDate && <span className="date-sub">{friendlyDate(t.dueDate, today)}</span>}</li>)}</ul>;
  return <section className="weekly-review" aria-label="Weekly review">
    <header><h2>Weekly review</h2><button className="mini" onClick={() => leave(onClose)} disabled={busy}>Close review</button></header>
    <nav aria-label="Review steps">{labels.map((label, i) => <button key={label} className="mini" aria-current={step === i ? 'step' : undefined} onClick={() => setStep(i)}>{i + 1}. {label}</button>)}</nav>
    {step === 0 && <div><h3>Clear your Inbox</h3><p>{lists.inbox.length} open tasks in Inbox</p>{taskButtons(lists.inbox)}<button className="mini" onClick={() => navigate({ kind: 'project', id: 'inbox' })}>Open Inbox</button></div>}
    {step === 1 && <div><h3>Overdue</h3>{lists.overdue.length ? taskButtons(lists.overdue) : <p>No overdue tasks.</p>}<h3>Unchanged for 14 days</h3>{lists.unchanged.length ? taskButtons(lists.unchanged) : <p>No older unchanged tasks.</p>}</div>}
    {step === 2 && <div><h3>Goals without an open next action</h3>{goals === undefined ? <p>Loading goals...</p> : noAction.length ? noAction.map(g => <div className="review-goal" key={g.id}><strong>{g.title}</strong><GoalNextAction goalId={g.id} /></div>) : <p>Every active goal has an open task, or no active goals yet.</p>}<p className="date-sub">Task completion and goal progress stay separate.</p></div>}
    {step === 3 && <div><h3>Habits over the last 7 days</h3>{habits === undefined || logs === undefined ? <p>Loading habits...</p> : <ul>{habits.filter(h => !h.archived).map(h => { const r = reviewHabit(h, logs, today); return <li key={h.id}>{h.name}: {r.done} of {r.scheduled} scheduled days</li>; })}</ul>}<button className="mini" onClick={() => navigate({ kind: 'habits' })}>Open Habits</button></div>}
    {step === 4 && <div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h3>What will you carry into next week?</h3>{aiSettings.enabled && (<button type="button" className="mini" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} disabled={draftingAi || busy} onClick={() => void handleAiDraftReview()}><Sparkles size={12} color="var(--accent, #0f766e)" /><span>{draftingAi ? 'Drafting…' : 'Draft with AI'}</span></button>)}</div><p className="date-sub">Saved with the journal for {friendlyDate(today, todayStr())}. Existing journal text stays unchanged.</p><label>Reflection<textarea aria-label="Reflection" value={note} disabled={busy || entries === undefined} onChange={e => { setReflection(e.target.value); drafts.set(draftKey, { reflection: e.target.value, focus: next }); setSaved(false); }} /></label><label>Next week's focus<textarea aria-label="Next week's focus" value={next} disabled={busy || entries === undefined} onChange={e => { setFocus(e.target.value); drafts.set(draftKey, { reflection: note, focus: e.target.value }); setSaved(false); }} /></label><button className="btn-primary" disabled={busy || entries === undefined || (!note.trim() && !next.trim())} onClick={() => void save()}>{busy ? 'Saving...' : 'Save review'}</button>{error && <p role="alert">{error}</p>}{saved && <p role="status">Review saved on this device.</p>}</div>}
    <footer>{step > 0 && <button className="mini" onClick={() => setStep(step - 1)}>Back</button>}{step < 4 && <button className="btn-primary" onClick={() => setStep(step + 1)}>Next</button>}</footer>
  </section>;
}
