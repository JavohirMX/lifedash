import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { addTask } from '../repo';
import { parseQuickAdd } from '../logic';

export default function QuickAdd(props: { projectId: string; dueDate?: string | null; placeholder?: string }) {
  const [title, setTitle] = useState('');
  // Serialize writes so rapid entries never drop and order stays monotonic.
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  function submit() {
    const t = title.trim();
    if (!t) return;
    setTitle(''); // clear before the async write; fast follow-ups start fresh
    const parsed = parseQuickAdd(t);
    if (!parsed.title) return;
    chain.current = chain.current.then(() =>
      addTask({ title: parsed.title, tags: parsed.tags, projectId: props.projectId, dueDate: props.dueDate ?? null }),
    );
  }

  return (
    <div className="quick-add">
      <Plus size={16} strokeWidth={1.75} aria-hidden="true" className="quick-add-icon" />
      <input
        value={title}
        placeholder={props.placeholder ?? 'Add a task, press Enter'}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}
