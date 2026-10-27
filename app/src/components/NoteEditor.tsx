import { useEffect, useRef, type ReactNode } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import { Bold, Italic, List, ListOrdered, ListChecks, Link as LinkIcon } from 'lucide-react';

// Rich-text notes: ProseMirror JSON in noteDoc, plain-text mirror in note
// (search reads `note`). Debounced saves so typing isn't a write storm.
export default function NoteEditor(props: {
  docKey: string;
  note: string;
  noteDoc: unknown | null;
  onSave: (doc: unknown, text: string) => void;
}) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(props.onSave);
  saveRef.current = props.onSave;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [3, 4] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false }),
    ],
    content: (props.noteDoc as object | null) ?? (props.note ? `<p>${escapeHtml(props.note).replace(/\n/g, '<br>')}</p>` : ''),
    onUpdate: ({ editor }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveRef.current(editor.getJSON(), editor.getText());
      }, 500);
    },
  });

  // Flush pending save on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        if (editor) {
          saveRef.current(editor.getJSON(), editor.getText());
        }
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
      </div>
      <EditorContent editor={editor} className="ed-content" />
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
