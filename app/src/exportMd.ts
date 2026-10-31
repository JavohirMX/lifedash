import type { Task, Project } from './types';
import { sortTasks } from './logic';

/**
 * Markdown export (SPEC names Markdown alongside JSON as an export target).
 * Tasks only - JSON remains the full-fidelity backup. The layout matches the
 * Obsidian-style importer (parseObsidianMd) so an export re-imports cleanly:
 * project headings, "- [ ]"/"- [x]" lines, #tags, a due date, 2-space indent
 * per subtask level.
 */
export function tasksToMarkdown(tasks: Task[], projects: Project[]): string {
  const lines: string[] = [];
  const orderedProjects = [...projects].sort((a, b) => a.order - b.order);

  const emitTask = (t: Task, depth: number) => {
    const indent = '  '.repeat(depth);
    const box = t.status === 'done' ? '[x]' : '[ ]';
    const tags = (t.tags ?? []).map((x) => `#${x}`).join(' ');
    const due = t.dueDate ? ` 📅 ${t.dueDate}` : '';
    const tagPart = tags ? ` ${tags}` : '';
    lines.push(`${indent}- ${box} ${t.title}${tagPart}${due}`);
    for (const c of orderedChildren(tasks, t.id)) emitTask(c, depth + 1);
  };

  const groups: { name: string; tasks: Task[] }[] = [];
  for (const p of orderedProjects) {
    if (p.archived) continue;
    const ts = tasks.filter((t) => t.projectId === p.id && t.parentId === null && t.status !== 'archived');
    if (ts.length > 0) groups.push({ name: p.name, tasks: ts });
  }
  // Orphaned or archived-project tasks land under "Other".
  const known = new Set(orderedProjects.filter((p) => !p.archived).map((p) => p.id));
  const other = tasks.filter((t) => !known.has(t.projectId) && t.parentId === null && t.status !== 'archived');
  if (other.length > 0) groups.push({ name: 'Other', tasks: other });

  for (const g of groups) {
    // Open tasks pinned-first; completed last.
    const open = sortTasks(g.tasks.filter((t) => t.status === 'active'));
    const done = sortTasks(g.tasks.filter((t) => t.status === 'done'));
    lines.push(`# ${g.name}`);
    for (const t of [...open, ...done]) emitTask(t, 0);
    lines.push('');
  }
  return lines.join('\n');
}

function orderedChildren(tasks: Task[], parentId: string): Task[] {
  const kids = tasks.filter((t) => t.parentId === parentId && t.status !== 'archived');
  const open = sortTasks(kids.filter((t) => t.status === 'active'));
  const done = sortTasks(kids.filter((t) => t.status === 'done'));
  return [...open, ...done];
}
