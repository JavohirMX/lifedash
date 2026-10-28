import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Project } from '../types';
import { db, INBOX_ID } from '../db';
import { addProject, importTasks, importBackup } from '../repo';
import { detectSource, parse, type ImportSource, type ParseResult } from '../import';
import { useDialogFocus } from '../hooks/useDialogFocus';

const SOURCES: { id: ImportSource; label: string }[] = [
  { id: 'todoist-csv', label: 'Todoist CSV' },
  { id: 'generic-csv', label: 'Generic CSV (title, due, project, tags, done)' },
  { id: 'obsidian-md', label: 'Obsidian / Markdown tasks' },
  { id: 'lifedash-json', label: 'Lifedash JSON export' },
];

export default function ImportDialog(props: { projects: Project[]; initialSource?: ImportSource | null; onClose: () => void; onRestoreSettled?: () => void }) {
  const [text, setText] = useState('');
  const [filename, setFilename] = useState('');
  const [source, setSource] = useState<ImportSource | null>(props.initialSource ?? null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [target, setTarget] = useState<string>(INBOX_ID);
  const [imported, setImported] = useState<number | null>(null);
  const [restored, setRestored] = useState<Record<string, number> | null>(null);
  const [restoreError, setRestoreError] = useState('');
  const [importError, setImportError] = useState('');
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const panel = useDialogFocus<HTMLDivElement>(props.onClose, 'textarea');

  const fileRead = useRef(0);
  useEffect(() => () => { fileRead.current++; }, []);

  async function loadFile(f: File) {
    const generation = ++fileRead.current;
    let t: string;
    try { t = await f.text(); }
    catch { if (generation === fileRead.current) setImportError("Couldn't read this file. Choose it again or paste the text below."); return; }
    if (generation !== fileRead.current) return;
    setImportError('');
    setFilename(f.name);
    setText(t);
    const s = detectSource(f.name, t);
    setSource(s);
    setResult(parse(s, t));
    setImported(null);
  }

  function reparse(s: ImportSource) {
    fileRead.current++;
    setSource(s);
    if (text) setResult(parse(s, text));
  }

  const needsPerSource = result?.tasks.some((t) => t.project) ?? false;

  // A Lifedash v2 export is a FULL backup, not just a task list.
  const fullBackup = useMemo(() => {
    if (source !== 'lifedash-json' || !text.trim()) return null;
    try {
      const d = JSON.parse(text) as Record<string, unknown>;
      if (![2, 3].includes(d?.version as number) || !Array.isArray(d.tasks)) return null;
      return d;
    } catch { return null; }
  }, [source, text]);
  const COLL_LABELS: [string, string, string][] = [
    ['attachments', 'attachment file', 'attachment files'],
    ['focusSessions', 'focus session', 'focus sessions'],
    ['habitLogs', 'habit log', 'habit logs'],
    ['projects', 'project', 'projects'],
    ['tasks', 'task', 'tasks'],
    ['habits', 'habit', 'habits'],
    ['habitLogs', 'habit log', 'habit logs'],
    ['goals', 'goal', 'goals'],
    ['notes', 'note', 'notes'],
    ['journal', 'journal entry', 'journal entries'],
    ['focusSessions', 'focus session', 'focus sessions'],
  ];
  const countText = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const backupCounts = fullBackup
    ? COLL_LABELS.map(([k, one, many]) => ({ n: Array.isArray(fullBackup[k]) ? (fullBackup[k] as unknown[]).length : 0, text: countText(Array.isArray(fullBackup[k]) ? (fullBackup[k] as unknown[]).length : 0, one, many) }))
    : [];

  async function runFullRestore() {
    if (writing.current) return;
    writing.current = true; fileRead.current++; setBusy(true);
    setRestoreError('');
    try { setRestored((await importBackup(text)).restored); }
    catch (e) { setRestoreError(e instanceof Error ? e.message : 'Restore failed. Nothing was restored.'); }
    finally { writing.current = false; setBusy(false); props.onRestoreSettled?.(); }
  }

  async function run() {
    if (writing.current || !result || result.tasks.length === 0) return;
    writing.current = true; fileRead.current++; setBusy(true);
    setImportError('');
    try {
      const n = await db.transaction('rw', db.projects, db.tasks, async () => {
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
        return importTasks(result.tasks, (sourceName) => {
          if (target === 'per-source' && sourceName) {
            return byName.get(sourceName.trim().toLowerCase()) ?? INBOX_ID;
          }
          return target;
        });
      });
      setImported(n);
    } catch {
      setImportError("Couldn't import tasks. No tasks or projects were added. Your source text is still here; try again.");
    } finally {
      writing.current = false; setBusy(false);
    }
  }

  return (
    <div className="palette-overlay" onClick={props.onClose}>
      <div ref={panel} className="import-panel" role="dialog" aria-modal="true" aria-label={props.initialSource === 'lifedash-json' ? 'Restore backup' : 'Import tasks'} onClick={(e) => e.stopPropagation()}>
        <div className="import-head">
          <h2>{props.initialSource === 'lifedash-json' ? 'Restore backup' : 'Import tasks'}</h2>
          <button className="icon-btn" aria-label="Close" onClick={props.onClose}><X size={18} strokeWidth={1.75} /></button>
        </div>

        {restored !== null ? (
          <div className="import-done">
            <p>Backup restored: {COLL_LABELS.filter(([k]) => (restored[k] ?? 0) > 0).map(([k, one, many]) => countText(restored[k], one, many)).join(', ') || 'nothing found'}.</p>
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
              <input disabled={busy} aria-label="Source file"
                ref={fileRef}
                type="file"
                accept=".csv,.md,.markdown,.txt,.json"
                onChange={(e) => e.target.files?.[0] && void loadFile(e.target.files[0])}
              />
            </div>
            <div className="field">
              <span>or paste text {filename && `(loaded: ${filename})`}</span>
              <textarea disabled={busy} aria-label="Import source text" ref={areaRef}
                rows={5}
                value={text}
                placeholder={source === 'lifedash-json' ? '{"version": 2, "tasks": [ ... ], ...}' : '- [ ] A task\n- [x] A finished one'}
                onChange={(e) => {
                  fileRead.current++;
                  setImportError('');
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
              <select disabled={busy} aria-label="Import format" value={source ?? ''} onChange={(e) => reparse(e.target.value as ImportSource)}>
                <option value="" disabled>Pick a format</option>
                {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>

            {importError && <p role="alert" className="import-warnings">{importError}</p>}
            {fullBackup && (
              <div className="import-summary">
                <p className="import-count">Backup data: {backupCounts.filter((c) => c.n > 0).map((c) => c.text).join(', ')}.</p>
                <p className="import-warnings">Restoring merges by id: items in the backup overwrite matching existing items; nothing is deleted. {fullBackup.version === 3 ? 'Portable backup includes attachment files. File checks run before any records are restored.' : 'Legacy JSON has attachment metadata only; files are not restored.'}</p>
                <button className="btn-primary" disabled={busy} onClick={() => void runFullRestore()}>
                  {busy ? 'Restoring...' : 'Restore backup data'}
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
                    <select disabled={busy} aria-label="Add imported tasks to" value={target} onChange={(e) => setTarget(e.target.value)}>
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
