import { useEffect, useRef, useState } from 'react';
import { deleteTask } from '../repo';
import type { Task } from '../types';
export default function TaskDelete(props: { task: Task; onClose: () => void }) {
  return <DeleteButton key={props.task.id} {...props} />;
}
function DeleteButton({ task, onClose }: { task: Task; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const writing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function remove() {
    if (writing.current) return;
    writing.current = true; setBusy(true); setError('');
    try { await deleteTask(task); if (mounted.current) onClose(); }
    catch { if (mounted.current) setError("Couldn't delete this task. Nothing was deleted. Try Delete task again."); }
    finally { writing.current = false; if (mounted.current) setBusy(false); }
  }
  return <div className="task-delete-feedback" aria-busy={busy}>
    <button className="danger" disabled={busy} onClick={() => void remove()}>Delete task</button>
    {busy && <p className="sub-add-feedback" role="status">Deleting task…</p>}
    {error && <p className="sub-add-feedback" role="alert">{error}</p>}
  </div>;
}
