import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, INBOX_ID, ensureSeed } from './db';
import Sidebar, { type Selection } from './components/Sidebar';
import QuickAdd from './components/QuickAdd';
import TaskList, { TASK_DRAG_MIME } from './components/TaskList';
import HabitsView from './views/HabitsView';
import PlannerView from './views/PlannerView';
import WeekView from './views/WeekView';
import HomeView from './views/HomeView';
import GoalsView from './views/GoalsView';
import NotesView from './views/NotesView';
import JournalView from './views/JournalView';
import SearchView from './views/SearchView';
import CalendarView from './views/CalendarView';
import TaskDetail from './components/TaskDetail';
import CommandPalette, { useGlobalKeys } from './components/CommandPalette';
import ImportDialog from './components/ImportDialog';
import AutomationDialog from './components/AutomationDialog';
import SyncDialog from './components/SyncDialog';
import { cycleTheme } from './theme';
import { loadRules, saveRules, type AutomationRules } from './automation';
import { applyRollover } from './repo';
import { startAutoSync } from './sync';
import {
  todayTasks,
  upcomingTasks,
  backlogTasks,
  projectTasks,
  completedTasks,
  searchTasks,
} from './logic';
import { todayStr, friendlyDate, weekdayLabel } from './dates';
import { updateTask, moveTask } from './repo';

export default function App() {
  const tasks = useLiveQuery(() => db.tasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.orderBy('order').toArray(), []);
  const [selection, setSelection] = useState<Selection>({ kind: 'home' });
  const [openId, setOpenId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [rules, setRules] = useState<AutomationRules>(loadRules);
  const quickAddFocus = () => document.querySelector<HTMLInputElement>('.quick-add input')?.focus();
  useGlobalKeys({
    onPalette: () => setPaletteOpen((o) => !o),
    onNewTask: quickAddFocus,
    onSelect: setSelection,
  });

  useEffect(() => {
    void ensureSeed();
    startAutoSync();
    if (loadRules().rollover) void applyRollover(todayStr());
  }, []);

  const today = todayStr();

  const activeByProject = (tasks ?? []).reduce<Record<string, number>>((acc, t) => {
    if (t.status === 'active' && t.parentId === null) acc[t.projectId] = (acc[t.projectId] ?? 0) + 1;
    return acc;
  }, {});

  const counts = useMemo(() => {
    const all = tasks ?? [];
    return {
      today: todayTasks(all, today).length,
      backlog: backlogTasks(all).length,
    };
  }, [tasks, today]);

  if (!tasks || !projects) {
    return <div className="boot">Loading LifeDash...</div>;
  }

  const changeRules = (next: AutomationRules) => {
    setRules(next);
    saveRules(next);
    if (next.rollover && !rules.rollover) void applyRollover(todayStr());
  };

  const quickAddContext = (() => {
    if (selection.kind === 'today') return { projectId: INBOX_ID, dueDate: today };
    if (selection.kind === 'project') return { projectId: selection.id, dueDate: null };
    return { projectId: INBOX_ID, dueDate: null };
  })();
  const showQuickAdd = selection.kind !== 'completed' && selection.kind !== 'search' && selection.kind !== 'habits' && selection.kind !== 'planner' && selection.kind !== 'week' && selection.kind !== 'home' && selection.kind !== 'goals' && selection.kind !== 'notes' && selection.kind !== 'journal' && selection.kind !== 'calendar';

  let body;
  if (selection.kind === 'home') {
    body = <HomeView tasks={tasks} onSelect={(kind) => setSelection({ kind } as Selection)} onOpen={setOpenId} />;
  } else if (selection.kind === 'today') {
    const list = todayTasks(tasks, today);
    body = (
      <section>
        <h1>Today <span className="date-sub">{friendlyDate(today, today)} · {weekdayLabel(today)}</span></h1>
        {counts.backlog > 0 && (
          <button className="nudge" onClick={() => setSelection({ kind: 'backlog' })}>
            {counts.backlog} task{counts.backlog === 1 ? '' : 's'} parked in Backlog
            <span className="nudge-cta">Review</span>
          </button>
        )}
        {list.length === 0 && <p className="empty">Nothing due today. Enjoy, or pull something in from Backlog.</p>}
        <TaskList tasks={list} allTasks={tasks} showDate onOpen={setOpenId}
          onReorder={(dragId, targetId, after) => void moveTask(dragId, targetId, after, list)} />
      </section>
    );
  } else if (selection.kind === 'upcoming') {
    const groups = upcomingTasks(tasks, today);
    body = (
      <section>
        <h1>Upcoming</h1>
        {groups.size === 0 && <p className="empty">Nothing scheduled in the next two weeks.</p>}
        {[...groups.entries()].map(([date, list]) => (
          <div key={date} className="day-group">
            <h2>{friendlyDate(date, today)} <span className="date-sub">{weekdayLabel(date)}</span></h2>
            <TaskList tasks={list} allTasks={tasks} onOpen={setOpenId} />
          </div>
        ))}
      </section>
    );
  } else if (selection.kind === 'backlog') {
    const list = backlogTasks(tasks);
    body = (
      <section>
        <h1>Backlog</h1>
        {list.length === 0 && <p className="empty">Backlog is empty. Quick-add below to park something here.</p>}
        {list.map((t) => (
          <div key={t.id} className="backlog-row">
            <div className="backlog-task"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(TASK_DRAG_MIME, t.id);
                e.dataTransfer.effectAllowed = 'move';
              }}>
              <TaskList tasks={[t]} allTasks={tasks} onOpen={setOpenId} />
            </div>
            <button className="mini" onClick={() => void updateTask(t.id, { dueDate: today })}>
              <ArrowRight size={12} strokeWidth={1.75} aria-hidden="true" /> Today
            </button>
          </div>
        ))}
      </section>
    );
  } else if (selection.kind === 'completed') {
    const list = completedTasks(tasks);
    body = (
      <section>
        <h1>Completed</h1>
        {list.length === 0 && <p className="empty">Nothing completed yet.</p>}
        <TaskList tasks={list.slice(0, 100)} allTasks={tasks} showDate onOpen={setOpenId} />
      </section>
    );
  } else if (selection.kind === 'calendar') {
    body = <CalendarView tasks={tasks} onOpen={setOpenId} />;
  } else if (selection.kind === 'journal') {
    body = <JournalView key={selection.date ?? ''} initialDate={selection.date} />;
  } else if (selection.kind === 'notes') {
    body = <NotesView key={selection.openId ?? ''} initialOpenId={selection.openId} />;
  } else if (selection.kind === 'goals') {
    body = <GoalsView tasks={tasks} onOpenGoalTasks={() => {}} />;
  } else if (selection.kind === 'habits') {
    body = <HabitsView />;
  } else if (selection.kind === 'planner') {
    body = <PlannerView tasks={tasks} onOpen={setOpenId} />;
  } else if (selection.kind === 'week') {
    body = <WeekView tasks={tasks} onOpen={setOpenId} />;
  } else if (selection.kind === 'search') {
    body = (
      <SearchView
        tasks={tasks}
        projects={projects}
        selection={selection}
        onPatch={(patch) => setSelection({ ...selection, ...patch })}
        onOpenTask={setOpenId}
        onSelect={setSelection}
      />
    );
  } else if (selection.kind === 'project') {
    const project = projects.find((p) => p.id === selection.id);
    const list = projectTasks(tasks, selection.id);
    const projAll = tasks.filter((t) => t.projectId === selection.id && t.parentId === null && t.status !== 'archived');
    const projDone = projAll.filter((t) => t.status === 'done').length;
    const projPct = projAll.length ? Math.round((projDone / projAll.length) * 100) : 0;
    body = (
      <section>
        <h1>
          <span className="dot" style={{ background: project?.color }} /> {project?.name ?? 'Project'}
          {projAll.length > 0 && (
            <span className="proj-progress">
              <span className="progress proj-bar"><span className="progress-fill" style={{ width: `${projPct}%` }} /></span>
              <span className="date-sub num">{projDone} of {projAll.length}</span>
            </span>
          )}
        </h1>
        {list.length === 0 && <p className="empty">No active tasks in this project.</p>}
        <TaskList tasks={list} allTasks={tasks} showDate onOpen={setOpenId}
          onReorder={(dragId, targetId, after) => void moveTask(dragId, targetId, after, list)} />
      </section>
    );
  }

  return (
    <div className="app">
      <Sidebar projects={projects} selection={selection} onSelect={setSelection} counts={counts} activeByProject={activeByProject}
        onScheduleToday={(id) => void updateTask(id, { dueDate: today })}
        onImport={() => setImportOpen(true)} onAutomation={() => setAutomationOpen(true)} onSync={() => setSyncOpen(true)} />
      <main>
        {showQuickAdd && (
          <QuickAdd
            projectId={quickAddContext.projectId}
            dueDate={quickAddContext.dueDate}
          />
        )}
        {body}
      </main>
      {openId && <TaskDetail taskId={openId} onClose={() => setOpenId(null)} />}
      {importOpen && <ImportDialog projects={projects} onClose={() => setImportOpen(false)} />}
      {automationOpen && <AutomationDialog rules={rules} onChange={changeRules} onClose={() => setAutomationOpen(false)} />}
      {syncOpen && <SyncDialog onClose={() => setSyncOpen(false)} />}
      <CommandPalette
        open={paletteOpen}
        tasks={tasks}
        onClose={() => setPaletteOpen(false)}
        onSelect={setSelection}
        onOpenTask={setOpenId}
        onNewTask={quickAddFocus}
        onToggleTheme={() => cycleTheme()}
      />
    </div>
  );
}
