import './workflow.css';
import CompletionButton from '../components/CompletionButton';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ListPlus, Pin, PinOff, Plus, Search, Sparkles, StickyNote, Trash2, X } from 'lucide-react';

import { addNote, updateNote, deleteNote, addTasksFromNoteChecklist, addTask } from '../repo';
import { extractChecklistItems, searchNotes } from '../logic';
import { db, INBOX_ID } from '../db';
import NoteEditor from '../components/NoteEditor';
import NoteTitle, { discardDeletedNoteTitle } from '../components/NoteTitle';
import { PageHeader } from '../components/Page';
import { useAiSettings, loadAiSettings } from '../ai/aiSettings';
import { reviewRequest, requestAdvice } from '../ai/provider';
import { parseAiResponse, type TaskItemProposal } from '../ai/proposalParser';

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

  // AI Task Extraction state
  const aiSettings = useAiSettings();
  const [aiExtractOpen, setAiExtractOpen] = useState(false);
  const [aiExtractLoading, setAiExtractLoading] = useState(false);
  const [aiExtractedTasks, setAiExtractedTasks] = useState<TaskItemProposal[]>([]);
  const [selectedExtractedTasks, setSelectedExtractedTasks] = useState<Record<number, boolean>>({});
  const [aiExtractNotice, setAiExtractNotice] = useState<string>('');

  async function handleAiExtract(note: { id: string; title: string; note: string }) {
    setAiExtractOpen(true);
    setAiExtractLoading(true);
    setAiExtractNotice('');

    try {
      const s = loadAiSettings();
      if (s.baseUrl && s.model) {
        const prompt = `Extract all concrete actionable tasks from this note titled "${note.title}". Content:\n${note.note.slice(0, 3000)}\nOutput format: \`\`\`json\n{ "action": "create_tasks", "items": [{ "title": "task title", "priority": 1, "dueDate": null }] }\n\`\`\``;
        const reviewed = reviewRequest({ baseUrl: s.baseUrl, model: s.model, apiKey: s.apiKey }, prompt, '');
        const raw = await requestAdvice({ baseUrl: s.baseUrl, model: s.model, apiKey: s.apiKey }, reviewed, true);
        const parsed = parseAiResponse(raw);
        const taskProp = parsed.proposals.find((p) => p.action === 'create_tasks');
        if (taskProp && taskProp.items.length > 0) {
          setAiExtractedTasks(taskProp.items);
          const map: Record<number, boolean> = {};
          taskProp.items.forEach((_, idx) => (map[idx] = true));
          setSelectedExtractedTasks(map);
          setAiExtractLoading(false);
          return;
        }
      }
    } catch {
      // Fallback to text parsing heuristics
    }

    const lines = note.note.split('\n').map((l) => l.replace(/^[-*•]\s+/, '').trim()).filter((l) => l.length > 4 && l.length < 120);
    const candidateTasks: TaskItemProposal[] = lines.slice(0, 5).map((l) => ({ title: l, priority: 0 }));
    if (candidateTasks.length === 0) {
      candidateTasks.push({ title: `Follow up on: ${note.title || 'Note'}`, priority: 0 });
    }
    setAiExtractedTasks(candidateTasks);
    const map: Record<number, boolean> = {};
    candidateTasks.forEach((_, idx) => (map[idx] = true));
    setSelectedExtractedTasks(map);
    setAiExtractLoading(false);
  }

  async function handleApplyExtractedTasks(noteId: string) {
    let count = 0;
    for (let i = 0; i < aiExtractedTasks.length; i++) {
      if (selectedExtractedTasks[i]) {
        const item = aiExtractedTasks[i];
        await addTask({
          title: item.title,
          priority: item.priority ?? 0,
          dueDate: item.dueDate,
          dueTime: item.dueTime,
          tags: item.tags,
          noteId,
          projectId: INBOX_ID,
        });
        count++;
      }
    }
    setAiExtractNotice(`Created ${count} task${count === 1 ? '' : 's'} linked to this note.`);
    setAiExtractOpen(false);
    setAiExtractedTasks([]);
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
      <PageHeader
        eyebrow="Reference"
        title="Notes"
        meta={filtering ? `${shown.length} of ${sorted.length}` : `${sorted.length} total`}
        description="Long-form thinking, checklists, and reference material. Link a note to a task when it belongs to one."
        actions={(
          <button className="btn-primary" aria-label="New note" disabled={isCreating} onClick={() => void createNote()}>
            <Plus size={14} strokeWidth={2} aria-hidden="true" /> New note
          </button>
        )}
      />
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
            enterKeyHint="search"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && !e.nativeEvent.isComposing) setQ(''); }}
          />
          {q.length > 0 && (
            <button
              type="button"
              className="search-clear-btn"
              aria-label="Clear filter"
              onClick={() => setQ('')}
            >
              <X size={13} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
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
                {aiSettings.enabled && (
                  <button
                    className="icon-btn"
                    aria-label="Extract tasks with AI"
                    title="Extract action items with AI"
                    onClick={() => void handleAiExtract(open)}
                  >
                    <Sparkles size={15} strokeWidth={2} />
                  </button>
                )}
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
                {aiExtractNotice && <span className="extracted-note num" role="status" style={{ color: 'var(--accent, #0f766e)' }}>{aiExtractNotice}</span>}
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
      {aiSettings.enabled && aiExtractOpen && open && (
        <div
          className="planner-modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setAiExtractOpen(false)}
        >
          <div
            className="planner-ai-modal"
            style={{
              background: 'var(--surface, #fff)',
              color: 'var(--text, #17202a)',
              border: '1px solid var(--border, #cad1d7)',
              borderRadius: 12,
              padding: 20,
              width: 'min(480px, 90vw)',
              maxHeight: '80vh',
              overflow: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={16} color="var(--accent, #0f766e)" />
                Extract Action Items
              </h3>
              <button type="button" className="mini" onClick={() => setAiExtractOpen(false)}>
                ✕
              </button>
            </div>
            <p style={{ fontSize: 12, opacity: 0.8, margin: '0 0 14px' }}>
              Select which action items to turn into tasks linked to "{open.title || 'this note'}".
            </p>

            {aiExtractLoading ? (
              <p style={{ fontSize: 13, color: 'var(--muted, #64748b)' }}>Scanning note for action items…</p>
            ) : aiExtractedTasks.length === 0 ? (
              <p style={{ fontSize: 13 }}>No action items detected in this note.</p>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  {aiExtractedTasks.map((item, idx) => (
                    <label
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 8,
                        fontSize: 13,
                        cursor: 'pointer',
                        padding: '6px 8px',
                        background: 'var(--surface-2, #f8fafc)',
                        borderRadius: 6,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedExtractedTasks[idx] ?? false}
                        onChange={(e) =>
                          setSelectedExtractedTasks((prev) => ({ ...prev, [idx]: e.target.checked }))
                        }
                      />
                      <span>
                        <strong>{item.title}</strong>
                        {item.priority ? ` (P${item.priority})` : ''}
                      </span>
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button type="button" className="mini" onClick={() => setAiExtractOpen(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!Object.values(selectedExtractedTasks).some(Boolean)}
                    onClick={() => void handleApplyExtractedTasks(open.id)}
                  >
                    Create Selected Tasks
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
