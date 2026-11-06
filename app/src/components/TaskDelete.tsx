import { useEffect, useRef, useState } from 'react';
import { deleteTask } from '../repo';
import type { Task } from '../types';

export default function TaskDelete(props: { task: Task; onClose: () => void }) {
  return <DeleteButton key={props.task.id} {...props} />;
}

function DeleteButton({ task, onClose }: { task: Task; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const writing = useRef(false);
  const mounted = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function promptConfirm() {
    setError('');
    setConfirming(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (mounted.current) setConfirming(false);
    }, 4000);
  }

  function cancelConfirm() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setConfirming(false);
  }

  async function remove() {
    if (writing.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      await deleteTask(task);
      if (mounted.current) onClose();
    } catch {
      if (mounted.current) {
        setConfirming(false);
        setError("Couldn't delete this task. Nothing was deleted. Try Delete task again.");
      }
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div className="task-delete-feedback" aria-busy={busy}>
      {!confirming ? (
        <button
          type="button"
          className="danger task-delete-trigger"
          disabled={busy}
          onClick={promptConfirm}
        >
          Delete task
        </button>
      ) : (
        <div className="delete-confirm-box" role="alertdialog" aria-label="Confirm task deletion">
          <span className="delete-confirm-text">Delete this task?</span>
          <div className="delete-confirm-actions">
            <button
              type="button"
              className="danger delete-confirm-btn"
              disabled={busy}
              onClick={() => void remove()}
            >
              Confirm delete
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={cancelConfirm}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {busy && <p className="sub-add-feedback" role="status">Deleting task…</p>}
      {error && <p className="sub-add-feedback" role="alert">{error}</p>}
    </div>
  );
}
