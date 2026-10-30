import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { updateTask } from '../repo';

export default function BacklogSchedule(props: { id: string; title: string; today: string }) {
  return <Schedule key={props.id} {...props} />;
}
function Schedule({ id, title, today }: { id: string; title: string; today: string }) {
  const [date, setDate] = useState(''), [busy, setBusy] = useState(false), [failed, setFailed] = useState('');
  const writing = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function save(next: string) {
    if (!next || writing.current) return;
    writing.current = true; setBusy(true); setFailed('');
    try { await updateTask(id, { dueDate: next }); }
    catch { if (mounted.current) setFailed(next); }
    finally { writing.current = false; if (mounted.current) setBusy(false); }
  }
  return <>
    <button className="mini" disabled={busy} onClick={() => void save(today)}>
      <ArrowRight size={12} strokeWidth={1.75} aria-hidden="true" /> Today
    </button>
    <input type="date" className="mini backlog-date" aria-label={`Schedule ${title} to a date`} value={date} readOnly={busy} aria-disabled={busy}
      onChange={e => { setDate(e.target.value); void save(e.target.value); }} />
    {busy && <p className="sub-add-feedback backlog-schedule-feedback" role="status">Scheduling…</p>}
    {failed && <div className="sub-add-feedback backlog-schedule-feedback"><p role="alert">Date wasn't saved. Retry to schedule this task for {failed}.</p><button className="btn-secondary" onClick={() => void save(failed)}>Retry schedule</button></div>}
  </>;
}
