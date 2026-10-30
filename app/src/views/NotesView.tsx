import './workflow.css';
import CompletionButton from '../components/CompletionButton';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ListPlus, Pin, PinOff, Plus, Search, StickyNote, Trash2 } from 'lucide-react';

import { addNote, updateNote, deleteNote, addTasksFromNoteChecklist } from '../repo';
import { extractChecklistItems, searchNotes } from '../logic';
import { db } from '../db';
import NoteEditor from '../components/NoteEditor';
import NoteTitle, { discardDeletedNoteTitle } from '../components/NoteTitle';

function excerpt(text: string, n = 90): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function NotesView(props: { initialOpenId?: string }) {
  const notes = useLiveQuery(() => db.notes.toArray(), []);
  const [openId, setOpenId] = useState<string | null>(props.initialOpenId ?? null);
  const selectedNote = useRef(openId);
  selectedNote.current = openId;
  const deleting = useRef(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; text: string } | null>(null);
  async function removeNote(note: { id: string; title: string }) {
    if (deleting.current) return;
    if (!window.confirm(`Delete note ${note.title || 'Untitled'}? This cannot be undone.`)) return;
    deleting.current = true; setDeletingId(note.id); setDeleteError(null);
    try {
      await deleteNote(note.id);
      discardDeletedNoteTitle(note.id);
      if (selectedNote.current === note.id) setOpenId(null);
    } catch { setDeleteError({ id: note.id, text: "Couldn't delete this note. Nothing was deleted. Try Delete note again." }); }
    finally { deleting.current = false; setDeletingId(null); }
  }
  const pinning = useRef(false);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [pinError, setPinError] = useState<{ id: string; text: string } | null>(null);
  async function togglePin(note: { id: string; pinned: boolean }) {
    if (pinning.current) return;
    pinning.current = true; setPinningId(note.id); setPinError(null);
    try { await updateNote(note.id, { pinned: !note.pinned }); }
    catch { setPinError({ id: note.id, text: "Couldn't change this note's pin. Try the pin button again." }); }
    finally { pinning.current = false; setPinningId(null); }
  }
  const converting = useRef(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [convertError, setConvertError] = useState<{ id: string; text: string } | null>(null);
  const [extracted, setExtracted] = useState<{ id: string; count: number } | null>(null);
  const [q, setQ] = useState('');
  const creating = useRef(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  async function createNote() {
    if (creating.current) return;
    creating.current = true; setIsCreating(true); setCreateError('');
    try { const note = await addNote(); setOpenId(note.id); }
    catch { setCreateError("Couldn't create a note. No note was added. Try New note again."); }
    finally { creating.current = false; setIsCreating(false); }
  }
  const editorPane = useRef<HTMLDivElement>(null);
  const noteList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (openId && window.matchMedia('(max-width: 700px)').matches) {
      requestAnimationFrame(() => editorPane.current?.scrollIntoView({ block: 'start' }));
    }
  }, [openId, notes?.some(n => n.id === openId)]);

  const sorted = useMemo(
    () => (notes ?? []).slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt),
    [notes],
  );
  const filtering = q.trim().length > 0;
  // Filter by title + body, keeping the pinned-first order of the full list.
  const shown = useMemo(
    () => (filtering ? searchNotes(sorted, q).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt) : sorted),
    [sorted, q, filtering],
  );
  const open = sorted.find((n) => n.id === openId) ?? null;
  const linked = useLiveQuery(
    () => (openId ? db.tasks.where('noteId').equals(openId).toArray() : []),
    [openId],
  );
  const linkedActive = (linked ?? []).filter((t) => t.status !== 'archived');

  return (
    <section>
      <h1>
        Notes <span className="date-sub">{filtering ? `${shown.length} of ${sorted.length}` : `${sorted.length} total`}</span>
        <button
          className="mini"
          style={{ marginLeft: 'auto' }}
          aria-label="New note"
          disabled={isCreating}
          onClick={() => void createNote()}
        >
          <Plus size={14} strokeWidth={2} aria-hidden="true" /> Note
        </button>
      </h1>
      {isCreating && <p className="workflow-hint" role="status">Creating note…</p>}
      {createError && <p className="workflow-hint" role="alert">{createError}</p>}
      {sorted.length > 4 && (
        <div className="search-wrap notes-filter">
          <Search size={14} strokeWidth={1.75} aria-hidden="true" className="search-icon" />
          <input
            className="search-box"
            placeholder="Filter notes"
            aria-label="Filter notes"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && !e.nativeEvent.isComposing) setQ(''); }}
          />
        </div>
      )}
      {filtering && shown.length === 0 ? (
        <p className="empty">No notes match "{q.trim()}".</p>
      ) : sorted.length === 0 ? (
        <div className="empty goals-empty">
          <StickyNote size={28} strokeWidth={1.5} aria-hidden="true" />
          <p>No notes yet.</p>
        </div>
      ) : (
        <div className={`notes-layout${open ? ' note-is-open' : ''}`}>
          <div ref={noteList} className="notes-list" role="group" aria-label="Notes">
            {shown.map((n) => (
              <button
                key={n.id}
                aria-current={n.id === openId ? 'true' : undefined}
                className={`note-item ${n.id === openId ? 'active' : ''}`}
                onClick={() => setOpenId(n.id)}
              >
                <span className="note-item-title">
                  {n.pinned && <Pin size={12} strokeWidth={2} aria-label="Pinned" />}
                  {n.title.trim() || excerpt(n.note, 40) || 'Untitled'}
                </span>
                <span className="note-item-sub">
                  <span className="note-item-excerpt">{excerpt(n.note, 60) || 'Empty note'}</span>
                  <span className="note-item-when">{relTime(n.updatedAt)}</span>
                </span>
              </button>
            ))}
          </div>
          {open && (
            <div ref={editorPane} className="note-editor-pane">
              <button className="mini note-back-list" onClick={() => { setOpenId(null); requestAnimationFrame(() => noteList.current?.scrollIntoView({ block: 'start' })); }}>Back to notes</button>
              <div className="note-editor-head">
                <NoteTitle id={open.id} title={open.title} />
                {extractChecklistItems(open.noteDoc).length > 0 && (
                  <button
                    className="icon-btn"
                    aria-label="Turn checklist into tasks"
                    title="Turn checklist into tasks"
                    disabled={convertingId !== null}
                    onClick={() => void (async () => {
                      if (converting.current) return;
                      converting.current = true; setConvertingId(open.id); setConvertError(null); setExtracted(null);
                      try {
                        const count = await addTasksFromNoteChecklist(open.id);
                        setExtracted({ id: open.id, count });
                        setTimeout(() => setExtracted(null), 3000);
                      } catch {
                        setConvertError({ id: open.id, text: "Couldn't create tasks. No new tasks were added. Try Turn checklist into tasks again." });
                      } finally { converting.current = false; setConvertingId(null); }
                    })()}
                  >
                    <ListPlus size={15} strokeWidth={2} />
                  </button>
                )}
                {extracted?.id === open.id && <span className="extracted-note num" role="status">{extracted.count === 0 ? 'Already added' : `${extracted.count} task${extracted.count === 1 ? '' : 's'} added`}</span>}
                <button
                  className="icon-btn"
                  aria-label={open.pinned ? 'Unpin note' : 'Pin note'}
                  title={open.pinned ? 'Unpin' : 'Pin'}
                  disabled={pinningId !== null}
                  onClick={() => void togglePin(open)}
                >
                  {open.pinned ? <PinOff size={15} strokeWidth={2} /> : <Pin size={15} strokeWidth={2} />}
                </button>
                <button
                  className="icon-btn"
                  aria-label="Delete note"
                  title="Delete"
                  disabled={deletingId !== null}
                  onClick={() => void removeNote(open)}
                >
                  <Trash2 size={15} strokeWidth={2} />
                </button>
              </div>
              {pinningId === open.id && <p className="workflow-hint" role="status">Saving note pin…</p>}
              {pinError?.id === open.id && <p className="workflow-hint" role="alert">{pinError.text}</p>}
              {deletingId === open.id && <p className="workflow-hint" role="status">Deleting note…</p>}
              {deleteError?.id === open.id && <p className="workflow-hint" role="alert">{deleteError.text}</p>}
              {convertingId === open.id && <p className="workflow-hint" role="status">Creating checklist tasks…</p>}
              {convertError?.id === open.id && <p className="workflow-hint" role="alert">{convertError.text}</p>}
              <NoteEditor collection="notes"
                key={open.id}
                docKey={open.id}
                note={open.note}
                noteDoc={open.noteDoc}
                onSave={(doc, text) => updateNote(open.id, { noteDoc: doc, note: text })}
              />
              {linkedActive.length > 0 && (
                <div className="note-linked">
                  <p className="widget-meta num">{linkedActive.length} linked task{linkedActive.length === 1 ? '' : 's'}</p>
                  <ul className="widget-list">
                    {linkedActive.map((t) => (
                      <li key={t.id}>
                        <CompletionButton task={t}
                          className={`checkbox ${t.status === 'done' ? 'checked' : ''}`}
                          label={t.status === 'done' ? 'Mark not done' : 'Mark done'}>
                          {t.status === 'done' ? <Check size={13} strokeWidth={2.5} aria-hidden="true" /> : null}
                        </CompletionButton>
                        <span className={`widget-task ${t.status === 'done' ? 'done' : ''}`}>{t.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
