import { useEffect, useRef, useState } from 'react';
import { updateNote } from '../repo';
import { db } from '../db';
import { liveQuery } from 'dexie';

type Draft = { title: string; state: 'saving' | 'error' };
// Keep unsaved titles and serialize writes across internal navigation, per database/note.
const drafts = new Map<string, Draft>();
const queues = new Map<string, Promise<void>>();
const changed = 'lifedash-note-title-save';
// Drafts outlive the mounted input, so browser-leave protection must too.
window.addEventListener('beforeunload', (event) => {
  if (drafts.size > 0) { event.preventDefault(); event.returnValue = ''; }
});
// Only confirmed absence clears a draft; a read failure keeps leave protection.
const missingNotes = liveQuery(() => db.notes.toCollection().primaryKeys()).subscribe({
  next(ids) {
    const existing = new Set(ids);
    for (const key of drafts.keys()) {
      const [database, id] = JSON.parse(key) as [string, string];
      if (database === db.name && !existing.has(id)) drafts.delete(key);
    }
  },
  error() {},
});
void missingNotes;
export function discardDeletedNoteTitle(id: string) {
  drafts.delete(JSON.stringify([db.name, id]));
}
export default function NoteTitle(props: { id: string; title: string }) {
  return <TitleInput key={JSON.stringify([db.name, props.id])} {...props} />;
}
function TitleInput(props: { id: string; title: string }) {
  const key = JSON.stringify([db.name, props.id]);
  const [draft, setDraft] = useState(drafts.get(key)?.title ?? props.title);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>(drafts.get(key)?.state ?? 'idle');
  const latest = useRef(draft);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!drafts.has(key)) { setDraft(props.title); latest.current = props.title; }
  }, [key, props.title]);
  useEffect(() => {
    const reconcile = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== key) return;
      setState(drafts.get(key)?.state ?? 'saved');
    };
    window.addEventListener(changed, reconcile);
    return () => {
      window.removeEventListener(changed, reconcile);
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        flush(latest.current);
      }
    };
  }, [key]);
  function flush(title: string) {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    const snapshot: Draft = { title, state: 'saving' };
    drafts.set(key, snapshot);
    setState('saving');
    const write = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      try {
        await updateNote(props.id, { title });
        if (drafts.get(key) === snapshot) drafts.delete(key);
      } catch { snapshot.state = 'error'; }
      window.dispatchEvent(new CustomEvent(changed, { detail: key }));
    });
    queues.set(key, write);
    void write.finally(() => { if (queues.get(key) === write) queues.delete(key); });
  }
  function save(title: string) {
    const snapshot: Draft = { title, state: 'saving' };
    drafts.set(key, snapshot);
    setState('saving');
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      flush(title);
    }, 250);
  }
  return <div className="note-title-field">
    <input className="note-title-input" value={draft} placeholder="Note title" aria-label="Note title"
      onChange={(event) => { setDraft(event.target.value); latest.current = event.target.value; save(event.target.value); }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          if (debounceTimer.current) flush(latest.current);
          (event.target as HTMLInputElement).blur();
        }
      }}
      onBlur={() => { if (debounceTimer.current) flush(latest.current); }} />
    <span className="note-title-status" role="status">{state === 'saving' ? 'Saving title…' : state === 'saved' ? 'Title saved on this device' : ''}</span>
    {state === 'error' && <div className="note-title-error">
      <p role="alert">Title not saved. Your text is kept here.</p>
      <button className="mini" onClick={() => flush(latest.current)}>Retry title</button>
    </div>}
  </div>;
}
