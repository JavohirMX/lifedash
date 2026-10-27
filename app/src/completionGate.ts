import type { Task } from './types';
export type CompletionGate = { blockers: Task[]; openSubtasks: Task[] };
export function completionGate(task: Task, tasks: Task[]): CompletionGate {
  if (task.status === 'done') return { blockers: [], openSubtasks: [] };
  return {
    blockers: tasks.filter(t => (task.blockedBy ?? []).includes(t.id) && t.status === 'active'),
    openSubtasks: tasks.filter(t => t.parentId === task.id && t.status === 'active'),
  };
}
