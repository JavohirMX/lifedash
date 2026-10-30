import { useRef, useState } from 'react';
import { INBOX_ID } from '../db';
import { addTask } from '../repo';

export default function GoalNextAction({ goalId }: { goalId: string }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const writing = useRef(false);
  const [error, setError] = useState('');
  async function submit() {
    if (writing.current || !title.trim()) return;
    writing.current = true; setBusy(true); setError(''); setMessage('');
    const submitted = title.trim();
    try { await addTask({ title: submitted, projectId: INBOX_ID, goalId }); setTitle(''); setMessage(`Added: ${submitted}`); }
    catch { setError("Couldn't add the next action. Your text is still here. Try again."); }
    finally { writing.current = false; setBusy(false); }
  }
  return <form className="goal-next-action" onSubmit={e => { e.preventDefault(); void submit(); }}>
    <label>Next action<input aria-label="Next action title" value={title} disabled={busy} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault(); }} placeholder="One concrete step" /></label>
    <button className="mini" disabled={busy || !title.trim()}>{busy ? 'Adding...' : 'Add next action'}</button>
    {error && <p role="alert">{error}</p>}<p role="status">{message}</p>
  </form>;
}
