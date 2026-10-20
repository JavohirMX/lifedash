import { useState } from 'react';
import type { Project } from '../types';
import { addProject, exportJson } from '../repo';
import { INBOX_ID } from '../db';

export type Selection =
  | { kind: 'today' | 'upcoming' | 'backlog' | 'completed' }
  | { kind: 'project'; id: string }
  | { kind: 'search'; query: string };

const COLORS = ['#6366f1', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#38bdf8'];

export default function Sidebar(props: {
  projects: Project[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  counts: { today: number; backlog: number };
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');

  const item = (kind: Selection['kind'], label: string, count?: number) => (
    <button
      className={`nav ${props.selection.kind === kind ? 'active' : ''}`}
      onClick={() => props.onSelect({ kind } as Selection)}
    >
      <span>{label}</span>
      {count !== undefined && count > 0 && <span className="count">{count}</span>}
    </button>
  );

  return (
    <nav className="sidebar">
      <div className="brand">LifeDash</div>
      <input
        className="search-box"
        placeholder="Search tasks, #tags..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.trim()) props.onSelect({ kind: 'search', query: e.target.value });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setQuery('');
            props.onSelect({ kind: 'today' });
          }
        }}
      />
      {item('today', 'Today', props.counts.today)}
      {item('upcoming', 'Upcoming')}
      {item('backlog', 'Backlog', props.counts.backlog)}
      {item('completed', 'Completed')}
      <div className="nav-section">
        <span>Projects</span>
        <button className="mini" title="New project" onClick={() => setAdding(true)}>+</button>
      </div>
      {props.projects.map((p) => (
        <button
          key={p.id}
          className={`nav project ${props.selection.kind === 'project' && props.selection.id === p.id ? 'active' : ''}`}
          onClick={() => props.onSelect({ kind: 'project', id: p.id })}
        >
          <span className="dot" style={{ background: p.color }} />
          <span>{p.name}</span>
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
      <div className="sidebar-foot">
        <button
          className="mini"
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
          Export JSON
        </button>
      </div>
    </nav>
  );
}
