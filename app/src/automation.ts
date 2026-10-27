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

// --- User-defined rules (SPEC Phase 5) ---
// Rules run ONLY while Lifedash is open - never in the background.

export type UserRuleTrigger =
  | { kind: 'tag'; tag: string } // fires when a task carrying this tag completes
  | { kind: 'weekly'; weekday: number }; // 0=Sun; fires on app open, once per day

export interface UserRule {
  id: string;
  trigger: UserRuleTrigger;
  title: string; // title of the task to create
  createdAt: number;
  lastFired: string | null; // local YYYY-MM-DD; stamped even when creation is skipped
}

const USER_KEY = 'lifedash-user-rules';

export function loadUserRules(): UserRule[] {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UserRule[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveUserRules(rules: UserRule[]): void {
  localStorage.setItem(USER_KEY, JSON.stringify(rules));
}

/** An open task with the same title blocks every rule - rules never duplicate. */
export function hasOpenTitle(tasks: Task[], title: string): boolean {
  const norm = title.trim().toLowerCase();
  return tasks.some((t) => t.status === 'active' && t.title.trim().toLowerCase() === norm);
}

/** Tag rules due when a task carrying the trigger tag was just completed. */
export function tagRulesFor(rules: UserRule[], task: Task): UserRule[] {
  return rules.filter((r) => r.trigger.kind === 'tag' && task.tags.includes(r.trigger.tag));
}

/** Weekly rules due on app open: matching weekday, not already fired today. */
export function weeklyRulesDue(rules: UserRule[], today: string, weekday: number): UserRule[] {
  return rules.filter((r) => r.trigger.kind === 'weekly' && r.trigger.weekday === weekday && r.lastFired !== today);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function describeUserRule(rule: UserRule): string {
  if (rule.trigger.kind === 'tag') return `When a #${rule.trigger.tag} task completes`;
  return `Every ${WEEKDAYS[rule.trigger.weekday]} when you open Lifedash`;
}
