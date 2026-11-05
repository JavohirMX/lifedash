import { useDialogFocus } from '../hooks/useDialogFocus';
import { useEffect, useRef, useState } from 'react';
import { Settings, CalendarClock,
  Sun, CalendarDays, Archive, Clock, CalendarRange, Repeat, CheckCircle2,
  Search, Plus, Menu, X, Palette, Zap, House, Target, StickyNote, BookOpen, Monitor,
  PanelLeftClose, PanelLeft, Sparkles, ChevronDown, ChevronRight,
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
  onScheduleBacklog?: (taskId: string) => void;
  onMoveToProject?: (taskId: string, projectId: string) => void;
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
  tvEnabled?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('lifedash-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const [width, setWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('lifedash-sidebar-width');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 200 && parsed <= 360) return parsed;
      }
    } catch {
      /* storage blocked */
    }
    return 244;
  });

  const isResizing = useRef(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  const startResizing = (e: React.MouseEvent) => {
    if (collapsed) return;
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.min(360, Math.max(200, moveEvent.clientX));
      widthRef.current = newWidth;
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      if (!isResizing.current) return;
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      try {
        localStorage.setItem('lifedash-sidebar-width', String(widthRef.current));
      } catch {
        /* storage blocked */
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const resetWidth = () => {
    setWidth(244);
    try {
      localStorage.removeItem('lifedash-sidebar-width');
    } catch {
      /* storage blocked */
    }
  };

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('lifedash-sidebar-collapsed-sections');
      if (raw) return new Set(JSON.parse(raw));
    } catch {}
    return new Set();
  });

  const toggleSection = (label: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      try {
        localStorage.setItem('lifedash-sidebar-collapsed-sections', JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };

  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('lifedash-sidebar-collapsed-projects');
      if (raw) return new Set(JSON.parse(raw));
    } catch {}
    return new Set();
  });

  const toggleProjectCollapsed = (projectId: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      try {
        localStorage.setItem('lifedash-sidebar-collapsed-projects', JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };

  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  const [activeTooltip, setActiveTooltip] = useState<{
    label: string;
    shortcut?: string;
    count?: number;
    top: number;
  } | null>(null);

  const showTooltip = (
    e: React.MouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>,
    label: string,
    shortcut?: string,
    count?: number,
  ) => {
    if (!collapsed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setActiveTooltip({
      label,
      shortcut,
      count,
      top: rect.top + rect.height / 2,
    });
  };

  const hideTooltip = () => {
    setActiveTooltip(null);
  };

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
    setActiveTooltip(null);
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

  const item = (kind: Selection['kind'], label: string, Icon: typeof Sun, after?: () => void, shortcut?: string) => {
    const isSelected = props.selection.kind === kind;
    const count = countFor(kind);
    const isDropTarget = dragOverTarget === kind;

    const handleDragOver = (e: React.DragEvent) => {
      if ((kind === 'today' && props.onScheduleToday) || (kind === 'backlog' && props.onScheduleBacklog)) {
        if (e.dataTransfer.types.includes('application/x-lifedash-task')) {
          e.preventDefault();
          setDragOverTarget(kind);
        }
      }
    };

    const handleDragLeave = () => {
      if (dragOverTarget === kind) setDragOverTarget(null);
    };

    const handleDrop = (e: React.DragEvent) => {
      if (dragOverTarget === kind) setDragOverTarget(null);
      const id = e.dataTransfer.getData('application/x-lifedash-task');
      if (!id) return;
      if (kind === 'today' && props.onScheduleToday) {
        e.preventDefault();
        props.onScheduleToday(id);
      } else if (kind === 'backlog' && props.onScheduleBacklog) {
        e.preventDefault();
        props.onScheduleBacklog(id);
      }
    };

    return (
      <button
        key={kind}
        className={`nav ${isSelected ? 'active' : ''} ${isDropTarget ? 'drop-target-active' : ''}`}
        title={label}
        aria-label={label}
        aria-current={isSelected ? 'page' : undefined}
        onClick={() => {
          props.onSelect({ kind } as Selection);
          after?.();
        }}
        onMouseEnter={(e) => showTooltip(e, label, shortcut, count)}
        onMouseLeave={hideTooltip}
        onFocus={(e) => showTooltip(e, label, shortcut, count)}
        onBlur={hideTooltip}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>{label}</span>
        {count > 0 && <span className="count num">{count}</span>}
      </button>
    );
  };

  const handleClearSearch = () => {
    setQuery('');
    props.onSelect(prevSelection.current ?? { kind: 'today' });
  };

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const shortcutLabel = isMac ? '⌘K' : 'Ctrl+K';

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
      {query.length > 0 ? (
        <button
          type="button"
          className="search-clear-btn"
          aria-label="Clear search"
          onClick={handleClearSearch}
        >
          <X size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      ) : props.onPalette ? (
        <button
          type="button"
          className="search-shortcut-badge"
          title={`Command palette (${shortcutLabel})`}
          aria-label={`Command palette (${shortcutLabel})`}
          onClick={props.onPalette}
        >
          <kbd>{shortcutLabel}</kbd>
        </button>
      ) : null}
    </div>
  );

  const isProjectHidden = (p: Project) => {
    let parentId = p.parentId;
    while (parentId) {
      if (collapsedProjects.has(parentId)) return true;
      const parent = props.projects.find((proj) => proj.id === parentId);
      parentId = parent ? parent.parentId ?? null : null;
    }
    return false;
  };

  const hasChildren = (id: string) => props.projects.some((p) => p.parentId === id);

  const projectsBlock = (
    <>
      <div className="nav-section">
        <button
          type="button"
          className="nav-section-title-btn"
          aria-expanded={!collapsedSections.has('Projects')}
          onClick={() => toggleSection('Projects')}
        >
          <span>Projects</span>
          <ChevronDown
            size={12}
            className={`nav-section-chevron ${collapsedSections.has('Projects') ? 'collapsed' : ''}`}
            aria-hidden="true"
          />
        </button>
        <button
          className="icon-btn"
          title="New project"
          aria-label="New project"
          disabled={projectBusy}
          onClick={() => {
            setAddParent(null);
            setAdding(true);
            setProjectError('');
          }}
        >
          <Plus size={14} strokeWidth={1.75} />
        </button>
      </div>
      {!collapsedSections.has('Projects') && (
        <>
          {projectTree(props.projects)
            .filter(({ project: p }) => !isProjectHidden(p))
            .map(({ project: p, depth }) => {
              const isSelected = props.selection.kind === 'project' && props.selection.id === p.id;
              const isDropTarget = dragOverTarget === p.id;
              const projectCount = props.activeByProject?.[p.id] ?? 0;
              const hasKids = hasChildren(p.id);
              const isBranchCollapsed = collapsedProjects.has(p.id);

              return (
                <div
                  key={p.id}
                  className={`project-row-wrap ${depth > 0 ? 'nested' : ''}`}
                  style={depth > 0 ? ({ '--depth': depth } as React.CSSProperties) : undefined}
                >
                  <button
                    className={`nav project ${isSelected ? 'active' : ''} ${isDropTarget ? 'drop-target-active' : ''}`}
                    style={depth > 0 ? { paddingLeft: 8 + depth * 16 } : undefined}
                    title={p.name}
                    aria-label={`Project: ${p.name}`}
                    aria-current={isSelected ? 'page' : undefined}
                    onClick={() => {
                      props.onSelect({ kind: 'project', id: p.id });
                      setSheet(false);
                    }}
                    onMouseEnter={(e) => showTooltip(e, p.name, undefined, projectCount)}
                    onMouseLeave={hideTooltip}
                    onFocus={(e) => showTooltip(e, p.name, undefined, projectCount)}
                    onBlur={hideTooltip}
                    onDragOver={
                      props.onMoveToProject
                        ? (e) => {
                            if (e.dataTransfer.types.includes('application/x-lifedash-task')) {
                              e.preventDefault();
                              setDragOverTarget(p.id);
                            }
                          }
                        : undefined
                    }
                    onDragLeave={() => {
                      if (dragOverTarget === p.id) setDragOverTarget(null);
                    }}
                    onDrop={
                      props.onMoveToProject
                        ? (e) => {
                            setDragOverTarget(null);
                            const taskId = e.dataTransfer.getData('application/x-lifedash-task');
                            if (taskId) {
                              e.preventDefault();
                              props.onMoveToProject!(taskId, p.id);
                            }
                          }
                        : undefined
                    }
                  >
                    {hasKids ? (
                      <span
                        role="button"
                        tabIndex={0}
                        className="project-tree-toggle"
                        aria-label={isBranchCollapsed ? `Expand subprojects of ${p.name}` : `Collapse subprojects of ${p.name}`}
                        title={isBranchCollapsed ? 'Expand subprojects' : 'Collapse subprojects'}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleProjectCollapsed(p.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleProjectCollapsed(p.id);
                          }
                        }}
                      >
                        <ChevronRight
                          size={12}
                          className={`project-tree-chevron ${!isBranchCollapsed ? 'open' : ''}`}
                        />
                      </span>
                    ) : (
                      <span className="dot" style={{ background: p.color }} />
                    )}
                    {hasKids && <span className="dot" style={{ background: p.color, marginLeft: 2 }} />}
                    <span className="project-name">{p.name}</span>
                    {projectCount > 0 && (
                      <span className="proj-count num" title="Direct active tasks">
                        {projectCount}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="project-row-add-btn"
                    title={`Add subproject inside ${p.name}`}
                    aria-label={`Add subproject inside ${p.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setAddParent(p.id);
                      setAdding(true);
                      setProjectError('');
                    }}
                  >
                    <Plus size={12} strokeWidth={2} />
                  </button>
                </div>
              );
            })}
          {adding && (
            <div className="project-add">
              <input
                autoFocus
                value={name}
                placeholder="Project name"
                aria-label="New project name"
                disabled={projectBusy}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) void createProject();
                  if (e.key === 'Escape' && !e.nativeEvent.isComposing) setAdding(false);
                }}
              />
              <select
                className="project-add-parent"
                disabled={projectBusy}
                value={addParent ?? ''}
                onChange={(e) => setAddParent(e.target.value || null)}
                aria-label="Parent project"
              >
                <option value="">Top level</option>
                {projectTree(props.projects).map(({ project: p, depth }) => (
                  <option key={p.id} value={p.id}>
                    {' '.repeat(depth)}
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                className="mini"
                disabled={projectBusy || !name.trim()}
                onClick={() => void createProject()}
              >
                Add project
              </button>
              <button className="mini" disabled={projectBusy} onClick={() => setAdding(false)}>
                Cancel
              </button>
              {projectBusy && (
                <p className="project-save-feedback" role="status">
                  Saving project…
                </p>
              )}
              {projectError && (
                <p className="project-save-feedback" role="alert">
                  {projectError}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </>
  );

  const tvBtn = (
    <button
      className="nav foot-action"
      title="TV dashboard"
      aria-label="TV dashboard"
      onClick={() => { window.location.hash = '/tv'; }}
      onMouseEnter={(e) => showTooltip(e, 'TV dashboard')}
      onMouseLeave={hideTooltip}
      onFocus={(e) => showTooltip(e, 'TV dashboard')}
      onBlur={hideTooltip}
    >
      <Monitor size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>TV dashboard</span>
    </button>
  );

  const footer = (
    <div className="sidebar-foot" role="group" aria-label="Tools">
      <div className="nav-section"><span>Tools</span></div>
      {props.onAI && (
        <button
          className="nav foot-action"
          title="Plan with AI"
          aria-label="Plan with AI"
          onClick={() => { openTool(() => props.onAI?.()); }}
          onMouseEnter={(e) => showTooltip(e, 'Plan with AI')}
          onMouseLeave={hideTooltip}
          onFocus={(e) => showTooltip(e, 'Plan with AI')}
          onBlur={hideTooltip}
        >
          <Sparkles size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>Plan with AI</span>
        </button>
      )}
      <button
        className="nav foot-action"
        title="Automation"
        aria-label="Automation"
        onClick={() => { openTool(props.onAutomation); }}
        onMouseEnter={(e) => showTooltip(e, 'Automation')}
        onMouseLeave={hideTooltip}
        onFocus={(e) => showTooltip(e, 'Automation')}
        onBlur={hideTooltip}
      >
        <Zap size={16} aria-hidden="true" />
        <span>Automation</span>
      </button>
      {props.tvEnabled && tvBtn}
      <button
        className="nav foot-action"
        title="Settings"
        aria-label="Settings"
        aria-current={props.selection.kind === 'settings' ? 'page' : undefined}
        onClick={() => { openTool(props.onSettings); }}
        onMouseEnter={(e) => showTooltip(e, 'Settings')}
        onMouseLeave={hideTooltip}
        onFocus={(e) => showTooltip(e, 'Settings')}
        onBlur={hideTooltip}
      >
        <Settings size={16} aria-hidden="true" />
        <span>Settings</span>
      </button>
    </div>
  );

  const navigation = (after?: () => void) =>
    NAV_GROUPS.map((group) => {
      const isCollapsible = group.label !== 'Start';
      const isCollapsed = isCollapsible && collapsedSections.has(group.label);

      return (
        <div role="group" aria-label={group.label} key={group.label}>
          <div className="nav-section">
            {isCollapsible ? (
              <button
                type="button"
                className="nav-section-title-btn"
                aria-expanded={!isCollapsed}
                onClick={() => toggleSection(group.label)}
              >
                <span>{group.label}</span>
                <ChevronDown
                  size={12}
                  className={`nav-section-chevron ${isCollapsed ? 'collapsed' : ''}`}
                  aria-hidden="true"
                />
              </button>
            ) : (
              <span>{group.label}</span>
            )}
          </div>
          {!isCollapsed &&
            group.items.map(({ kind, label, Icon }) => {
              const shortcut = kind === 'today' ? 't' : undefined;
              return item(kind, label, Icon, after, shortcut);
            })}
        </div>
      );
    });

  const handleSidebarKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const navButtons = Array.from(
        e.currentTarget.querySelectorAll<HTMLButtonElement>('button.nav:not([disabled])')
      );
      const activeIndex = navButtons.indexOf(document.activeElement as HTMLButtonElement);
      if (activeIndex !== -1) {
        e.preventDefault();
        const nextIndex =
          e.key === 'ArrowDown'
            ? (activeIndex + 1) % navButtons.length
            : (activeIndex - 1 + navButtons.length) % navButtons.length;
        navButtons[nextIndex]?.focus();
      }
    }
  };

  return (
    <>
      <nav
        className={`sidebar ${collapsed ? 'collapsed' : ''}`}
        style={!collapsed ? { width: `${width}px` } : undefined}
        aria-label="Main sidebar"
        onKeyDown={handleSidebarKeyDown}
      >
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
              onMouseEnter={(e) => showTooltip(e, collapsed ? 'Expand sidebar' : 'Collapse sidebar', '[')}
              onMouseLeave={hideTooltip}
              onFocus={(e) => showTooltip(e, collapsed ? 'Expand sidebar' : 'Collapse sidebar', '[')}
              onBlur={hideTooltip}
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
                onMouseEnter={(e) => showTooltip(e, 'Capture task', 'n')}
                onMouseLeave={hideTooltip}
                onFocus={(e) => showTooltip(e, 'Capture task', 'n')}
                onBlur={hideTooltip}
              >
                <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
              </button>
            ) : (
              <button className="sidebar-capture btn-primary" aria-label="Capture task" onClick={props.onCapture}>
                <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
                <span>Capture task</span>
                <kbd className="sidebar-capture-kbd">n</kbd>
              </button>
            )
          )}
          {collapsed ? (
            props.onPalette && (
              <button
                className="icon-btn sidebar-search-collapsed"
                title={`Search tasks, notes and journal (${shortcutLabel})`}
                aria-label="Search"
                onClick={props.onPalette}
                onMouseEnter={(e) => showTooltip(e, 'Search palette', shortcutLabel)}
                onMouseLeave={hideTooltip}
                onFocus={(e) => showTooltip(e, 'Search palette', shortcutLabel)}
                onBlur={hideTooltip}
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
              {projectTree(props.projects).slice(0, 8).map(({ project: p }) => (
                <button
                  key={p.id}
                  className={`nav-proj-dot ${props.selection.kind === 'project' && props.selection.id === p.id ? 'active' : ''}`}
                  title={`Project: ${p.name}`}
                  aria-label={`Project: ${p.name}`}
                  aria-current={props.selection.kind === 'project' && props.selection.id === p.id ? 'page' : undefined}
                  onClick={() => props.onSelect({ kind: 'project', id: p.id })}
                  onMouseEnter={(e) => showTooltip(e, p.name, undefined, props.activeByProject?.[p.id])}
                  onMouseLeave={hideTooltip}
                  onFocus={(e) => showTooltip(e, p.name, undefined, props.activeByProject?.[p.id])}
                  onBlur={hideTooltip}
                >
                  <span className="dot" style={{ background: p.color, margin: 0 }} />
                </button>
              ))}
              {props.projects.length > 8 && (
                <button
                  type="button"
                  className="nav-proj-more"
                  title={`+${props.projects.length - 8} more projects (press [ to expand)`}
                  aria-label={`+${props.projects.length - 8} more projects`}
                  onClick={toggleCollapsed}
                  onMouseEnter={(e) => showTooltip(e, `+${props.projects.length - 8} more projects`, '[')}
                  onMouseLeave={hideTooltip}
                  onFocus={(e) => showTooltip(e, `+${props.projects.length - 8} more projects`, '[')}
                  onBlur={hideTooltip}
                >
                  +{props.projects.length - 8}
                </button>
              )}
            </div>
          ) : (
            projectsBlock
          )}
        </div>
        {footer}

        {!collapsed && (
          <div
            className="sidebar-resizer"
            title="Drag to resize sidebar, double-click to reset"
            onMouseDown={startResizing}
            onDoubleClick={resetWidth}
            role="separator"
            aria-orientation="vertical"
          />
        )}
      </nav>

      {collapsed && activeTooltip && (
        <div
          className="sidebar-floating-tooltip"
          style={{ top: `${activeTooltip.top}px` }}
          role="tooltip"
        >
          <span className="tooltip-label">{activeTooltip.label}</span>
          {typeof activeTooltip.count === 'number' && activeTooltip.count > 0 && (
            <span className="tooltip-count num">{activeTooltip.count}</span>
          )}
          {activeTooltip.shortcut && (
            <kbd className="tooltip-kbd">{activeTooltip.shortcut}</kbd>
          )}
        </div>
      )}

      <div className="mobile-topbar">
        <button
          className="brand mobile-brand-btn"
          aria-label="Lifedash Home"
          onClick={() => props.onSelect({ kind: 'home' })}
        >
          <Mark />
          <span>Lifedash</span>
        </button>
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
          <div className="sheet-handle" aria-hidden="true" />
          <div className="sheet-head">
            <button
              className="brand mobile-brand-btn"
              aria-label="Lifedash Home"
              onClick={() => { props.onSelect({ kind: 'home' }); setSheet(false); }}
            >
              <Mark />
              <span>Lifedash</span>
            </button>
            <button className="icon-btn" aria-label="Close menu" onClick={() => setSheet(false)}>
              <X size={20} strokeWidth={1.75} />
            </button>
          </div>
          {props.onCapture && (
            <button className="sidebar-capture btn-primary" aria-label="Capture task" onClick={props.onCapture}>
              <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
              <span>Capture task</span>
              <kbd className="sidebar-capture-kbd">n</kbd>
            </button>
          )}
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
