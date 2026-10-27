import { describe, expect, it } from 'vitest';
import { hasProjectCycle, projectTree, projectWithDescendants, wouldCycle } from './projects';
import type { Project } from './types';

let seq = 0;
function proj(name: string, parentId: string | null = null, over: Partial<Project> = {}): Project {
  seq++;
  return { id: `p${seq}`, name, color: '#000', order: seq, archived: false, parentId, ...over };
}

describe('wouldCycle', () => {
  it('rejects self-parenting', () => {
    const a = proj('a');
    expect(wouldCycle([a], a.id, a.id)).toBe(true);
  });
  it('rejects making a project a child of its descendant', () => {
    const a = proj('a');
    const b = proj('b', a.id);
    const c = proj('c', b.id);
    expect(wouldCycle([a, b, c], a.id, c.id)).toBe(true);
    expect(wouldCycle([a, b, c], a.id, b.id)).toBe(true);
  });
  it('allows a valid parent and clearing the parent', () => {
    const a = proj('a');
    const b = proj('b');
    const c = proj('c', a.id);
    expect(wouldCycle([a, b, c], b.id, a.id)).toBe(false);
    expect(wouldCycle([a, b, c], c.id, null)).toBe(false);
  });
  it('rejects a dangling parent reference', () => {
    const a = proj('a');
    expect(wouldCycle([a], a.id, 'missing')).toBe(true);
  });
});

describe('projectTree', () => {
  it('flattens parents followed by children, ordered, with depth', () => {
    const side = proj('Side projects');
    const lifedash = proj('Lifedash', side.id);
    const firo = proj('Firo', side.id);
    const work = proj('Work');
    const inner = proj('Inner', lifedash.id);
    const tree = projectTree([work, firo, inner, lifedash, side]);
    expect(tree.map((t) => t.project.name)).toEqual(['Side projects', 'Lifedash', 'Inner', 'Firo', 'Work']);
    expect(tree.map((t) => t.depth)).toEqual([0, 1, 2, 1, 0]);
  });
  it('surfaces orphans at top level instead of dropping them', () => {
    const a = proj('orphan', 'gone');
    const tree = projectTree([a]);
    expect(tree).toHaveLength(1);
    expect(tree[0].depth).toBe(0);
  });
});

describe('bad-data guards', () => {
  it('hasProjectCycle catches a two-project cycle', () => {
    const a = proj('a');
    const b = proj('b', a.id);
    a.parentId = b.id;
    expect(hasProjectCycle([a, b])).toBe(true);
  });
  it('hasProjectCycle catches a dangling parent and passes clean trees', () => {
    const orphan = proj('orphan', 'gone');
    expect(hasProjectCycle([orphan])).toBe(true);
    const a = proj('a');
    const b = proj('b', a.id);
    expect(hasProjectCycle([a, b])).toBe(false);
    const legacy = proj('legacy');
    delete (legacy as { parentId?: string | null }).parentId; // pre-nesting rows
    expect(hasProjectCycle([legacy, a, b])).toBe(false);
  });
  it('projectTree never drops projects, even inside a cycle', () => {
    const a = proj('a');
    const b = proj('b', a.id);
    a.parentId = b.id;
    const c = proj('c', b.id);
    const tree = projectTree([a, b, c]);
    expect(tree).toHaveLength(3);
    expect(tree.some((t) => t.project.name === 'c')).toBe(true);
  });
  it('treats legacy rows without the parentId field as top level', () => {
    const legacy = proj('legacy');
    delete (legacy as { parentId?: string | null }).parentId;
    const tree = projectTree([legacy]);
    expect(tree[0].depth).toBe(0);
    expect(wouldCycle([legacy], legacy.id, null)).toBe(false);
  });
});

describe('projectWithDescendants', () => {
  it('collects the whole subtree', () => {
    const a = proj('a');
    const b = proj('b', a.id);
    const c = proj('c', b.id);
    const d = proj('d');
    const ids = projectWithDescendants([a, b, c, d], a.id);
    expect([...ids].sort()).toEqual([a.id, b.id, c.id].sort());
  });
});
