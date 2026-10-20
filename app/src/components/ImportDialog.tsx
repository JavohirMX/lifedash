import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Project } from '../types';
import { INBOX_ID } from '../db';
import { addProject, importTasks, importBackup } from '../repo';
import { detectSource, parse, type ImportSource, type ParseResult } from '../import';

const SOURCES: { id: ImportSource; label: string }[] = [
  { id: 'todoist-csv', label: 'Todoist CSV' },
  { id: 'generic-csv', label: 'Generic CSV (title, due, project, tags, done)' },
  { id: 'obsidian-md', label: 'Obsidian / Markdown tasks' },
  { id: 'lifedash-json', label: 'Lifedash JSON export' },
];

export default function ImportDialog(props: { projects: Project[]; onClose: () => void }) {
  const [text, setText] = useState('');
  const [filename, setFilename] = useState('');
  const [source, setSource] = useState<ImportSource | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [target, setTarget] = useState<string>(INBOX_ID);
  const [imported, setImported] = useState<number | null>(null);
  const [restored, setRestored] = useState<Record<string, number> | null>(null);
  const [restoreError, setRestoreError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    areaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadFile(f: File) {
    const t = await f.text();
    setFilename(f.name);
    setText(t);
    const s = detectSource(f.name, t);
    setSource(s);
    setResult(parse(s, t));
    setImported(null);
  }

  function reparse(s: ImportSource) {
    setSource(s);
    if (text) setResult(parse(s, text));
  }

  const needsPerSource = result?.tasks.some((t) => t.project) ?? false;

  // A Lifedash v2 export is a FULL backup, not just a task list.
  const fullBackup = useMemo(() => {
    if (source !== 'lifedash-json' || !text.trim()) return null;
    try {
      const d = JSON.parse(text) as Record<string, unknown>;
      if (d?.version !== 2 || !Array.isArray(d.tasks)) return null;
      return d;
    } catch { return null; }
  }, [source, text]);
  const COLL_LABELS: [string, string][] = [['projects', 'projects'], ['tasks', 'tasks'], ['habits', 'habits'], ['goals', 'goals'], ['notes', 'notes'], ['journal', 'journal entries']];
  const backupCounts = fullBackup
    ? COLL_LABELS.map(([k, label]) => [label, Array.isArray(fullBackup[k]) ? (fullBackup[k] as unknown[]).length : 0] as const)
    : [];

  async function runFullRestore() {
    setBusy(true);
    setRestoreError('');
    try { setRestored((await importBackup(text)).restored); }
    catch (e) { setRestoreError(e instanceof Error ? e.message : 'Restore failed. Nothing was restored.'); }
    finally { setBusy(false); }
  }

  async function run() {
    if (!result || result.tasks.length === 0) return;
    setBusy(true);
    try {
      const byName = new Map(props.projects.map((p) => [p.name.toLowerCase(), p.id]));
      if (target === 'per-source') {
        for (const t of result.tasks) {
          const name = t.project?.trim();
          if (name && !byName.has(name.toLowerCase())) {
            const p = await addProject(name, '#0f766e');
            byName.set(name.toLowerCase(), p.id);
          }
        }
      }
      const n = await importTasks(result.tasks, (sourceName) => {
        if (target === 'per-source' && sourceName) {
          return byName.get(sourceName.trim().toLowerCase()) ?? INBOX_ID;
        }
        return target;
      });
      setImported(n);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="palette-overlay" onClick={props.onClose}>
      <div className="import-panel" role="dialog" aria-modal="true" aria-label="Import tasks" onClick={(e) => e.stopPropagation()}>
        <div className="import-head">
          <h2>Import tasks</h2>
          <button className="icon-btn" aria-label="Close" onClick={props.onClose}><X size={18} strokeWidth={1.75} /></button>
        </div>

        {restored !== null ? (
          <div className="import-done">
            <p>Backup restored: {COLL_LABELS.filter(([k]) => (restored[k] ?? 0) > 0).map(([k, label]) => `${restored[k]} ${label}`).join(', ') || 'nothing found'}.</p>
            <button className="btn-primary" onClick={props.onClose}>Done</button>
          </div>
        ) : imported !== null ? (
          <div className="import-done">
            <p>Imported {imported} task{imported === 1 ? '' : 's'}.</p>
            <button className="btn-primary" onClick={props.onClose}>Done</button>
          </div>
        ) : (
          <>
            <div className="field">
              <span>Source file</span>
              <input aria-label="Source file"
                ref={fileRef}
                type="file"
                accept=".csv,.md,.markdown,.txt,.json"
                onChange={(e) => e.target.files?.[0] && void loadFile(e.target.files[0])}
              />
            </div>
            <div className="field">
              <span>or paste text {filename && `(loaded: ${filename})`}</span>
              <textarea ref={areaRef}
                rows={5}
                value={text}
                placeholder={'- [ ] A task\n- [x] A finished one'}
                onChange={(e) => {
                  setText(e.target.value);
                  setFilename('');
                  const s = source ?? detectSource('', e.target.value);
                  setSource(s);
                  setResult(e.target.value.trim() ? parse(s, e.target.value) : null);
                }}
              />
            </div>
            <div className="field">
              <span>Format</span>
              <select aria-label="Import format" value={source ?? ''} onChange={(e) => reparse(e.target.value as ImportSource)}>
                <option value="" disabled>Pick a format</option>
                {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>

            {fullBackup && (
              <div className="import-summary">
                <p className="import-count">Full Lifedash backup: {backupCounts.filter(([, n]) => n > 0).map(([label, n]) => `${n} ${label}`).join(', ')}.</p>
                <p className="import-warnings">Restoring merges by id: items in the backup overwrite matching existing items; nothing is deleted. Attachments are not part of exports.</p>
                <button className="btn-primary" disabled={busy} onClick={() => void runFullRestore()}>
                  {busy ? 'Restoring...' : 'Restore full backup'}
                </button>
                {restoreError && <p role="alert" className="import-warnings">{restoreError}</p>}
                <p className="import-count" style={{ marginTop: 8 }}>Or import only the tasks:</p>
              </div>
            )}
            {result && (
              <div className="import-summary">
                <p className="import-count">
                  {result.tasks.length} task{result.tasks.length === 1 ? '' : 's'} found
                  {result.tasks.some((t) => t.done) && ` (${result.tasks.filter((t) => t.done).length} already done)`}
                </p>
                {result.warnings.length > 0 && (
                  <ul className="import-warnings">
                    {result.warnings.slice(0, 4).map((w, i) => <li key={i}>{w}</li>)}
                    {result.warnings.length > 4 && <li>...and {result.warnings.length - 4} more</li>}
                  </ul>
                )}
                {result.tasks.length > 0 && (
                  <ul className="import-preview">
                    {result.tasks.slice(0, 5).map((t, i) => (
                      <li key={i} className={t.done ? 'done' : ''}>
                        {'\u00A0'.repeat(t.indent * 4)}{t.title}
                        {t.dueDate && <span className="date-sub"> {t.dueDate}</span>}
                      </li>
                    ))}
                    {result.tasks.length > 5 && <li>...and {result.tasks.length - 5} more</li>}
                  </ul>
                )}
                {result.tasks.length > 0 && (
                  <div className="field">
                    <span>Add to</span>
                    <select value={target} onChange={(e) => setTarget(e.target.value)}>
                      <option value={INBOX_ID}>Inbox</option>
                      {props.projects.filter((p) => p.id !== INBOX_ID).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                      {needsPerSource && <option value="per-source">Match source projects (create missing)</option>}
                    </select>
                  </div>
                )}
                <button className="btn-primary" disabled={busy || result.tasks.length === 0} onClick={() => void run()}>
                  {busy ? 'Importing...' : `Import ${result.tasks.length || ''} task${result.tasks.length === 1 ? '' : 's'}`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
