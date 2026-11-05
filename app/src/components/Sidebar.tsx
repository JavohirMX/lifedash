import { useDialogFocus } from '../hooks/useDialogFocus';
import { useEffect, useRef, useState } from 'react';
import { Settings, CalendarClock,
  Sun, CalendarDays, Archive, Clock, CalendarRange, Repeat, CheckCircle2,
  Search, Plus, Menu, X, Palette, Zap, House, Target, StickyNote, BookOpen, Monitor,
  PanelLeftClose, PanelLeft, Sparkles,
} from 'lucide-react';
import { projectTree } from '../projects';
import type { Project } from '../types';
import { addProject } from '../repo';

export type Selection =
  | { kind: 'home' | 'today' | 'upcoming' | 'backlog' | 'completed' | 'habits' | 'planner' | 'week' | 'goals' | 'calendar' | 'settings' }
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
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('lifedash-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('lifedash-sidebar-collapsed', String(next));
      } catch {
        /* storage blocked */
      }
      return next;
    });
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === '[' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const active = document.activeElement;
        const isInput =
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          active instanceof HTMLSelectElement ||
          active?.getAttribute('contenteditable') === 'true';
        if (!isInput) {
          e.preventDefault();
          toggleCollapsed();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
  useEffect(() => {
    if (!sheet) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [sheet]);
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
      title={label}
      aria-label={label}
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

  const handleClearSearch = () => {
    setQuery('');
    props.onSelect(prevSelection.current ?? { kind: 'today' });
  };

  const searchBox = (
    <div className="search-wrap">
      <Search size={14} strokeWidth={1.75} aria-hidden="true" className="search-icon" />
      <input
        className="search-box"
        placeholder="Search tasks, #tags"
        aria-label="Search tasks, #tags"
        value={query}
        enterKeyHint="search"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.trim()) {
            if (props.selection.kind !== 'search') prevSelection.current = props.selection;
            props.onSelect({ kind: 'search', query: e.target.value });
          } else props.onSelect(prevSelection.current ?? { kind: 'today' });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
            handleClearSearch();
          }
        }}
      />
      {query.length > 0 && (
        <button
          type="button"
          className="search-clear-btn"
          aria-label="Clear search"
          onClick={handleClearSearch}
        >
          <X size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
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
          title={p.name}
          aria-label={`Project: ${p.name}`}
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

  const tvBtn = (
    <button className="nav foot-action" title="TV dashboard" aria-label="TV dashboard" onClick={() => { window.location.hash = '/tv'; }}>
      <Monitor size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>TV dashboard</span>
    </button>
  );

  const footer = (
    <div className="sidebar-foot" role="group" aria-label="Tools">
      <div className="nav-section"><span>Tools</span></div>
      {props.onAI && (
        <button className="nav foot-action" title="Plan with AI" aria-label="Plan with AI" onClick={() => { openTool(() => props.onAI?.()); }}>
          <Sparkles size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>Plan with AI</span>
        </button>
      )}
      <button className="nav foot-action" title="Automation" aria-label="Automation" onClick={() => { openTool(props.onAutomation); }}>
        <Zap size={16} aria-hidden="true" />
        <span>Automation</span>
      </button>
      {tvBtn}
      <button className="nav foot-action" title="Settings" aria-label="Settings" aria-current={props.selection.kind === 'settings' ? 'page' : undefined} onClick={() => { openTool(props.onSettings); }}>
        <Settings size={16} aria-hidden="true" />
        <span>Settings</span>
      </button>
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
      <nav className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Main sidebar">
        <div className="sidebar-top">
          <div className="sidebar-brand-row">
            <div className="brand" title="Lifedash">
              <Mark />
              {!collapsed && <span>Lifedash</span>}
            </div>
            <button
              className="icon-btn sidebar-collapse-btn"
              title={collapsed ? 'Expand sidebar ([)' : 'Collapse sidebar ([)'}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              onClick={toggleCollapsed}
            >
              {collapsed ? <PanelLeft size={16} strokeWidth={1.75} /> : <PanelLeftClose size={16} strokeWidth={1.75} />}
            </button>
          </div>
          {props.onCapture && (
            collapsed ? (
              <button
                className="icon-btn sidebar-capture-collapsed"
                title="Capture task (n)"
                aria-label="Capture task"
                onClick={props.onCapture}
              >
                <Plus size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            ) : (
              <button className="sidebar-capture btn-secondary" aria-label="Capture task" onClick={props.onCapture}>
                <Plus size={16} aria-hidden="true" />Capture task <kbd>n</kbd>
              </button>
            )
          )}
          {collapsed ? (
            props.onPalette && (
              <button
                className="icon-btn sidebar-search-collapsed"
                title="Search tasks, notes and journal (Ctrl+K)"
                aria-label="Search"
                onClick={props.onPalette}
              >
                <Search size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            )
          ) : (
            searchBox
          )}
        </div>
        <div className="sidebar-scroll">
          {navigation()}
          {collapsed ? (
            <div className="sidebar-projects-collapsed" role="group" aria-label="Projects">
              {projectTree(props.projects).slice(0, 6).map(({ project: p }) => (
                <button
                  key={p.id}
                  className={`nav-proj-dot ${props.selection.kind === 'project' && props.selection.id === p.id ? 'active' : ''}`}
                  title={`Project: ${p.name}`}
                  aria-label={`Project: ${p.name}`}
                  onClick={() => props.onSelect({ kind: 'project', id: p.id })}
                >
                  <span className="dot" style={{ background: p.color, margin: 0 }} />
                </button>
              ))}
            </div>
          ) : (
            projectsBlock
          )}
        </div>
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
        <>
        <div className="sheet-backdrop" aria-hidden="true" onClick={() => setSheet(false)} />
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
        </>
      )}
    </>
  );
}
