import type { Task } from './types';

export interface AutomationRules {
  rollover: boolean;
  completeParent: boolean;
}

const KEY = 'lifedash-rules';

export const DEFAULT_RULES: AutomationRules = { rollover: false, completeParent: false };

export function loadRules(): AutomationRules {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_RULES };
    return { ...DEFAULT_RULES, ...(JSON.parse(raw) as Partial<AutomationRules>) };
  } catch {
    return { ...DEFAULT_RULES };
  }
}

export function saveRules(rules: AutomationRules): void {
  localStorage.setItem(KEY, JSON.stringify(rules));
}

/** Active tasks due before today that the rollover rule moves into Today. */
export function rolloverTargets(tasks: Task[], today: string): string[] {
  return tasks
    .filter((t) => t.status === 'active' && t.dueDate !== null && t.dueDate < today)
    .map((t) => t.id);
}

/**
 * True when every subtask of parentId is done and the parent itself is still
 * active - the point at which the parent auto-completes.
 */
export function shouldCompleteParent(tasks: Task[], parentId: string): boolean {
  const parent = tasks.find((t) => t.id === parentId);
  if (!parent || parent.status !== 'active') return false;
  const children = tasks.filter((t) => t.parentId === parentId);
  return children.length > 0 && children.every((c) => c.status === 'done');
}
