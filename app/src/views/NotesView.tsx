import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ListPlus, Pin, PinOff, Plus, StickyNote, Trash2 } from 'lucide-react';

import { addNote, updateNote, deleteNote, addTask } from '../repo';
import { extractChecklistItems } from '../logic';
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

  const sorted = useMemo(
    () => (notes ?? []).slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt),
    [notes],
  );
  const open = sorted.find((n) => n.id === openId) ?? null;

  return (
    <section>
      <h1>
        Notes <span className="date-sub">{sorted.length} total</span>
        <button
          className="mini"
          style={{ marginLeft: 'auto' }}
          aria-label="New note"
          onClick={() => void addNote().then((n) => setOpenId(n.id))}
        >
          <Plus size={14} strokeWidth={2} aria-hidden="true" /> Note
        </button>
      </h1>
      {sorted.length === 0 ? (
        <div className="empty goals-empty">
          <StickyNote size={28} strokeWidth={1.5} aria-hidden="true" />
          <p>Free-form notes with rich text - checklists, links, headings. Pin the ones you come back to.</p>
        </div>
      ) : (
        <div className="notes-layout">
          <div className="notes-list" role="list">
            {sorted.map((n) => (
              <button
                key={n.id}
                role="listitem"
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
            <div className="note-editor-pane">
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
                    onClick={() => {
                      const items = extractChecklistItems(open.noteDoc);
                      void items.reduce(
                        (chain, title) => chain.then(() => addTask({ title, projectId: INBOX_ID })),
                        Promise.resolve<unknown>(null),
                      ).then(() => {
                        setExtracted(items.length);
                        setTimeout(() => setExtracted(null), 3000);
                      });
                    }}
                  >
                    <ListPlus size={15} strokeWidth={2} />
                  </button>
                )}
                {extracted !== null && <span className="extracted-note num">{extracted} task{extracted === 1 ? '' : 's'} added</span>}
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
            </div>
          )}
        </div>
      )}
    </section>
  );
}
