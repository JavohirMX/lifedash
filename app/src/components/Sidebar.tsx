import { useDialogFocus } from '../hooks/useDialogFocus';
import { useEffect, useRef, useState } from 'react';
import { Settings, CalendarClock,
  Sun, CalendarDays, Archive, Clock, CalendarRange, Repeat, CheckCircle2,
  Search, Plus, Menu, X, Download, Upload, Palette, Zap, House, Target, StickyNote, BookOpen, Monitor,
} from 'lucide-react';
import { projectTree } from '../projects';
import type { Project } from '../types';
import { addProject, countAttachments, exportJson } from '../repo';
import { db } from '../db';
import { tasksToMarkdown } from '../exportMd';
import { tasksToIcs } from '../ics';
import { todayStr } from '../dates';

export type Selection =
  | { kind: 'home' | 'today' | 'upcoming' | 'backlog' | 'completed' | 'habits' | 'planner' | 'week' | 'goals' | 'calendar' }
  | { kind: 'notes'; openId?: string }
  | { kind: 'journal'; date?: string }
  | { kind: 'project'; id: string }
  | { kind: 'search'; query: string; status?: 'all' | 'open' | 'done'; projectId?: string | null; scope?: 'all' | 'tasks' | 'notes' | 'journal' | 'goals' };

const COLORS = ['#0f766e', '#2563eb', '#b45309', '#be123c', '#4d7c0f', '#0e7490'];

function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="var(--accent)" />
      <path d="M12 36h10l4-12 6 20 5-14 3 6h12" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const NAV_GROUPS = [
  { label: 'Start', items: [
    { kind: 'home', label: 'Home', Icon: House },
  ] },
  { label: 'Planning views', items: [
    { kind: 'today', label: 'Today', Icon: Sun },
    { kind: 'upcoming', label: 'Upcoming', Icon: CalendarClock },
    { kind: 'planner', label: 'Planner', Icon: Clock },
    { kind: 'week', label: 'Week', Icon: CalendarRange },
    { kind: 'calendar', label: 'Calendar', Icon: CalendarDays },
    { kind: 'backlog', label: 'Backlog', Icon: Archive },
  ] },
  { label: 'History', items: [
    { kind: 'completed', label: 'Completed', Icon: CheckCircle2 },
  ] },
  { label: 'Track', items: [
    { kind: 'habits', label: 'Habits', Icon: Repeat },
    { kind: 'goals', label: 'Goals', Icon: Target },
    { kind: 'journal', label: 'Journal', Icon: BookOpen },
    { kind: 'notes', label: 'Notes', Icon: StickyNote },
  ] },
] as const;

const DOCK_ITEMS = [
  { kind: 'home', label: 'Home', Icon: House },
  { kind: 'today', label: 'Today', Icon: Sun },
  { kind: 'planner', label: 'Planner', Icon: Clock },
  { kind: 'habits', label: 'Habits', Icon: Repeat },
] as const; // 4 + More = 5; Week lives in the sheet

export default function Sidebar(props: {
  projects: Project[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  counts: { today: number; backlog: number };
  activeByProject?: Record<string, number>;
  onScheduleToday?: (taskId: string) => void;
  onImport: () => void;
  onRestore: () => void;
  onAutomation: () => void;
  journalNudge: boolean;
  onToggleJournalNudge: () => void;
  onSync: () => void;
  onAI?: () => void;
  reminders: 'on' | 'off' | 'blocked' | 'unsupported' | 'needs-permission';
  onToggleReminders: () => void;
  onAppearance: () => void;
  onSettings: () => void;
  onPalette?: () => void;
  onCapture?: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [addParent, setAddParent] = useState<string | null>(null);
  const [name, setName] = useState('');
  const projectWriting = useRef(false);
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectError, setProjectError] = useState('');
  async function createProject() {
    if (projectWriting.current || !name.trim()) return;
    projectWriting.current = true; setProjectBusy(true); setProjectError('');
    try {
      await addProject(name, COLORS[props.projects.length % COLORS.length], addParent);
      setName(''); setAddParent(null); setAdding(false);
    } catch { setProjectError("Couldn't add this project. Your entries are still here. Try Add project again."); }
    finally { projectWriting.current = false; setProjectBusy(false); }
  }

  const [query, setQuery] = useState('');
  // Keep the box in step with external query changes (filter chips, Esc).
  useEffect(() => {
    setQuery(props.selection.kind === 'search' ? props.selection.query : '');
  }, [props.selection]);
  const [sheet, setSheet] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const sheetPanel = useDialogFocus<HTMLDivElement>(() => setSheet(false), '[aria-label="Close menu"]', sheet);
  const openTool = (open: () => void) => {
    // A sheet action disappears when the dialog opens. Keep its persistent
    // opener focused so the dialog can return keyboard focus on close.
    if (sheet) moreButton.current?.focus();
    setSheet(false);
    open();
  };
  const prevSelection = useRef<Selection | null>(null);
  const ThemeIcon = Palette;

  const countFor = (kind: string) =>
    kind === 'today' ? props.counts.today : kind === 'backlog' ? props.counts.backlog : 0;

  const item = (kind: Selection['kind'], label: string, Icon: typeof Sun, after?: () => void) => (
    <button
      key={kind}
      className={`nav ${props.selection.kind === kind ? 'active' : ''}`}
      onClick={() => {
        props.onSelect({ kind } as Selection);
        after?.();
      }}
      onDragOver={
        kind === 'today' && props.onScheduleToday
          ? (e) => {
              if (e.dataTransfer.types.includes('application/x-lifedash-task')) e.preventDefault();
            }
          : undefined
      }
      onDrop={
        kind === 'today' && props.onScheduleToday
          ? (e) => {
              const id = e.dataTransfer.getData('application/x-lifedash-task');
              if (id) {
                e.preventDefault();
                props.onScheduleToday!(id);
              }
            }
          : undefined
      }
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>{label}</span>
      {countFor(kind) > 0 && <span className="count num">{countFor(kind)}</span>}
    </button>
  );

  const searchBox = (
    <div className="search-wrap">
      <Search size={14} strokeWidth={1.75} aria-hidden="true" className="search-icon" />
      <input
        className="search-box"
        placeholder="Search tasks, #tags"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.trim()) {
            if (props.selection.kind !== 'search') prevSelection.current = props.selection;
            props.onSelect({ kind: 'search', query: e.target.value });
          } else props.onSelect(prevSelection.current ?? { kind: 'today' });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
            setQuery('');
            props.onSelect(prevSelection.current ?? { kind: 'today' });
          }
        }}
      />
    </div>
  );

  const projectsBlock = (
    <>
      <div className="nav-section">
        <span>Projects</span>
        <button className="icon-btn" title="New project" aria-label="New project" disabled={projectBusy} onClick={() => { setAdding(true); setProjectError(''); }}>
          <Plus size={14} strokeWidth={1.75} />
        </button>
      </div>
      {projectTree(props.projects).map(({ project: p, depth }) => (
        <button
          key={p.id}
          className={`nav project ${props.selection.kind === 'project' && props.selection.id === p.id ? 'active' : ''}`}
          style={depth > 0 ? { paddingLeft: 12 + depth * 18 } : undefined}
          onClick={() => {
            props.onSelect({ kind: 'project', id: p.id });
            setSheet(false);
          }}
        >
          <span className="dot" style={{ background: p.color }} />
          <span>{p.name}</span>
          {(props.activeByProject?.[p.id] ?? 0) > 0 && (
            <span className="proj-count num" title="Direct active tasks">{props.activeByProject![p.id]}</span>
          )}
        </button>
      ))}
      {adding && (
        <div className="project-add">
          <input
            autoFocus
            value={name}
            placeholder="Project name"
            aria-label="New project name" disabled={projectBusy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void createProject();
              if (e.key === 'Escape' && !e.nativeEvent.isComposing) setAdding(false);
            }}
          />
          <select
            className="project-add-parent" disabled={projectBusy}
            value={addParent ?? ''}
            onChange={(e) => setAddParent(e.target.value || null)}
            aria-label="Parent project"
          >
            <option value="">Top level</option>
            {projectTree(props.projects).map(({ project: p, depth }) => (
              <option key={p.id} value={p.id}>{' '.repeat(depth)}{p.name}</option>
            ))}
          </select>
          <button className="mini" disabled={projectBusy || !name.trim()} onClick={() => void createProject()}>Add project</button>
          <button className="mini" disabled={projectBusy} onClick={() => setAdding(false)}>Cancel</button>
          {projectBusy && <p className="project-save-feedback" role="status">Saving project…</p>}
          {projectError && <p className="project-save-feedback" role="alert">{projectError}</p>}
        </div>
      )}
    </>
  );

  const [exportMenu, setExportMenu] = useState(false);
  const exportWrap = useRef<HTMLDivElement>(null);
  const exportTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (exportMenu) exportWrap.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
  }, [exportMenu]);
  const closeExport = () => { setExportMenu(false); exportTrigger.current?.focus(); };
  useEffect(() => {
    if (!exportMenu) return;
    const outside = (e: PointerEvent) => { if (!exportWrap.current?.contains(e.target as Node)) setExportMenu(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [exportMenu]);

  const downloadFile = (content: string, type: string, name: string) => {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exporting = useRef(false);
  const [exportBusy, setExportBusy] = useState(false), [exportError, setExportError] = useState('');
  async function exportData(format: 'JSON' | 'Markdown' | 'Calendar') {
    if (exporting.current) return;
    exporting.current = true; setExportBusy(true); setExportError(''); closeExport();
    try {
      if (format === 'JSON') {
        const [json, files] = await Promise.all([exportJson(), countAttachments()]);
        downloadFile(json, 'application/json', `lifedash-export-${new Date().toISOString().slice(0, 10)}.json`);
        if (files > 0) window.alert(`Exported. Note: ${files} attachment file${files === 1 ? ' stays' : 's stay'} on this device - the export keeps only their names and metadata.`);
      } else {
        const [tasks, projects] = await Promise.all([db.tasks.toArray(), db.projects.toArray()]);
        if (format === 'Markdown') downloadFile(tasksToMarkdown(tasks, projects), 'text/markdown', `lifedash-tasks-${todayStr()}.md`);
        else downloadFile(tasksToIcs(tasks, projects), 'text/calendar', `lifedash-tasks-${todayStr()}.ics`);
      }
    } catch { setExportError(`Couldn't prepare the ${format} export. Open Export and choose ${format} again.`); }
    finally { exporting.current = false; setExportBusy(false); }
  }

  const exportBtn = (
    <div ref={exportWrap} className="export-wrap" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setExportMenu(false); }} onKeyDown={e => {
      if (e.key === 'Escape' && exportMenu) { e.preventDefault(); e.stopPropagation(); closeExport(); }
      const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]'));
      if (!items.length) return;
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'ArrowDown' ? (index + 1) % items.length : e.key === 'ArrowUp' ? (index + items.length - 1) % items.length : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
      if (next !== null) { e.preventDefault(); e.stopPropagation(); items[next].focus(); }
    }}>
      <button
        disabled={exportBusy}
        ref={exportTrigger}
        className="nav foot-action"
        aria-haspopup="menu"
        onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setExportMenu(true); } }}
        aria-expanded={exportMenu}
        onClick={() => setExportMenu(!exportMenu)}
      >
        <Download size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>Export</span>
      </button>
      {exportBusy && <p className="sub-add-feedback" role="status">Preparing export…</p>}
      {exportError && <p className="sub-add-feedback" role="alert">{exportError}</p>}
      {exportMenu && (
        <div className="export-menu" role="menu" aria-label="Export format">
          <button type="button" role="menuitem" className="export-item" onClick={() => void exportData('JSON')}>
            <strong>JSON backup</strong>
            <span>App data and attachment metadata; files stay on this device</span>
          </button>
          <button type="button" role="menuitem" className="export-item" onClick={() => void exportData('Markdown')}>
            <strong>Markdown</strong>
            <span>Tasks only, readable anywhere</span>
          </button>
          <button type="button" role="menuitem" className="export-item" onClick={() => void exportData('Calendar')}>
            <strong>Calendar (.ics)</strong>
            <span>Open dated tasks; calendar import file, not live sync</span>
          </button>
        </div>
      )}
    </div>
  );

  const tvBtn = (
    <button className="nav foot-action" onClick={() => { window.location.hash = '/tv'; }}>
      <Monitor size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>TV dashboard</span>
    </button>
  );

  const restoreBtn = (
    <button className="nav foot-action" onClick={() => openTool(props.onRestore)}>
      <Upload size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>Restore backup</span>
    </button>
  );

  const footer = (
    <div className="sidebar-foot" role="group" aria-label="Tools">
      <div className="nav-section"><span>Tools</span></div>
      {props.onAI && <button className="nav foot-action" onClick={() => { openTool(() => props.onAI?.()); }}>Plan with AI</button>}
      <button className="nav foot-action" onClick={() => { openTool(props.onAutomation); }}><Zap size={16} aria-hidden="true" /> Automation</button>
      {tvBtn}
      <button className="nav foot-action" onClick={() => { openTool(props.onImport); }}><Upload size={16} aria-hidden="true" /> Import</button>
      {restoreBtn}{exportBtn}
      <button className="nav foot-action" onClick={() => { openTool(props.onSettings); }}><Settings size={16} aria-hidden="true" /> Settings</button>
    </div>
  );
  const navigation = (after?: () => void) => NAV_GROUPS.map(group => (
    <div role="group" aria-label={group.label} key={group.label}>
      <div className="nav-section"><span>{group.label}</span></div>
      {group.items.map(({kind, label, Icon}) => item(kind, label, Icon, after))}
    </div>
  ));

  return (
    <>
      <nav className="sidebar">
        <div className="brand"><Mark /><span>Lifedash</span></div>
        {props.onCapture && <button className="sidebar-capture btn-secondary" aria-label="Capture task" onClick={props.onCapture}><Plus size={16} aria-hidden="true" />Capture task <kbd>n</kbd></button>}
        {searchBox}
        {navigation()}
        {projectsBlock}
        {footer}
      </nav>

      <div className="mobile-topbar">
        <div className="brand"><Mark /><span>Lifedash</span></div>
        <div className="mobile-topbar-actions">
          {props.onCapture && <button className="icon-btn" title="Capture task (n)" aria-label="Capture task" onClick={props.onCapture}><Plus size={20} aria-hidden="true" /></button>}
          {props.onPalette && (
            <button className="icon-btn" title="Search (Ctrl+K)" aria-label="Search tasks, notes and journal" onClick={props.onPalette}>
              <Search size={18} strokeWidth={1.75} />
            </button>
          )}
          <button className="icon-btn" title="Appearance" aria-label="Appearance" onClick={props.onAppearance}>
            <ThemeIcon size={18} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="bottombar">
        {DOCK_ITEMS.map(({ kind, label, Icon }) => (
          <button
            key={kind}
            className={props.selection.kind === kind ? 'active' : ''}
            onClick={() => props.onSelect({ kind } as Selection)}
          >
            <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
            <span>{label}</span>
            {countFor(kind) > 0 && <span className="dock-count num">{countFor(kind)}</span>}
          </button>
        ))}
        <button ref={moreButton} className={sheet ? 'active' : ''} onClick={() => setSheet(!sheet)} aria-label="More" aria-expanded={sheet}>
          <Menu size={20} strokeWidth={1.75} aria-hidden="true" />
          <span>More</span>
        </button>
      </div>

      {sheet && (
        <div ref={sheetPanel} className="mobile-sheet" role="dialog" aria-modal="true" aria-label="More navigation">
          <div className="sheet-head">
            <div className="brand"><Mark /><span>Lifedash</span></div>
            <button className="icon-btn" aria-label="Close menu" onClick={() => setSheet(false)}>
              <X size={20} strokeWidth={1.75} />
            </button>
          </div>
          {props.onCapture && <button className="sidebar-capture btn-secondary" aria-label="Capture task" onClick={props.onCapture}><Plus size={16} aria-hidden="true" />Capture task <kbd>n</kbd></button>}
        {searchBox}
          {navigation(() => setSheet(false))}
          {projectsBlock}
          {footer}
        </div>
      )}
    </>
  );
}
