import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sun, CalendarDays, Archive, Clock, CalendarRange, Repeat, CheckCircle2,
  Search, Plus, Moon, Check, Pin, Home, Target, StickyNote, BookOpen, Calendar,
} from 'lucide-react';
import type { JournalEntry, Note, Task } from '../types';
import type { Selection } from './Sidebar';

type Action = {
  id: string;
  label: string;
  hint?: string;
  Icon: typeof Sun;
  run: () => void;
};

export default function CommandPalette(props: {
  open: boolean;
  tasks: Task[];
  notes: Note[];
  journal: JournalEntry[];
  onClose: () => void;
  onSelect: (s: Selection) => void;
  onOpenTask: (id: string) => void;
  onNewTask: () => void;
  onToggleTheme: () => void;
  onAppearance: () => void;
  onShortcuts: () => void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (props.open) {
      setQuery('');
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [props.open]);

  const actions: Action[] = useMemo(() => {
    const nav = (kind: Selection['kind'], label: string, Icon: typeof Sun): Action => ({
      id: `nav-${kind}`, label: `Go to ${label}`, Icon,
      run: () => { props.onSelect({ kind } as Selection); props.onClose(); },
    });
    const base: Action[] = [
      { id: 'new', label: 'New task', hint: 'n', Icon: Plus, run: () => { props.onNewTask(); props.onClose(); } },
      nav('home', 'Home', Home),
      nav('today', 'Today', Sun),
      nav('upcoming', 'Upcoming', CalendarDays),
      nav('backlog', 'Backlog', Archive),
      nav('planner', 'Planner', Clock),
      nav('week', 'Week', CalendarRange),
      nav('calendar', 'Calendar', Calendar),
      nav('habits', 'Habits', Repeat),
      nav('goals', 'Goals', Target),
      nav('notes', 'Notes', StickyNote),
      nav('journal', 'Journal', BookOpen),
      nav('completed', 'Completed', CheckCircle2),
      { id: 'appearance', label: 'Appearance: choose style', Icon: Moon, run: () => { props.onAppearance(); props.onClose(); } },
      { id: 'shortcuts', label: 'Keyboard shortcuts', hint: '?', Icon: BookOpen, run: () => { props.onShortcuts(); props.onClose(); } },
      { id: 'theme', label: 'Toggle light/dark', Icon: Moon, run: () => { props.onToggleTheme(); props.onClose(); } },
    ];
    const q = query.trim().toLowerCase();
    if (!q) return base;
    const taskActions: Action[] = props.tasks
      .filter((t) => t.status !== 'done' && t.title.toLowerCase().includes(q))
      .slice(0, 6)
      .map((t) => ({
        id: `task-${t.id}`, label: t.title, hint: 'task', Icon: Search,
        run: () => { props.onOpenTask(t.id); props.onClose(); },
      }));
    const noteActions: Action[] = props.notes
      .filter((n) => (n.title + ' ' + n.note).toLowerCase().includes(q))
      .slice(0, 4)
      .map((n) => ({
        id: `note-${n.id}`, label: n.title || 'Untitled note', hint: 'note', Icon: StickyNote,
        run: () => { props.onSelect({ kind: 'notes', openId: n.id } as Selection); props.onClose(); },
      }));
    const journalActions: Action[] = props.journal
      .filter((j) => j.note.toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 3)
      .map((j) => ({
        id: `journal-${j.id}`, label: j.note.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Journal entry', hint: j.date, Icon: BookOpen,
        run: () => { props.onSelect({ kind: 'journal', date: j.date } as Selection); props.onClose(); },
      }));
    return [
      ...taskActions,
      ...noteActions,
      ...journalActions,
      ...base.filter((a) => a.label.toLowerCase().includes(q)),
      { id: 'search', label: `Search for "${query.trim()}"`, Icon: Search,
        run: () => { props.onSelect({ kind: 'search', query: query.trim() }); props.onClose(); } },
    ];
  }, [query, props]);

  useEffect(() => setIndex(0), [query]);

  if (!props.open) return null;

  return (
    <div className="palette-overlay" onClick={props.onClose}>
      <div className="palette" role="dialog" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-wrap">
          <Search size={15} strokeWidth={1.75} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            placeholder="Type a command or search tasks, notes, journal"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') props.onClose();
              if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, actions.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
              if (e.key === 'Enter' && actions[index]) actions[index].run();
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list">
          {actions.length === 0 && <div className="palette-empty">No matches.</div>}
          {actions.map((a, i) => (
            <button
              key={a.id}
              className={`palette-item ${i === index ? 'active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => a.run()}
            >
              <a.Icon size={15} strokeWidth={1.75} aria-hidden="true" />
              <span>{a.label}</span>
              {a.hint && <kbd>{a.hint}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function useGlobalKeys(handlers: {
  onPalette: () => void;
  onNewTask: () => void;
  onSelect: (s: Selection) => void;
  onHelp?: () => void;
}) {
  useEffect(() => {
    const views: Record<string, Selection['kind']> = {
      t: 'today', u: 'upcoming', b: 'backlog', p: 'planner', w: 'week', h: 'habits', c: 'completed',
    };
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        handlers.onPalette();
        return;
      }
      if (typing) return;
      if (e.key === '?') { e.preventDefault(); handlers.onHelp?.(); return; }
      if (e.key === 'n') { e.preventDefault(); handlers.onNewTask(); return; }
      const kind = views[e.key.toLowerCase()];
      if (kind && !e.ctrlKey && !e.metaKey && !e.altKey) handlers.onSelect({ kind } as Selection);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers]);
}
