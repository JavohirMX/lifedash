import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { addTask } from '../repo';
import { parseQuickAdd, describeRecurrence } from '../logic';
import { parseNatural } from '../natural';
import { todayStr, friendlyDate } from '../dates';

export default function QuickAdd(props: { projectId: string; dueDate?: string | null; placeholder?: string }) {
  const [title, setTitle] = useState('');
  // Serialize writes so rapid entries never drop and order stays monotonic.
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  function submit() {
    const t = title.trim();
    if (!t) return;
    setTitle(''); // clear before the async write; fast follow-ups start fresh
    const parsed = parseQuickAdd(t);
    const nat = parseNatural(parsed.title);
    if (!nat.title) return;
    chain.current = chain.current.then(() =>
      addTask({
        title: nat.title,
        tags: parsed.tags,
        projectId: props.projectId,
        dueDate: nat.dueDate ?? props.dueDate ?? null,
        dueTime: nat.dueTime,
        recurrence: nat.recurrence,
        priority: nat.priority,
      }),
    );
  }

  const hint = (() => {
    if (!title.trim()) return null;
    const nat = parseNatural(parseQuickAdd(title).title);
    const bits: string[] = [];
    if (nat.dueDate) bits.push(friendlyDate(nat.dueDate, todayStr()));
    if (nat.dueTime) bits.push(nat.dueTime);
    if (nat.recurrence) bits.push(describeRecurrence(nat.recurrence));
    if (nat.priority) bits.push(`P${nat.priority}`);
    return bits.length ? bits.join(' · ') : null;
  })();

  return (
    <div className="quick-add">
      <Plus size={16} strokeWidth={1.75} aria-hidden="true" className="quick-add-icon" />
      <div className="quick-add-field">
        <input
          value={title}
          placeholder={props.placeholder ?? 'Add a task, press Enter'}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
          }}
        />
        {hint && <span className="quick-add-hint" aria-live="polite">{hint}</span>}
      </div>
    </div>
  );
}
