import { describe, expect, it } from 'vitest';
import { reviewTasks, goalsWithoutNextAction, reviewHabit } from './review';
import type { Task, Goal, Habit } from './types';
const t = (patch: Partial<Task>): Task => ({ id:'t',status:'active',projectId:'inbox',dueDate:null,updatedAt:new Date('2026-10-20T12:00:00').getTime(),...patch } as Task);
const g = (patch: Partial<Goal>): Goal => ({ id:'g',status:'active',...patch } as Goal);
describe('optional weekly review', () => {
 it('lists open inbox/overdue and explicitly older unchanged tasks without mutating', () => {
  const rows=[t({id:'old',updatedAt:new Date('2026-10-01T12:00:00').getTime(),dueDate:'2026-10-27'}),t({id:'done',status:'done'}),t({id:'today',dueDate:'2026-10-28'})];
  const before=JSON.stringify(rows);const r=reviewTasks(rows,'2026-10-28');
  expect(r.inbox.map(t=>t.id)).toEqual(['old','today']);expect(r.overdue.map(t=>t.id)).toEqual(['old']);expect(r.unchanged.map(t=>t.id)).toEqual(['old']);expect(JSON.stringify(rows)).toBe(before);
 });
 it('only an active task supplies a goal next action, independent of completion totals',()=>{
  expect(goalsWithoutNextAction([g({}),g({id:'done',status:'done'})],[t({goalId:'g',status:'done'})]).map(g=>g.id)).toEqual(['g']);
  expect(goalsWithoutNextAction([g({})],[t({goalId:'g'})])).toEqual([]);
 });
 it('habit review counts scheduled days only and deduplicates logs',()=>{
  const habit={id:'h',weekdays:[1,3,5]} as Habit;
  expect(reviewHabit(habit,[{habitId:'h',date:'2026-10-26'},{habitId:'h',date:'2026-10-26'},{habitId:'h',date:'2026-10-27'}] as never,'2026-10-28')).toEqual({scheduled:3,done:1});
 });
});
