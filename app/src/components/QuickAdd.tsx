import { useState } from 'react';
import { addTask } from '../repo';

export default function QuickAdd(props: { projectId: string; dueDate?: string | null; placeholder?: string }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const t = title.trim();
    if (!t || busy) return;
    // Clear before the async write: a fast follow-up entry must never be
    // wiped by the previous entry's cleanup.
    setTitle('');
    setBusy(true);
    try {
      await addTask({ title: t, projectId: props.projectId, dueDate: props.dueDate ?? null });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="quick-add">
      <input
        value={title}
        placeholder={props.placeholder ?? 'Add a task... (Enter to save, keep typing)'}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
      />
    </div>
  );
}
