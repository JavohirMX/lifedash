import './workflow.css';
import { requestComplete } from '../completionPrompt';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ListPlus, Pin, PinOff, Plus, Search, StickyNote, Trash2 } from 'lucide-react';

import { addNote, updateNote, deleteNote, addTask } from '../repo';
import { extractChecklistItems, filterNewChecklistItems, searchNotes } from '../logic';
import { db, INBOX_ID } from '../db';
import NoteEditor from '../components/NoteEditor';

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
  const [extracted, setExtracted] = useState<number | null>(null);
  const [q, setQ] = useState('');
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
          onClick={() => void addNote().then((n) => setOpenId(n.id))}
        >
          <Plus size={14} strokeWidth={2} aria-hidden="true" /> Note
        </button>
      </h1>
      <p className="workflow-hint">Notes save as you type. Choose a note to edit; pin it to keep it at the top.</p>
      {sorted.length > 4 && (
        <div className="search-wrap notes-filter">
          <Search size={14} strokeWidth={1.75} aria-hidden="true" className="search-icon" />
          <input
            className="search-box"
            placeholder="Filter notes"
            aria-label="Filter notes"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }}
          />
        </div>
      )}
      {filtering && shown.length === 0 ? (
        <p className="empty">No notes match "{q.trim()}".</p>
      ) : sorted.length === 0 ? (
        <div className="empty goals-empty">
          <StickyNote size={28} strokeWidth={1.5} aria-hidden="true" />
          <p>Free-form notes with rich text - checklists, links, headings. Pin the ones you come back to.</p>
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
                <input
                  className="note-title-input"
                  value={open.title}
                  placeholder="Note title"
                  aria-label="Note title"
                  onChange={(e) => void updateNote(open.id, { title: e.target.value })}
                />
                {extractChecklistItems(open.noteDoc).length > 0 && (
                  <button
                    className="icon-btn"
                    aria-label="Turn checklist into tasks"
                    title="Turn checklist into tasks"
                    onClick={() => void (async () => {
                      const existing = (await db.tasks.where('noteId').equals(open.id).toArray()).map((t) => t.title);
                      const items = filterNewChecklistItems(extractChecklistItems(open.noteDoc), existing);
                      if (items.length === 0) {
                        setExtracted(0);
                        setTimeout(() => setExtracted(null), 3000);
                        return;
                      }
                      await items.reduce(
                        (chain, title) => chain.then(() => addTask({ title, projectId: INBOX_ID, noteId: open.id })),
                        Promise.resolve<unknown>(null),
                      );
                      setExtracted(items.length);
                      setTimeout(() => setExtracted(null), 3000);
                    })()}
                  >
                    <ListPlus size={15} strokeWidth={2} />
                  </button>
                )}
                {extracted !== null && <span className="extracted-note num">{extracted === 0 ? 'Already added' : `${extracted} task${extracted === 1 ? '' : 's'} added`}</span>}
                <button
                  className="icon-btn"
                  aria-label={open.pinned ? 'Unpin note' : 'Pin note'}
                  title={open.pinned ? 'Unpin' : 'Pin'}
                  onClick={() => void updateNote(open.id, { pinned: !open.pinned })}
                >
                  {open.pinned ? <PinOff size={15} strokeWidth={2} /> : <Pin size={15} strokeWidth={2} />}
                </button>
                <button
                  className="icon-btn"
                  aria-label="Delete note"
                  title="Delete"
                  onClick={() => {
                    if (!window.confirm(`Delete note ${open.title || 'Untitled'}? This cannot be undone.`)) return;
                    void deleteNote(open.id);
                    setOpenId(null);
                  }}
                >
                  <Trash2 size={15} strokeWidth={2} />
                </button>
              </div>
              <NoteEditor
                key={open.id}
                docKey={open.id}
                note={open.note}
                noteDoc={open.noteDoc}
                onSave={(doc, text) => void updateNote(open.id, { noteDoc: doc, note: text })}
              />
              {linkedActive.length > 0 && (
                <div className="note-linked">
                  <p className="widget-meta num">{linkedActive.length} linked task{linkedActive.length === 1 ? '' : 's'}</p>
                  <ul className="widget-list">
                    {linkedActive.map((t) => (
                      <li key={t.id}>
                        <button
                          className={`checkbox ${t.status === 'done' ? 'checked' : ''}`}
                          aria-label={t.status === 'done' ? 'Mark not done' : 'Mark done'}
                          onClick={() => void requestComplete(t)}
                        >
                          {t.status === 'done' ? <Check size={13} strokeWidth={2.5} aria-hidden="true" /> : null}
                        </button>
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
