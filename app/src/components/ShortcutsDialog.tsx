import { useDialogFocus } from '../hooks/useDialogFocus';

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'General',
    rows: [
      ['Ctrl/⌘ K', 'Command palette: search tasks, notes and journal'],
      ['n', 'New task (opens capture without leaving this view)'],
      ['Shift+F', 'Focus & Pomodoro timer'],
      ['?', 'This help'],
      ['Esc', 'Close the open dialog or task panel'],
    ],
  },
  {
    title: 'Go to',
    rows: [
      ['m', 'Home'],
      ['t', 'Today'],
      ['u', 'Upcoming'],
      ['b', 'Backlog'],
      ['p', 'Planner'],
      ['w', 'Week'],
      ['l', 'Calendar'],
      ['h', 'Habits'],
      ['g', 'Goals'],
      ['o', 'Notes'],
      ['j', 'Journal'],
      ['c', 'Completed'],
    ],
  },
  {
    title: 'In the palette',
    rows: [
      ['↑ ↓', 'Move through results'],
      ['Enter', 'Open the highlighted result'],
    ],
  },
];

export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const panel = useDialogFocus<HTMLDivElement>(onClose, 'button');
  return (
    <div className="palette-overlay" onClick={onClose}>
      <div ref={panel} className="import-panel shortcuts-panel" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="import-head">
          <h2>Keyboard shortcuts</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <p className="rule-note">Shortcuts pause while you type in a field. On touch devices everything here is also reachable from the search button and menus.</p>
        {GROUPS.map((g) => (
          <section key={g.title} className="shortcut-group">
            <h3>{g.title}</h3>
            {g.rows.map(([key, what]) => (
              <div key={key} className="shortcut-row">
                <kbd>{key}</kbd>
                <span>{what}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
