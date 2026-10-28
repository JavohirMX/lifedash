import type { Task } from './types';
import type { GoogleEvent } from './googleCalendar';
import { addDays, parseLocalDate, toLocalDateStr } from './dates';
export type PlanPatch = Pick<Task, 'plannedDate' | 'plannedTime' | 'durationMinutes'>;
export function validDate(v: unknown): v is string {
 return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && toLocalDateStr(parseLocalDate(v)) === v;
}
export function minutes(v: unknown): number | null {
 if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return null;
 return Number(v.slice(0,2))*60+Number(v.slice(3));
}
export const validDuration = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 1440;
export function normalizePlan(t: PlanPatch): PlanPatch {
 const date = validDate(t.plannedDate) ? t.plannedDate : null;
 return {plannedDate: date, plannedTime: date && minutes(t.plannedTime)!==null ? t.plannedTime : null, durationMinutes: validDuration(t.durationMinutes) ? t.durationMinutes : null};
}
export function planError(date: string, time: string, duration: string): string | null {
 if (date && !validDate(date)) return 'Choose a real work date.';
 if (time && !date) return 'Choose a work date before a start time.';
 if (time && minutes(time)===null) return 'Choose a valid start time.';
 if (duration && !validDuration(Number(duration))) return 'Estimate must be a whole number from 1 to 1440 minutes.';
 return null;
}
export interface Block {id:string; title:string; start:number; end:number; kind:'task'|'calendar'}
export function taskBlocks(tasks: Task[], date: string): Block[] {
 const startDay=parseLocalDate(date).getTime(),endDay=parseLocalDate(addDays(date,1)).getTime();
 return tasks.filter(t=>t.status==='active' && validDate(t.plannedDate) && minutes(t.plannedTime)!==null && validDuration(t.durationMinutes)).flatMap(t=>{
 const [h,m]=t.plannedTime!.split(':').map(Number);const start=parseLocalDate(t.plannedDate!);start.setHours(h,m,0,0);
 // Wall-clock duration, allowing DST crossings. Task remains on its chosen local date.
 const end=new Date(start);end.setMinutes(end.getMinutes()+t.durationMinutes!);
 return start.getTime()<endDay&&end.getTime()>startDay ? [{id:t.id,title:t.title,start:Math.max(startDay,start.getTime()),end:Math.min(endDay,end.getTime()),kind:'task' as const}] : [];
 });
}
export function calendarBlocks(events: GoogleEvent[], date:string): Block[] {
 const start=parseLocalDate(date).getTime(), end=parseLocalDate(addDays(date,1)).getTime();
 return events.filter(e=>!e.allDay).flatMap(e=>{
 const s=Date.parse(e.start),n=Date.parse(e.end);
 return Number.isFinite(s)&&Number.isFinite(n)&&n>s&&s<end&&n>start ? [{id:`calendar:${e.id}`,title:e.title,start:Math.max(s,start),end:Math.min(n,end),kind:'calendar' as const}] : [];
 });
}
export function unionMinutes(blocks: Block[], from:number,to:number):number {
 const ranges=blocks.map(b=>[Math.max(b.start,from),Math.min(b.end,to)]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
 let total=0,end=from;for(const [a,b] of ranges){total+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b)}return Math.round(total/60000);
}
export function overlapIds(blocks:Block[]):Set<string> {
 const ids=new Set<string>();for(let i=0;i<blocks.length;i++)for(let j=i+1;j<blocks.length;j++)if(blocks[i].start<blocks[j].end&&blocks[j].start<blocks[i].end){ids.add(blocks[i].id);ids.add(blocks[j].id)}return ids;
}
export function dayCapacity(tasks:Task[],events:GoogleEvent[],date:string,startHour:number,endHour:number){
 const from=parseLocalDate(date);from.setHours(startHour,0,0,0);const to=parseLocalDate(date);to.setHours(endHour,0,0,0);
 const task=taskBlocks(tasks,date),calendar=calendarBlocks(events,date);
 return {planned:Math.round(task.reduce((n,b)=>n+Math.max(0,Math.min(b.end,to.getTime())-Math.max(b.start,from.getTime())),0)/60000),available:Math.round((to.getTime()-from.getTime())/60000)-unionMinutes(calendar,from.getTime(),to.getTime()),overlaps:overlapIds([...task,...calendar]),unknown:tasks.filter(t=>t.status==='active'&&t.plannedDate===date&&(!validDuration(t.durationMinutes)||minutes(t.plannedTime)===null)).length};
}
export function plannerTasks(tasks:Task[],date:string):Task[]{return tasks.filter(t=>t.status==='active'&&t.parentId===null&&(t.plannedDate===date||t.dueDate===date));}
