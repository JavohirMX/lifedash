import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, StickyNote, Target, X } from 'lucide-react';
import { db } from '../db';
import { searchTasks, searchNotes, searchJournal, searchGoals, normalizeTag } from '../logic';
import { renameTag } from '../repo';
import TaskList from '../components/TaskList';
import { PageHeader } from '../components/Page';
import type { Task, Project } from '../types';
import type { Selection } from '../components/Sidebar';

type SearchSel = Extract<Selection, { kind: 'search' }>;
type Scope = 'all' | 'tasks' | 'notes' | 'journal' | 'goals';

export default function SearchView(props: {
  tasks: Task[];
  projects: Project[];
  selection: SearchSel;
  onPatch: (patch: Partial<SearchSel>) => void;
  onOpenTask: (id: string) => void;
  onSelect: (sel: Selection) => void;
}) {
  const { selection } = props;
  const [renameStatus, setRenameStatus] = useState('');
  const notes = useLiveQuery(() => db.notes.toArray(), []);
  // A query that is exactly one #tag enables tag management.
  const tagMatch = selection.query.trim().match(/^#([\w-]+)$/);
  const onlyTag = tagMatch ? normalizeTag(tagMatch[1]) : null;
  const journal = useLiveQuery(() => db.journal.toArray(), []);
  const goals = useLiveQuery(() => db.goals.toArray(), []);

  const scope: Scope = selection.scope ?? 'all';
  const statusFilter = selection.status ?? 'all';
  const projectFilter = selection.projectId ?? null;

  let taskResults = scope === 'all' || scope === 'tasks' ? searchTasks(props.tasks, selection.query) : [];
  if (statusFilter === 'open') taskResults = taskResults.filter((t) => t.status === 'active');
  if (statusFilter === 'done') taskResults = taskResults.filter((t) => t.status === 'done');
  const projectIdsInResults = [...new Set(taskResults.map((t) => t.projectId))];
  if (projectFilter) taskResults = taskResults.filter((t) => t.projectId === projectFilter);

  const noteResults = scope === 'all' || scope === 'notes' ? searchNotes(notes ?? [], selection.query) : [];
  const journalResults = scope === 'all' || scope === 'journal' ? searchJournal(journal ?? [], selection.query) : [];
  const goalResults = scope === 'all' || scope === 'goals' ? searchGoals(goals ?? [], selection.query) : [];
  const total = taskResults.length + noteResults.length + journalResults.length + goalResults.length;

  const queryTags = selection.query.trim().split(/\s+/).filter((tok) => tok.startsWith('#'));
  const removeTag = (tag: string) =>
    props.onPatch({ query: selection.query.split(/\s+/).filter((tok) => tok !== tag).join(' ') });

  const excerpt = (text: string, n = 110): string => {
    const t = text.replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  };

  return (
    <section>
      <PageHeader
        eyebrow="Search · everything local"
        title="Search"
        meta={`${total} result${total === 1 ? '' : 's'}`}
        description={<>Results for <strong>{selection.query}</strong></>}
      />
      {renameStatus && <p className="date-sub" role="status">{renameStatus}</p>}
      {onlyTag && <TagRename key={onlyTag} tag={onlyTag} onRenamed={(to, status) => { setRenameStatus(status); props.onPatch({ query: `#${to}` }); }} />}

      <div className="filter-chips" role="group" aria-label="Search scope">
        {(['all', 'tasks', 'notes', 'journal', 'goals'] as const).map((sc) => (
          <button
            key={sc}
            className={`chip${scope === sc ? ' active' : ''}`}
            aria-pressed={scope === sc}
            onClick={() => props.onPatch({ scope: sc })}
          >
            {sc[0].toUpperCase() + sc.slice(1)}
          </button>
        ))}
        {queryTags.map((tag) => (
          <button key={tag} className="chip tag" onClick={() => removeTag(tag)} title="Remove this tag filter">
            {tag} <X size={12} strokeWidth={2} aria-hidden="true" />
          </button>
        ))}
      </div>
      {(scope === 'all' || scope === 'tasks') && (
        <div className="filter-chips" role="group" aria-label="Task filters">
          {(['all', 'open', 'done'] as const).map((st) => (
            <button
              key={st}
              className={`chip${statusFilter === st ? ' active' : ''}`}
              aria-pressed={statusFilter === st}
              onClick={() => props.onPatch({ status: st })}
            >
              {st === 'all' ? 'All tasks' : st === 'open' ? 'Open' : 'Done'}
            </button>
          ))}
          {(projectIdsInResults.length > 1 || projectFilter) && (
            <select
              className="chip select"
              aria-label="Filter by project"
              value={projectFilter ?? ''}
              onChange={(e) => props.onPatch({ projectId: e.target.value || null })}
            >
              <option value="">Every project</option>
              {[...new Set([...projectIdsInResults, ...(projectFilter ? [projectFilter] : [])])].map((pid) => (
                <option key={pid} value={pid}>{props.projects.find((p) => p.id === pid)?.name ?? pid}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {total === 0 && <p className="empty">Nothing matches. Tip: #tag filters tasks by tag.</p>}

      {taskResults.length > 0 && (
        <>
          {scope === 'all' && <h2 className="search-group">Tasks</h2>}
          <TaskList tasks={taskResults} allTasks={props.tasks} onTag={(tag) => props.onSelect({ kind: 'search', query: `#${tag}` })} showDate onOpen={props.onOpenTask} />
        </>
      )}

      {noteResults.length > 0 && (
        <>
          <h2 className="search-group">Notes</h2>
          <div className="search-cards">
            {noteResults.map((n) => (
              <button key={n.id} className="search-card" onClick={() => props.onSelect({ kind: 'notes', openId: n.id })}>
                <span className="search-card-title">
                  <StickyNote size={13} strokeWidth={1.75} aria-hidden="true" />
                  {n.title.trim() || 'Untitled'}
                </span>
                <span className="search-card-sub">{excerpt(n.note) || 'Empty note'}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {journalResults.length > 0 && (
        <>
          <h2 className="search-group">Journal</h2>
          <div className="search-cards">
            {journalResults.map((e) => (
              <button key={e.id} className="search-card" onClick={() => props.onSelect({ kind: 'journal', date: e.date })}>
                <span className="search-card-title">
                  <BookOpen size={13} strokeWidth={1.75} aria-hidden="true" />
                  {e.date}
                </span>
                <span className="search-card-sub">{excerpt(e.note)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {goalResults.length > 0 && (
        <>
          <h2 className="search-group">Goals</h2>
          <div className="search-cards">
            {goalResults.map((g) => (
              <button key={g.id} className="search-card" onClick={() => props.onSelect({ kind: 'goals' })}>
                <span className="search-card-title">
                  <Target size={13} strokeWidth={1.75} aria-hidden="true" />
                  {g.title}
                </span>
                <span className="search-card-sub">{g.status === 'done' ? 'Done' : 'Active'}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function TagRename({ tag, onRenamed }: { tag: string; onRenamed: (to: string, status: string) => void }) {
  const [renaming, setRenaming] = useState(false), [newTag, setNewTag] = useState(tag);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const writing = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function save() {
    if (writing.current) return;
    const to = normalizeTag(newTag);
    if (!to || to === tag) { setRenaming(false); return; }
    writing.current = true; setBusy(true); setError('');
    try {
      const n = await renameTag(tag, to);
      if (mounted.current) {
        setRenaming(false);
        onRenamed(to, `Renamed #${tag} to #${to} on ${n} task${n === 1 ? '' : 's'}.`);
      }
    } catch { if (mounted.current) setError("Couldn't rename this tag. Your text is still here. Try Save again."); }
    finally { writing.current = false; if (mounted.current) setBusy(false); }
  }
  return <div className="tag-manage">
    {!renaming ? <button className="mini" onClick={() => { setRenaming(true); setNewTag(tag); setError(''); }}>Rename #{tag}</button> :
      <form className="tag-rename" onSubmit={e => { e.preventDefault(); void save(); }} aria-busy={busy}>
        <input value={newTag} disabled={busy} onChange={e => setNewTag(e.target.value)} aria-label="New tag name" autoFocus />
        <button className="mini" type="submit" disabled={busy}>Save</button>
        <button className="mini" type="button" disabled={busy} onClick={() => setRenaming(false)}>Cancel</button>
        {busy && <p className="sub-add-feedback" role="status">Renaming tag…</p>}
        {error && <p className="form-save-error" role="alert">{error}</p>}
      </form>}
  </div>;
}
