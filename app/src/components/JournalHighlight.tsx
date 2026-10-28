import { useEffect, useState } from 'react';
import { db } from '../db';
import { getOrCreateJournalEntry, updateJournalEntry } from '../repo';
type Draft = { value: string; state: 'editing' | 'saving' | 'error' };
const drafts = new Map<string, Draft>();
const queues = new Map<string, Promise<void>>();
const changed = 'lifedash-highlight-save';
window.addEventListener('beforeunload', event => {
  if (drafts.size) { event.preventDefault(); event.returnValue = ''; }
});
export default function JournalHighlight(props: { date: string; value: string }) {
  return <HighlightInput key={JSON.stringify([db.name, props.date])} {...props} />;
}
function HighlightInput(props: { date: string; value: string }) {
  const key = JSON.stringify([db.name, props.date]);
  const [value, setValue] = useState(drafts.get(key)?.value ?? props.value);
  const [state, setState] = useState<'idle' | 'editing' | 'saving' | 'saved' | 'error'>(drafts.get(key)?.state ?? 'idle');
  useEffect(() => {
    if (!drafts.has(key)) { setValue(props.value); }
  }, [key, props.value]);
  useEffect(() => {
    const reconcile = (event: Event) => {
      if ((event as CustomEvent<string>).detail === key) setState(drafts.get(key)?.state ?? 'saved');
    };
    window.addEventListener(changed, reconcile);
    return () => window.removeEventListener(changed, reconcile);
  }, [key]);
  function save() {
    const snapshot = drafts.get(key);
    if (!snapshot || snapshot.state === 'saving') return;
    snapshot.state = 'saving'; setState('saving');
    const write = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      try {
        const entry = await getOrCreateJournalEntry(props.date);
        await updateJournalEntry(entry.id, { highlight: snapshot.value.trim() || null });
        if (drafts.get(key) === snapshot) drafts.delete(key);
      } catch { snapshot.state = 'error'; }
      window.dispatchEvent(new CustomEvent(changed, { detail: key }));
    });
    queues.set(key, write);
    void write.finally(() => { if (queues.get(key) === write) queues.delete(key); });
  }
  return <div className="highlight-save-field">
    <label className="highlight-field">
      <span className="highlight-label">Today's highlight (optional one-liner, shows on the TV)</span>
      <input type="text" value={value} placeholder="One line about today"
        onChange={event => { const next = event.target.value; setValue(next); drafts.set(key, { value: next, state: 'editing' }); setState('editing'); }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) save(); }}
        onBlur={() => { if (drafts.get(key)?.state === 'editing') save(); }} />
    </label>
    <p className="workflow-hint" role="status">{state === 'editing' ? 'Unsaved highlight' : state === 'saving' ? 'Saving highlight…' : state === 'saved' ? 'Highlight saved' : ''}</p>
    {state === 'error' && <div className="highlight-save-error">
      <p className="workflow-hint" role="alert">Highlight not saved. Your text is kept here.</p>
      <button className="mini" onClick={() => save()}>Retry highlight</button>
    </div>}
  </div>;
}
