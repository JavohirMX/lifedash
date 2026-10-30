import { useRef, useState } from 'react';
import { addTask } from '../repo';
import { INBOX_ID } from '../db';
import type { Task } from '../types';

export default function SubtaskAdd({ task }: { task: Task }) {
  return <ParentSubtaskAdd key={task.id} task={task} />;
}
function ParentSubtaskAdd({ task }: { task: Task }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  async function submit() {
    if (writing.current || !title.trim()) return;
    writing.current = true; setBusy(true); setError(''); setStatus('');
    try {
      await addTask({ title, projectId: task.projectId || INBOX_ID, parentId: task.id, dueDate: task.dueDate });
      setTitle(''); setStatus('Added subtask on this device.');
    } catch { setError("Couldn't add this subtask. Your text is still here. Try Add subtask again."); }
    finally { writing.current = false; setBusy(false); }
  }
  return <div className="sub-add" aria-busy={busy}>
    <form className="sub-add-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <input aria-label="New subtask title" value={title} disabled={busy} placeholder="Add a subtask..."
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} />
      <button className="mini" type="submit" disabled={busy || !title.trim()}>Add subtask</button>
    </form>
    <p className="sub-add-feedback" role="status">{busy ? 'Saving subtask…' : status}</p>
    {error && <p className="sub-add-feedback" role="alert">{error}</p>}
  </div>;
}
