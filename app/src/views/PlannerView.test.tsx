import { describe,it,expect,vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../repo',()=>({updateTask:vi.fn()}));
import PlannerView from './PlannerView';
import type {Task} from '../types';
describe('Planner safety presentation',()=>{
 it('renders useful empty state and no automatic calendar request',()=>{const h=renderToStaticMarkup(<PlannerView tasks={[]} onOpen={()=>{}}/>);expect(h).toContain('Nothing moves until you save a plan');expect(h).toContain('No calendar snapshot loaded');expect(h).toContain('Agenda');expect(h).toContain('9h window');expect(h).not.toContain('Loading…')});
 it('does not present deadlines as work starts or inject a task title',()=>{const d=new Date();const day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;const t={id:'x',title:'<script>bad</script>',status:'active',parentId:null,dueDate:day,dueTime:'10:00',blockedBy:[],tags:[]} as unknown as Task;const h=renderToStaticMarkup(<PlannerView tasks={[t]} onOpen={()=>{}}/>);expect(h).toContain('Not planned');expect(h).toContain('estimate not set');expect(h).not.toContain('<script>bad</script>');expect(h).toContain('Deadline')});
});
