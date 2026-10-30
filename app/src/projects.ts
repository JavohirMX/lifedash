import type { Project } from './types';

// Pure helpers for nested projects. Projects form a forest: parentId
// points at another project, absent/null means top level.

const parentOf = (p: Project) => p.parentId ?? null;

/** True when making `id` a child of `newParentId` would create a cycle
 *  (new parent is the project itself or one of its descendants), or when
 *  the ancestry chain is already broken (a cycle exists upstream). */
export function wouldCycle(projects: Project[], id: string, newParentId: string | null): boolean {
  if (newParentId === null) return false;
  if (newParentId === id) return true;
  const byId = new Map(projects.map((p) => [p.id, p]));
  let cur: string | null = newParentId;
  const seen = new Set<string>([id]);
  while (cur !== null) {
    if (seen.has(cur)) return true;
    seen.add(cur);
    const parent: Project | undefined = byId.get(cur);
    if (!parent) return true; // dangling parent reference: refuse
    cur = parentOf(parent);
  }
  return false;
}

/** Depth-first flatten of the project forest for rendering: parents in
 *  `order`, each followed by its children (also in `order`), with depth
 *  for indentation. Children of missing parents surface at top level
 *  rather than vanishing. */
export function projectTree(projects: Project[]): { project: Project; depth: number }[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const children = new Map<string | null, Project[]>();
  for (const p of projects) {
    let parent = parentOf(p);
    if (parent !== null && !byId.has(parent)) parent = null; // orphaned: treat as top level
    const list = children.get(parent) ?? [];
    list.push(p);
    children.set(parent, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order);
  const out: { project: Project; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const p of children.get(parent) ?? []) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({ project: p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  // Bad data (e.g. a sync merge that closed a cycle) must not make
  // projects vanish: anything unreached surfaces at top level.
  for (const p of projects) {
    if (!seen.has(p.id)) out.push({ project: p, depth: 0 });
  }
  return out;
}

/** True when the given rows contain a parent cycle or a parent that
 *  points at a missing project (possible in imported/merged data). */
export function hasProjectCycle(projects: Project[]): boolean {
  const byId = new Map(projects.map((p) => [p.id, p]));
  for (const p of projects) {
    let cur: string | null = parentOf(p);
    if (cur !== null && !byId.has(cur)) return true;
    const seen = new Set<string>([p.id]);
    while (cur !== null) {
      if (seen.has(cur)) return true;
      seen.add(cur);
      cur = parentOf(byId.get(cur)!);
    }
  }
  return false;
}

/** Ids of the project itself plus all descendant projects. */
export function projectWithDescendants(projects: Project[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of projects) {
      const par = parentOf(p);
      if (par !== null && out.has(par) && !out.has(p.id)) {
        out.add(p.id);
        grew = true;
      }
    }
  }
  return out;
}
