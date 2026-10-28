import { useRef, useState, type ReactNode } from 'react';
import { requestComplete } from '../completionPrompt';
import type { Task } from '../types';
export default function CompletionButton(props: { task: Task; className: string; label: string; children?: ReactNode }) {
  return <Button key={props.task.id} {...props} />;
}
function Button({ task, className, label, children }: { task: Task; className: string; label: string; children?: ReactNode }) {
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  async function complete() {
    if (writing.current) return;
    writing.current = true; setBusy(true);
    try { await requestComplete(task); }
    catch { /* The completion route publishes the persistent failure notice. */ }
    finally { writing.current = false; setBusy(false); }
  }
  return <button className={className} aria-label={label} disabled={busy} aria-busy={busy} onClick={() => void complete()}>{children}</button>;
}
