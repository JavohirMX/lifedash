import { useEffect, useState } from 'react';
import { Bell, BellRing,
  Sun, CalendarDays, Archive, Clock, CalendarRange, Repeat, CheckCircle2,
  Search, Plus, Menu, X, Download, Upload, Moon, Monitor, Zap, Cloud, House, Target, StickyNote, BookOpen,
} from 'lucide-react';
import type { Project } from '../types';
import { addProject, exportJson, importBackup } from '../repo';
import { cycleTheme, getTheme, type Theme } from '../theme';

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

const MAIN_ITEMS = [
  { kind: 'home', label: 'Home', Icon: House },
  { kind: 'today', label: 'Today', Icon: Sun },
  { kind: 'upcoming', label: 'Upcoming', Icon: CalendarDays },
  { kind: 'backlog', label: 'Backlog', Icon: Archive },
  { kind: 'planner', label: 'Planner', Icon: Clock },
  { kind: 'week', label: 'Week', Icon: CalendarRange },
  { kind: 'habits', label: 'Habits', Icon: Repeat },
  { kind: 'goals', label: 'Goals', Icon: Target },
  { kind: 'notes', label: 'Notes', Icon: StickyNote },
  { kind: 'journal', label: 'Journal', Icon: BookOpen },
  { kind: 'calendar', label: 'Calendar', Icon: CalendarDays },
  { kind: 'completed', label: 'Completed', Icon: CheckCircle2 },
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
  onAutomation: () => void;
  onSync: () => void;
  onAI?: () => void;
  reminders: 'on' | 'off' | 'blocked' | 'unsupported';
  onToggleReminders: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  // Keep the box in step with external query changes (filter chips, Esc).
  useEffect(() => {
    setQuery(props.selection.kind === 'search' ? props.selection.query : '');
  }, [props.selection]);
  const [sheet, setSheet] = useState(false);
  const [theme, setTheme] = useState<Theme>(getTheme());

  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

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
          if (e.target.value.trim()) props.onSelect({ kind: 'search', query: e.target.value });
          else props.onSelect({ kind: 'today' });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setQuery('');
            props.onSelect({ kind: 'today' });
          }
        }}
      />
    </div>
  );

  const projectsBlock = (
    <>
      <div className="nav-section">
        <span>Projects</span>
        <button className="icon-btn" title="New project" aria-label="New project" onClick={() => setAdding(true)}>
          <Plus size={14} strokeWidth={1.75} />
        </button>
      </div>
      {props.projects.map((p) => (
        <button
          key={p.id}
          className={`nav project ${props.selection.kind === 'project' && props.selection.id === p.id ? 'active' : ''}`}
          onClick={() => {
            props.onSelect({ kind: 'project', id: p.id });
            setSheet(false);
          }}
        >
          <span className="dot" style={{ background: p.color }} />
          <span>{p.name}</span>
          {(props.activeByProject?.[p.id] ?? 0) > 0 && (
            <span className="proj-count num">{props.activeByProject![p.id]}</span>
          )}
        </button>
      ))}
      {adding && (
        <div className="project-add">
          <input
            autoFocus
            value={name}
            placeholder="Project name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) {
                void addProject(name, COLORS[props.projects.length % COLORS.length]);
                setName('');
                setAdding(false);
              }
              if (e.key === 'Escape') setAdding(false);
            }}
          />
        </div>
      )}
    </>
  );

  const exportBtn = (
    <button
      className="nav foot-action"
      onClick={() => {
        void exportJson().then((json) => {
          const blob = new Blob([json], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `lifedash-export-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(a.href);
        });
      }}
    >
      <Download size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>Export JSON</span>
    </button>
  );

  const restoreBtn = (
    <button
      className="nav foot-action"
      onClick={() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) return;
          void file.text().then(async (text) => {
            try {
              const { restored } = await importBackup(text);
              const total = Object.values(restored).reduce((a, b) => a + b, 0);
              window.alert(`Backup restored: ${total} records merged.`);
            } catch {
              window.alert('That file is not a valid Lifedash backup.');
            }
          });
        };
        input.click();
      }}
    >
      <Upload size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>Restore backup</span>
    </button>
  );

  const importBtn = (
    <>
      <button className="nav foot-action" onClick={props.onSync}>
        <Cloud size={16} strokeWidth={1.75} aria-hidden="true" />
        Sync
      </button>
      <button className="nav foot-action" onClick={props.onAutomation}>
        <Zap size={16} strokeWidth={1.75} aria-hidden="true" />
        Automation
      </button>
      <button className="nav foot-action" onClick={props.onImport}>
        <Upload size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>Import</span>
      </button>
    </>
  );

  const remindersBtn = (
    <button
      className="nav foot-action"
      title={
        props.reminders === 'on'
          ? 'Reminders on: tasks with a time notify while Lifedash is open (click to turn off)'
          : props.reminders === 'blocked'
            ? 'Notifications are blocked in browser settings'
            : props.reminders === 'unsupported'
              ? 'This browser does not support notifications'
              : 'Reminders off: tasks with a time can notify while Lifedash is open (click to turn on)'
      }
      aria-pressed={props.reminders === 'on'}
      disabled={props.reminders === 'blocked' || props.reminders === 'unsupported'}
      onClick={props.onToggleReminders}
    >
      {props.reminders === 'on'
        ? <BellRing size={16} strokeWidth={1.75} aria-hidden="true" />
        : <Bell size={16} strokeWidth={1.75} aria-hidden="true" />}
      <span>Reminders: {props.reminders}</span>
    </button>
  );

  const themeBtn = (
    <button
      className="nav foot-action"
      title={`Theme: ${theme} (click to change)`}
      onClick={() => setTheme(cycleTheme())}
    >
      <ThemeIcon size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>Theme: {theme}</span>
    </button>
  );

  return (
    <>
      <nav className="sidebar">
        <div className="brand"><Mark /><span>Lifedash</span></div>
        {searchBox}
        {MAIN_ITEMS.map(({ kind, label, Icon }) => item(kind, label, Icon))}
        {projectsBlock}
        <div className="sidebar-foot">{props.onAI && <button className="nav foot-action" onClick={() => { setSheet(false); props.onAI?.(); }}>Plan with AI</button>}{importBtn}{remindersBtn}{themeBtn}{exportBtn}{restoreBtn}</div>
      </nav>

      <div className="mobile-topbar">
        <div className="brand"><Mark /><span>Lifedash</span></div>
        <button className="icon-btn" title={`Theme: ${theme}`} aria-label="Change theme" onClick={() => setTheme(cycleTheme())}>
          <ThemeIcon size={18} strokeWidth={1.75} />
        </button>
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
        <button className={sheet ? 'active' : ''} onClick={() => setSheet(!sheet)} aria-label="More">
          <Menu size={20} strokeWidth={1.75} aria-hidden="true" />
          <span>More</span>
        </button>
      </div>

      {sheet && (
        <div className="mobile-sheet">
          <div className="sheet-head">
            <div className="brand"><Mark /><span>Lifedash</span></div>
            <button className="icon-btn" aria-label="Close menu" onClick={() => setSheet(false)}>
              <X size={20} strokeWidth={1.75} />
            </button>
          </div>
          {searchBox}
          {MAIN_ITEMS.map(({ kind, label, Icon }) => item(kind, label, Icon, () => setSheet(false)))}
          {projectsBlock}
          <div className="sidebar-foot">{props.onAI && <button className="nav foot-action" onClick={() => { setSheet(false); props.onAI?.(); }}>Plan with AI</button>}{importBtn}{remindersBtn}{themeBtn}{exportBtn}{restoreBtn}</div>
        </div>
      )}
    </>
  );
}
