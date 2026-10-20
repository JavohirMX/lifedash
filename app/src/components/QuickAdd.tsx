import { useRef, useState } from 'react';
import { addTask } from '../repo';

export default function QuickAdd(props: { projectId: string; dueDate?: string | null; placeholder?: string }) {
  const [title, setTitle] = useState('');
  // Serialize writes so rapid entries never drop and order stays monotonic.
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  function submit() {
    const t = title.trim();
    if (!t) return;
    setTitle(''); // clear before the async write; fast follow-ups start fresh
    chain.current = chain.current.then(() =>
      addTask({ title: t, projectId: props.projectId, dueDate: props.dueDate ?? null }),
    );
  }

  return (
    <div className="quick-add">
      <input
        value={title}
        placeholder={props.placeholder ?? 'Add a task... (Enter to save, keep typing)'}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
    </div>
  );
}
