import { describe, expect, it } from 'vitest';
import { projectTree, projectWithDescendants, wouldCycle } from './projects';
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
