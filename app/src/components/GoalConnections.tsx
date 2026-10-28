import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { updateGoal } from '../repo';
import type { Goal } from '../types';

export default function GoalConnections({ goal }: { goal: Goal }) {
  const habits = useLiveQuery(() => db.habits.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function toggle(field: 'habitIds' | 'projectIds', id: string, checked: boolean) {
    if (writing.current) return;
    writing.current = true; setBusy(true); setError('');
    try {
      // Read the current goal so unrelated saved connections are preserved.
      await db.transaction('rw', db.goals, async () => {
        const current = await db.goals.get(goal.id);
        if (!current) throw Error('Goal no longer exists');
        const ids = current[field] ?? [];
        await updateGoal(goal.id, { [field]: checked ? [...new Set([...ids, id])] : ids.filter(x => x !== id) });
      });
    } catch { setError("Couldn't save this connection. Try the same checkbox again."); }
    finally { writing.current = false; setBusy(false); }
  }
  return <details className="goal-connections"><summary>Supporting habits and projects</summary>
    <fieldset disabled={busy}><legend>Habits</legend>{(habits ?? []).filter(h => !h.archived || goal.habitIds?.includes(h.id)).map(h => <label key={h.id}><input type="checkbox" checked={goal.habitIds?.includes(h.id) ?? false} onChange={e => void toggle('habitIds', h.id, e.target.checked)} />{h.name}{h.archived ? ' (archived)' : ''}</label>)}{habits?.length === 0 && <p>No habits yet.</p>}</fieldset>
    <fieldset disabled={busy}><legend>Projects</legend>{(projects ?? []).filter(p => p.id !== 'inbox' && (!p.archived || goal.projectIds?.includes(p.id))).map(p => <label key={p.id}><input type="checkbox" checked={goal.projectIds?.includes(p.id) ?? false} onChange={e => void toggle('projectIds', p.id, e.target.checked)} />{p.name}{p.archived ? ' (archived)' : ''}</label>)}</fieldset>
    {error && <p role="alert">{error}</p>}{busy && <p role="status">Saving...</p>}
  </details>;
}
