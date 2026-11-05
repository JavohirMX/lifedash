import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { db } from '../db';
import { editorDrafts as sessionDrafts, type EditorDraft } from '../editorDrafts';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import { Bold, Italic, List, ListOrdered, ListChecks, Link as LinkIcon, FileText } from 'lucide-react';

// Session-only drafts survive internal navigation, without writing unconfirmed
// data to the saved record or carrying sample drafts into the user's database.
const sessionQueues = new Map<string, Promise<unknown>>();
// Drafts outlive the editor, so leave protection must outlive it too.
window.addEventListener('beforeunload', (event) => {
  if (sessionDrafts.size > 0) { event.preventDefault(); event.returnValue = ''; }
});

// Rich-text notes: ProseMirror JSON in noteDoc, plain-text mirror in note
// (search reads `note`). Debounced saves so typing isn't a write storm.
export default function NoteEditor(props: {
  docKey: string;
  collection: 'tasks' | 'notes' | 'journal';
  note: string;
  noteDoc: unknown | null;
  onSave: (doc: unknown, text: string) => void | Promise<void>;
}) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(props.onSave);
  saveRef.current = props.onSave;

  const draftKey = JSON.stringify([db.name, props.collection, props.docKey]);
  const initialDraft = useRef(sessionDrafts.get(draftKey));
  const [saveState, setSaveState] = useState<'idle' | 'waiting' | 'saving' | 'saved' | 'error'>(initialDraft.current ? (initialDraft.current.status === 'pending' ? 'saving' : 'error') : 'idle');
  const [recovered, setRecovered] = useState(Boolean(initialDraft.current));
  const revision = useRef(initialDraft.current?.revision ?? 0);
  const mounted = useRef(true);
  const latest = useRef<EditorDraft | null>(initialDraft.current ?? null);

  const [showNotePicker, setShowNotePicker] = useState(false);
  const [noteQuery, setNoteQuery] = useState('');
  const [availableNotes, setAvailableNotes] = useState<Array<{ id: string; title: string }>>([]);

  useEffect(() => {
    if (showNotePicker) {
      void db.notes.toArray().then((all) => {
        setAvailableNotes(
          all
            .filter((n) => n.id !== props.docKey)
            .map((n) => ({ id: n.id, title: n.title || 'Untitled' }))
        );
      });
    }
  }, [showNotePicker, props.docKey]);

  function insertNoteLink(targetNote: { id: string; title: string }) {
    if (!editor) return;
    const { from } = editor.state.selection;
    const textBefore = editor.state.doc.textBetween(Math.max(0, from - 2), from, '\n', '\0');
    let chain = editor.chain().focus();
    if (textBefore === '[[') {
      chain = chain.deleteRange({ from: from - 2, to: from });
    }
    chain
      .insertContent(`<a href="#note:${targetNote.id}">[[${targetNote.title}]]</a> `)
      .run();
    setShowNotePicker(false);
    setNoteQuery('');
  }

  const handleContentClick = (e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (href && (href.startsWith('#note:') || href.startsWith('#note/'))) {
      e.preventDefault();
      const noteId = href.replace(/^#note[:/]/, '');
      window.dispatchEvent(new CustomEvent('lifedash-navigate-note', { detail: { noteId } }));
    }
  };

  function persist(snapshot: NonNullable<typeof latest.current>) {
    snapshot.status = 'pending';
    window.dispatchEvent(new CustomEvent('lifedash-editor-save', { detail: { key: draftKey, snapshot, state: 'saving' } }));
    if (mounted.current) setSaveState('saving');
    const write = (sessionQueues.get(draftKey) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      try {
        await saveRef.current(snapshot.doc, snapshot.text);
        if (sessionDrafts.get(draftKey) === snapshot) sessionDrafts.delete(draftKey);
        if (mounted.current) setRecovered(false);
        window.dispatchEvent(new CustomEvent('lifedash-editor-save', { detail: { key: draftKey, snapshot, state: 'saved' } }));
        if (mounted.current && snapshot.revision === revision.current) setSaveState('saved');
      } catch {
        snapshot.status = 'error';
        window.dispatchEvent(new CustomEvent('lifedash-editor-save', { detail: { key: draftKey, snapshot, state: 'error' } }));
        if (mounted.current && snapshot.revision === revision.current) setSaveState('error');
      }
    });
    sessionQueues.set(draftKey, write);
    void write.finally(() => { if (sessionQueues.get(draftKey) === write) sessionQueues.delete(draftKey); });
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [3, 4] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false }),
    ],
    content: (initialDraft.current?.doc as object | undefined) ?? (props.noteDoc as object | null) ?? (props.note ? `<p>${escapeHtml(props.note).replace(/\n/g, '<br>')}</p>` : ''),
    onUpdate: ({ editor }) => {
      const text = editor.getText();
      if (text.endsWith('[[')) {
        setShowNotePicker(true);
        setNoteQuery('');
      }
      const snapshot = { doc: editor.getJSON(), text, revision: ++revision.current, status: 'pending' as const };
      latest.current = snapshot;
      sessionDrafts.set(draftKey, snapshot);
      setRecovered(false);
      setSaveState('waiting');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        persist(snapshot);
      }, 500);
    },
  });

  // Keep the last snapshot when the editor closes before the debounce fires.
  useEffect(() => {
    mounted.current = true;
    const reconcile = (event: Event) => {
      const { key, snapshot, state } = (event as CustomEvent<{ key: string; snapshot: EditorDraft; state: 'saving' | 'saved' | 'error' }>).detail;
      if (key !== draftKey || latest.current !== snapshot) return;
      setSaveState(state);
      if (state === 'saved') setRecovered(false);
    };
    window.addEventListener('lifedash-editor-save', reconcile);
    return () => {
      mounted.current = false;
      window.removeEventListener('lifedash-editor-save', reconcile);
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        if (latest.current) persist(latest.current);
      }
    };
  }, [editor]);

  if (!editor) return null;

  const btn = (icon: ReactNode, active: boolean, onClick: () => void, title: string) => (
    <button
      type="button"
      className={`ed-btn ${active ? 'active' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  );

  return (
    <div className="note-editor">
      {recovered && <p className="ed-save-error" role="status">{saveState === 'saving' ? 'Your latest text is restored. A save is still in progress.' : 'Unsaved draft recovered from this session. Review it, then retry save. The saved record has not been replaced.'}</p>}
      <div className="ed-toolbar">
        {btn(<Bold size={15} strokeWidth={2} aria-hidden="true" />, editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), 'Bold')}
        {btn(<Italic size={15} strokeWidth={2} aria-hidden="true" />, editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), 'Italic')}
        {btn(<List size={15} strokeWidth={2} aria-hidden="true" />, editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), 'Bullet list')}
        {btn(<ListOrdered size={15} strokeWidth={2} aria-hidden="true" />, editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), 'Numbered list')}
        {btn(<ListChecks size={15} strokeWidth={2} aria-hidden="true" />, editor.isActive('taskList'), () => editor.chain().focus().toggleTaskList().run(), 'Checklist')}
        {btn(<LinkIcon size={15} strokeWidth={2} aria-hidden="true" />, editor.isActive('link'), () => {
          if (editor.isActive('link')) {
            editor.chain().focus().unsetLink().run();
            return;
          }
          const url = window.prompt('Link URL:');
          if (url) editor.chain().focus().setLink({ href: url }).run();
        }, 'Add/remove link')}
        {btn(<FileText size={15} strokeWidth={2} aria-hidden="true" />, showNotePicker, () => {
          setShowNotePicker(!showNotePicker);
          setNoteQuery('');
        }, 'Link note ([[ )')}
      </div>
      {showNotePicker && (
        <div className="ed-wiki-picker" role="dialog" aria-label="Link note">
          <input
            type="text"
            className="ed-wiki-search"
            autoFocus
            placeholder="Search note to link…"
            value={noteQuery}
            onChange={(e) => setNoteQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setShowNotePicker(false);
              }
            }}
          />
          <div className="ed-wiki-list">
            {availableNotes
              .filter((n) => n.title.toLowerCase().includes(noteQuery.toLowerCase()))
              .slice(0, 8)
              .map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="ed-wiki-item"
                  onClick={() => insertNoteLink(n)}
                >
                  <FileText size={13} aria-hidden="true" />
                  <span>{n.title}</span>
                </button>
              ))}
            {availableNotes.filter((n) => n.title.toLowerCase().includes(noteQuery.toLowerCase())).length === 0 && (
              <span className="workflow-hint" style={{ padding: '6px' }}>No notes found</span>
            )}
          </div>
        </div>
      )}
      <div onClick={handleContentClick}>
        <EditorContent editor={editor} className="ed-content" />
      </div>
      <div className="ed-save-status" role="status">
        {saveState === 'waiting' || saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved on this device' : ''}
      </div>
      {saveState === 'error' && <div className="ed-save-error">
        <p role="alert">Couldn't save your changes. Retry save, or copy your text before closing this browser tab. This session keeps your draft when you leave the editor.</p>
        <button type="button" className="mini" onClick={() => { if (latest.current) persist(latest.current); }}>Retry save</button>
      </div>}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
