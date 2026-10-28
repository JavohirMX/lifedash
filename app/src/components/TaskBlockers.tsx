import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { addBlocker, removeBlocker } from '../repo';
import { blockersOf, blockerCandidates, normalizeTask } from '../logic';
import type { Task } from '../types';
export default function TaskBlockers(props: { task: Task; tasks: Task[] }) {
  return <BlockersInput key={props.task.id} {...props} />;
}
function BlockersInput({ task, tasks }: { task: Task; tasks: Task[] }) {
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [error, setError] = useState('');
  async function change(action: 'add' | 'remove', id = choice) {
    if (writing.current || !id) return;
    writing.current = true; setBusy(true); setError('');
    try {
      if (action === 'add') {
        const result = await addBlocker(task.id, id);
        if (result.ok) setChoice('');
        else setError(result.reason ?? 'Could not add blocker.');
      } else await removeBlocker(task.id, id);
    } catch { setError(action === 'add' ? "Couldn't add this blocker. Your choice is still here. Try Add again." : "Couldn't remove this blocker. It is still saved. Try its Remove blocker button again."); }
    finally { writing.current = false; setBusy(false); }
  }
  return <div aria-busy={busy}>
    {blockersOf(tasks.map(normalizeTask), normalizeTask(task)).map(blocker => <div key={blocker.id} className={`sub-row ${blocker.status === 'done' ? 'done' : ''}`}>
      <span className={`dep-dot ${blocker.status}`} /><span style={{ flex: 1 }}>{blocker.title}</span>
      <button className="mini" disabled={busy} aria-label={`Remove blocker ${blocker.title}`} onClick={() => void change('remove', blocker.id)}><X size={13} strokeWidth={2} /></button>
    </div>)}
    <div className="dep-add">
      <select aria-label="Add a blocker" value={choice} disabled={busy} onChange={event => setChoice(event.target.value)}>
        <option value="">Add a blocker...</option>
        {blockerCandidates(tasks, task).slice(0, 200).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
      </select>
      <button className="mini" disabled={busy || !choice} onClick={() => void change('add')}>Add</button>
    </div>
    {busy && <p className="sub-add-feedback" role="status">Saving blockers…</p>}
    {error && <p className="dep-error" role="alert">{error}</p>}
  </div>;
}
