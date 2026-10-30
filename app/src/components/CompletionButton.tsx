import { useRef, useState, type ReactNode } from 'react';
import { requestComplete } from '../completionPrompt';
import type { Task } from '../types';
export default function CompletionButton(props: { task: Task; className: string; label: string; showFailure?: boolean; children?: ReactNode }) {
  return <Button key={props.task.id} {...props} />;
}
function Button({ task, className, label, showFailure, children }: { task: Task; className: string; label: string; showFailure?: boolean; children?: ReactNode }) {
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function complete() {
    if (writing.current) return;
    writing.current = true; setBusy(true); setFailed(false);
    try { await requestComplete(task); }
    catch { setFailed(true); /* Global notice also persists after this row unmounts. */ }
    finally { writing.current = false; setBusy(false); }
  }
  return <><button className={className} aria-label={label} disabled={busy} aria-busy={busy} onClick={() => void complete()}>{children}</button>{showFailure && failed && <div role="alert" className="completion-error">Couldn't finish changing "{task.title}". Part of the change may have been saved. Check this task and related tasks before trying again.</div>}</>;
}
