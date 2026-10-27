import type { Task } from './types';
import { db } from './db';
import { completionGate } from './completionGate';
import { completeWithSubtasks, toggleComplete } from './repo';

export interface CompletionPrompt {
  kind: 'blocked' | 'subtasks';
  task: Task;
  related: Task[];
  resolve: (answer: 'confirm' | 'leave' | 'cancel') => void;
}
let handler: ((prompt: CompletionPrompt | null) => void) | null = null;
let active = false;
export function setCompletionHandler(next: typeof handler) { handler = next; }
function ask(kind: CompletionPrompt['kind'], task: Task, related: Task[]) {
  return new Promise<'confirm' | 'leave' | 'cancel'>(resolve => {
    if (!handler) { resolve('cancel'); return; }
    handler({ kind, task, related, resolve: answer => { handler?.(null); resolve(answer); } });
  });
}
/** Every UI completion uses this route; automatic rule completion stays internal. */
export async function requestComplete(task: Task): Promise<void> {
  if (active) return;
  active = true;
  try {
    const current = await db.tasks.get(task.id);
    if (!current) return;
    if (current.status === 'done') { await toggleComplete(current); return; }
    const gate = completionGate(current, await db.tasks.toArray());
    if (gate.blockers.length && await ask('blocked', current, gate.blockers) !== 'confirm') return;
    if (gate.openSubtasks.length) {
      const choice = await ask('subtasks', current, gate.openSubtasks);
      if (choice === 'cancel') return;
      await completeWithSubtasks(current, choice === 'confirm');
    } else await toggleComplete(current);
  } finally { active = false; }
}
