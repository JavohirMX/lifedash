import { describe, expect, it } from 'vitest';
import { completionGate } from './completionGate';
import type { Task } from './types';
const t = (id: string, patch: Partial<Task> = {}) => ({ id, status: 'active', blockedBy: [], parentId: null, ...patch }) as Task;
describe('completionGate', () => {
  it('allows undo without any prompt', () => {
    const parent = t('a', {status:'done',blockedBy:['b']});
    expect(completionGate(parent,[parent,t('b'),t('c',{parentId:'a'})])).toEqual({blockers:[],openSubtasks:[]});
  });
  it('finds active blockers but ignores completed or missing blockers', () => {
    const a=t('a',{blockedBy:['b','c','missing']});
    expect(completionGate(a,[a,t('b'),t('c',{status:'done'})]).blockers.map(x=>x.id)).toEqual(['b']);
  });
  it('finds direct open children only', () => {
    const a=t('a');expect(completionGate(a,[a,t('b',{parentId:'a'}),t('c',{parentId:'a',status:'done'}),t('d',{parentId:'b'})]).openSubtasks.map(x=>x.id)).toEqual(['b']);
  });
  it('returns both gates so blockers precede subtask choice', () => {
    const a=t('a',{blockedBy:['b']});const gate=completionGate(a,[a,t('b'),t('c',{parentId:'a'})]);expect(gate.blockers).toHaveLength(1);expect(gate.openSubtasks).toHaveLength(1);
  });
  it('tolerates legacy rows without blockedBy', () => {
    expect(completionGate({id:'a',status:'active'} as Task,[])).toEqual({blockers:[],openSubtasks:[]});
  });
});
