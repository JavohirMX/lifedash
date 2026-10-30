import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { addTag, removeTag } from '../repo';
export default function TaskTags(props: { taskId: string; tags: string[] }) {
  return <TagsInput key={props.taskId} {...props} />;
}
function TagsInput({ taskId, tags }: { taskId: string; tags: string[] }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [error, setError] = useState('');
  async function change(action: 'add' | 'remove', tag = draft) {
    if (writing.current || !tag.trim()) return;
    writing.current = true; setBusy(true); setError('');
    try {
      if (action === 'add') { await addTag(taskId, tag); setDraft(''); }
      else await removeTag(taskId, tag);
    } catch { setError(action === 'add' ? "Couldn't add this tag. Your text is still here. Try Add tag again." : "Couldn't remove this tag. It is still saved. Try its Remove tag button again."); }
    finally { writing.current = false; setBusy(false); }
  }
  return <div aria-busy={busy}>
    <div className="chips">
      {tags.map(tag => <span key={tag} className="chip">#{tag}<button disabled={busy} aria-label={`Remove tag ${tag}`} onClick={() => void change('remove', tag)}><X size={12} strokeWidth={2} /></button></span>)}
    </div>
    <form className="task-tag-add" onSubmit={event => { event.preventDefault(); void change('add'); }}>
      <input className="chip-input" aria-label="New tag" value={draft} disabled={busy} placeholder="Add tag"
        onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} />
      <button className="mini" disabled={busy || !draft.trim()}>Add tag</button>
    </form>
    {busy && <p className="sub-add-feedback" role="status">Saving tags…</p>}
    {error && <p className="sub-add-feedback" role="alert">{error}</p>}
  </div>;
}
