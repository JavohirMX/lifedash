import { useEffect, useRef, useState } from 'react';
import { X, ArrowLeft } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { loadSyncSettings } from '../sync';
import { todayStr, addDays, friendlyDate } from '../dates';
import { googleEventsForLocalDays, truncationNote, type DayItem } from '../googleCalendar';
import GoogleCalendarPanel from './GoogleCalendarPanel';

export default function GoogleCalendarDialog({onClose,onBack}:{onClose:()=>void;onBack:()=>void}) {
 const panel=useDialogFocus<HTMLDivElement>(onClose);
 const [settings]=useState(loadSyncSettings);
 const [connected,setConnected]=useState(false);
 const [events,setEvents]=useState<Map<string,DayItem[]>|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [note,setNote]=useState<string|null>(null);
 const [loadedAt,setLoadedAt]=useState('');
 const [days,setDays]=useState(7);
 const generation=useRef(0);
 useEffect(()=>()=>{generation.current++;},[]);
 const from=todayStr(),to=addDays(from,days-1);
 async function load(){if(!settings||busy)return;setBusy(true);setError('');const request=++generation.current;try{const r=await googleEventsForLocalDays(settings,from,to);if(request!==generation.current)return;setEvents(r.byDay);setNote(truncationNote(r));setLoadedAt(new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));}catch(e){if(request!==generation.current)return;setError(e instanceof Error?e.message:'Could not load events.');}finally{if(request===generation.current)setBusy(false)}}
 return <div className="palette-overlay" onClick={onClose}><div ref={panel} className="import-panel" role="dialog" aria-modal="true" aria-label="Google Calendar" onClick={e=>e.stopPropagation()}>
  <div className="import-head"><div style={{display:'flex',alignItems:'center',gap:8}}><button className="icon-btn" aria-label="Back to Settings" onClick={onBack}><ArrowLeft size={18}/></button><h2>Google Calendar</h2></div><button className="icon-btn" aria-label="Close Google Calendar" onClick={onClose}><X size={18}/></button></div>
  <GoogleCalendarPanel settings={settings} eventDisplay onConnectionChange={value=>{setConnected(value);if(!value){generation.current++;setEvents(null);setNote(null);setBusy(false);}}}/>
  {connected&&<section aria-label="Google events"><h3>Events</h3><label className="field"><span>Date range</span><select aria-label="Date range" value={days} onChange={e=>{generation.current++;setBusy(false);setDays(Number(e.target.value));setEvents(null);setNote(null);}}><option value={1}>Today</option><option value={3}>Next 3 days</option><option value={7}>Next 7 days</option></select></label><p className="rule-note">{days===1?'Today':`Today through ${friendlyDate(to,from)}`}, in this device's timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Titles and times only. This list never creates or completes Lifedash tasks.</p><button className="btn-primary" disabled={busy} onClick={()=>void load()}>{busy?'Loading events…':events?'Refresh events':'Load events'}</button>{loadedAt&&events&&<p className="rule-note">Last loaded {loadedAt}. This is a snapshot, not live sync.</p>}{error&&<p role="alert">{error}</p>}{note&&<p role="status">{note}</p>}{events&&events.size===0&&<p>No events found in this range.</p>}{events&&[...events.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([date,items])=><div className="day-group" key={date}><h3>{friendlyDate(date,from)}</h3><ul className="gcal-events">{items.map(item=><li key={item.id}><span className="num">{item.allDay?'All day':item.time??'Continues'}</span><span>{item.title}</span></li>)}</ul></div>)}</section>}
 </div></div>
}
