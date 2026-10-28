import { useEffect, useRef, useState } from 'react';
import { Check, Flame } from 'lucide-react';
import { toggleHabitForDate } from '../repo';
export default function HomeHabitCheck({ id, name, date, done, streak }: { id: string; name: string; date: string; done: boolean; streak: number }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const writing = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function toggle() {
    if (writing.current) return;
    writing.current = true; setBusy(true); setError('');
    try { await toggleHabitForDate(id, date); }
    catch { if (mounted.current) setError("Couldn't save this check-in. Try the checkbox again."); }
    finally { writing.current = false; if (mounted.current) setBusy(false); }
  }
  return <li className="home-habit-row" aria-busy={busy}>
    <button className={`checkbox home-check ${done ? 'checked' : ''}`} aria-label={`${done ? 'Uncheck' : 'Check'} ${name} for today`} disabled={busy} onClick={() => void toggle()}>
      {done && <Check size={12} strokeWidth={2.5} aria-hidden="true" />}
    </button>
    <span className={`widget-task ${done ? 'done' : ''}`}>{name}</span>
    {streak >= 2 && <span className="widget-streak num"><Flame size={12} strokeWidth={2} aria-hidden="true" /> {streak}</span>}
    {busy && <p className="sub-add-feedback home-habit-feedback" role="status">Saving check-in…</p>}
    {error && <p className="sub-add-feedback home-habit-feedback" role="alert">{error}</p>}
  </li>;
}
