import { useEffect, useRef, useState } from 'react';
import { updateTask } from '../repo';
import { db } from '../db';
import { liveQuery } from 'dexie';

type Draft = { title: string; state: 'saving' | 'error' };
// Keep unsaved titles and serialize writes across internal navigation, per database/task.
const drafts = new Map<string, Draft>();
const queues = new Map<string, Promise<void>>();
const changed = 'lifedash-task-title-save';
// Drafts outlive the mounted input, so browser-leave protection must too.
window.addEventListener('beforeunload', (event) => {
  if (drafts.size > 0) { event.preventDefault(); event.returnValue = ''; }
});
// Deleted tasks have no destination for recovery. Observe confirmed database
// absence, including project deletion and deletes from other page connections.
const missingTasks = liveQuery(() => db.tasks.toCollection().primaryKeys()).subscribe({
  next(ids) {
    const existing = new Set(ids);
    for (const key of drafts.keys()) {
      const [database, id] = JSON.parse(key) as [string, string];
      if (database === db.name && !existing.has(id)) drafts.delete(key);
    }
  },
  // A read failure is not proof of deletion. Keep drafts and their warning.
  error() {},
});
void missingTasks;
export default function TaskTitle(props: { id: string; title: string }) {
  return <TitleInput key={JSON.stringify([db.name, props.id])} {...props} />;
}
function TitleInput(props: { id: string; title: string }) {
  const key = JSON.stringify([db.name, props.id]);
  const [draft, setDraft] = useState(drafts.get(key)?.title ?? props.title);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>(drafts.get(key)?.state ?? 'idle');
  const latest = useRef(draft);
  useEffect(() => {
    if (!drafts.has(key)) { setDraft(props.title); latest.current = props.title; }
  }, [key, props.title]);
  useEffect(() => {
    const reconcile = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== key) return;
      setState(drafts.get(key)?.state ?? 'saved');
    };
    window.addEventListener(changed, reconcile);
    return () => { window.removeEventListener(changed, reconcile); };
  }, [key]);
  function save(title: string) {
    const snapshot: Draft = { title, state: 'saving' };
    drafts.set(key, snapshot);
    setState('saving');
    const write = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      try {
        await updateTask(props.id, { title });
        if (drafts.get(key) === snapshot) drafts.delete(key);
      } catch { snapshot.state = 'error'; }
      window.dispatchEvent(new CustomEvent(changed, { detail: key }));
    });
    queues.set(key, write);
    void write.finally(() => { if (queues.get(key) === write) queues.delete(key); });
  }
  return <div className="task-title-field">
    <input className="detail-title" value={draft} placeholder="Task title" aria-label="Task title"
      onChange={(event) => { setDraft(event.target.value); latest.current = event.target.value; save(event.target.value); }} />
    <span className="task-title-status" role="status">{state === 'saving' ? 'Saving title…' : state === 'saved' ? 'Title saved on this device' : ''}</span>
    {state === 'error' && <div className="task-title-error">
      <p role="alert">Title not saved. Your text is kept here.</p>
      <button className="mini" onClick={() => save(latest.current)}>Retry title</button>
    </div>}
  </div>;
}
