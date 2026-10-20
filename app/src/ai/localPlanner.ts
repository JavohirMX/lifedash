/** On-device rule-based planning summary. No model, no network, no account.
 *  It sorts the tasks the user explicitly shared by due date and priority.
 *  It does not interpret free text and never changes data. */

export interface LocalPlanTask {
  title: string;
  dueDate: string | null;
  dueTime?: string | null;
  priority: number;
  status: string;
}

function todayISO(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function localPlan(prompt: string, tasks: LocalPlanTask[], now: Date = new Date()): string {
  const today = todayISO(now);
  const active = tasks.filter((t) => t.status === 'active');
  const overdue = active.filter((t) => t.dueDate && t.dueDate < today);
  const dueToday = active.filter((t) => t.dueDate === today);
  const later = active.filter((t) => t.dueDate && t.dueDate > today).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  const undated = active.filter((t) => !t.dueDate);
  const high = undated.filter((t) => t.priority >= 3);
  const rest = undated.filter((t) => t.priority < 3);

  const lines: string[] = [];
  lines.push('On-device summary (rule-based - no model involved, nothing left this device).');
  lines.push('');
  if (prompt.trim()) {
    lines.push(`Your request: "${prompt.trim().slice(0, 200)}"`);
    lines.push('Note: the on-device summary cannot interpret free text; it ranks by due date and priority only.');
    lines.push('');
  }
  if (active.length === 0) {
    lines.push('No active tasks were shared, so there is nothing to rank. Share tasks above to get an order.');
    return lines.join('\n');
  }
  let n = 0;
  const item = (t: LocalPlanTask, why: string) => `${++n}. ${t.title} - ${why}`;
  if (overdue.length) {
    lines.push(`Overdue first (${overdue.length}):`);
    for (const t of overdue) lines.push(item(t, `was due ${t.dueDate}`));
    lines.push('');
  }
  if (dueToday.length) {
    const sorted = [...dueToday].sort((a, b) => String(a.dueTime ?? '99').localeCompare(String(b.dueTime ?? '99')));
    lines.push(`Due today (${dueToday.length}):`);
    for (const t of sorted) lines.push(item(t, t.dueTime ? `due at ${t.dueTime}` : 'due today'));
    lines.push('');
  }
  if (high.length) {
    lines.push(`High priority, no date (${high.length}):`);
    for (const t of high) lines.push(item(t, `priority ${t.priority}`));
    lines.push('');
  }
  if (later.length) {
    lines.push(`Coming up (${later.length}):`);
    for (const t of later.slice(0, 10)) lines.push(item(t, `due ${t.dueDate}`));
    if (later.length > 10) lines.push(`   ...and ${later.length - 10} more dated tasks.`);
    lines.push('');
  }
  if (rest.length) {
    lines.push(`Everything else (${rest.length}, undated):`);
    for (const t of rest.slice(0, 10)) lines.push(item(t, 'no date set'));
    if (rest.length > 10) lines.push(`   ...and ${rest.length - 10} more undated tasks.`);
    lines.push('');
  }
  lines.push('Review this yourself. Nothing has been changed.');
  return lines.join('\n');
}
