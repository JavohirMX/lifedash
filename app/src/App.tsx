import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Pencil, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, INBOX_ID, ensureSeed } from './db';
import AssistantDialog from './ai/AssistantDialog';
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
import ShortcutsDialog from './components/ShortcutsDialog';
import ImportDialog from './components/ImportDialog';
import type { ImportSource } from './import';
import AutomationDialog from './components/AutomationDialog';
import TVDashboard from './views/TVDashboard';
import SyncDialog from './components/SyncDialog';
import AppearanceDialog from './components/AppearanceDialog';
import { cycleTheme } from './theme';
import { projectWithDescendants } from './projects';
import { loadRules, saveRules, loadUserRules, saveUserRules, type AutomationRules, type UserRule } from './automation';
import { remindersEnabled, setRemindersEnabled, journalPromptEnabled, setJournalPromptEnabled, startReminders } from './reminders';
import { applyRollover, applyWeeklyUserRules } from './repo';
import { startAutoSync } from './sync';
import { SyncConflictBanner } from './components/SyncConflictBanner';
import {
  todayTasks,
  upcomingTasks,
  backlogTasks,
  projectTasks,
  completedTasks, groupCompletedByDay,
  searchTasks,
  projectTreeTasks,
} from './logic';
import { todayStr, friendlyDate, weekdayLabel } from './dates';
import { updateTask, moveTask, updateProject, deleteProject } from './repo';
import type { Task, JournalEntry } from './types';

export default function App() {
  const tasks = useLiveQuery(() => db.tasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.orderBy('order').toArray(), []);
  const notes = useLiveQuery(() => db.notes.toArray(), []);
  const journal = useLiveQuery(() => db.journal.toArray(), []);
  const [selection, setSelection] = useState<Selection>({ kind: 'home' });
  const [isTv, setIsTv] = useState(() => window.location.hash === '#/tv');
  useEffect(() => {
    const onHash = () => setIsTv(window.location.hash === '#/tv');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const [projEditing, setProjEditing] = useState(false);
  const [projName, setProjName] = useState('');
  const [projColor, setProjColor] = useState('');
  const [projConfirmDelete, setProjConfirmDelete] = useState(false);
  useEffect(() => { setProjEditing(false); setProjConfirmDelete(false); }, [selection.kind, selection.kind === 'project' ? selection.id : null]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [importPreset, setImportPreset] = useState<ImportSource | null | false>(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [rules, setRules] = useState<AutomationRules>(loadRules);
  const [userRules, setUserRules] = useState<UserRule[]>(loadUserRules);
  const [remindOn, setRemindOn] = useState(remindersEnabled);
  const [nudgeOn, setNudgeOn] = useState(journalPromptEnabled);
  const tasksRef = useRef<Task[]>([]);
  const journalRef = useRef<JournalEntry[]>([]);
  const quickAddFocus = () => document.querySelector<HTMLInputElement>('.quick-add input')?.focus();
  useGlobalKeys({
    onPalette: () => setPaletteOpen((o) => !o),
    onNewTask: quickAddFocus,
    onSelect: setSelection,
    onHelp: () => setShortcutsOpen((o) => !o),
  });

  useEffect(() => {
    void ensureSeed();
    startAutoSync();
    if (loadRules().rollover) void applyRollover(todayStr());
    void applyWeeklyUserRules(todayStr());
  }, []);

  tasksRef.current = tasks ?? [];
  journalRef.current = journal ?? [];
  useEffect(() => {
    if (!remindOn || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    return startReminders(
      () => tasksRef.current,
      (t) => {
        try {
          new Notification('Due now', { body: t.title });
        } catch {
          /* notification construction can fail on some platforms */
        }
      },
      () => new Date(),
      30_000,
      nudgeOn
        ? {
            isEmptyToday: (date) => {
              const e = (journalRef.current ?? []).find((x) => x.date === date);
              return !e || (e.note.trim() === '' && !(e.highlight ?? '').trim());
            },
            notify: () => {
              try {
                new Notification('Evening journal', { body: 'How was today? Log a line or a highlight.' });
              } catch {
                /* notification construction can fail on some platforms */
              }
            },
          }
        : undefined,
    );
  }, [remindOn, nudgeOn]);

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

  const changeUserRules = (next: UserRule[]) => {
    setUserRules(next);
    saveUserRules(next);
  };
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
  const openTag = (tag: string) => setSelection({ kind: 'search', query: `#${tag}` });
  const showQuickAdd = selection.kind !== 'completed' && selection.kind !== 'search' && selection.kind !== 'habits' && selection.kind !== 'planner' && selection.kind !== 'week' && selection.kind !== 'home' && selection.kind !== 'goals' && selection.kind !== 'notes' && selection.kind !== 'journal' && selection.kind !== 'calendar';

  if (isTv) return <TVDashboard />;

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
        <TaskList tasks={list} allTasks={tasks} showDate onOpen={setOpenId} onTag={openTag}
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
            <TaskList tasks={list} allTasks={tasks} onOpen={setOpenId} onTag={openTag} />
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
              <TaskList tasks={[t]} allTasks={tasks} onOpen={setOpenId} onTag={openTag} />
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
    const groups = groupCompletedByDay(list.slice(0, 200), today);
    body = (
      <section>
        <h1>Completed {list.length > 0 && <span className="date-sub num">{list.length} task{list.length === 1 ? '' : 's'}</span>}</h1>
        {list.length === 0 && <p className="empty">Nothing completed yet.</p>}
        {groups.map((g) => (
          <div key={g.day || 'unknown'} className="day-group">
            <h2>{g.label} <span className="date-sub num">{g.tasks.length}</span></h2>
            <TaskList tasks={g.tasks} allTasks={tasks} showDate onOpen={setOpenId} onTag={openTag} />
          </div>
        ))}
        {list.length > 200 && <p className="empty">Showing the 200 most recent.</p>}
      </section>
    );
  } else if (selection.kind === 'calendar') {
    body = <CalendarView tasks={tasks} onOpen={setOpenId} />;
  } else if (selection.kind === 'journal') {
    body = <JournalView key={selection.date ?? ''} initialDate={selection.date} />;
  } else if (selection.kind === 'notes') {
    body = <NotesView key={selection.openId ?? ''} initialOpenId={selection.openId} />;
  } else if (selection.kind === 'goals') {
    body = <GoalsView tasks={tasks} onOpen={setOpenId} />;
  } else if (selection.kind === 'habits') {
    body = <HabitsView />;
  } else if (selection.kind === 'planner') {
    body = <PlannerView tasks={tasks} onOpen={setOpenId} onTag={openTag} />;
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
    const list = projectTreeTasks(tasks, projects, selection.id);
    const treeIds = projectWithDescendants(projects, selection.id);
    const projNameById = new Map(projects.map((p) => [p.id, p.name]));
    const projAll = tasks.filter((t) => treeIds.has(t.projectId) && t.parentId === null && t.status !== 'archived');
    const projDirect = tasks.filter((t) => t.projectId === selection.id && t.parentId === null && t.status !== 'archived');
    const projDone = projAll.filter((t) => t.status === 'done').length;
    const projPct = projAll.length ? Math.round((projDone / projAll.length) * 100) : 0;
    body = (
      <section>
        <h1>
          <span className="dot" style={{ background: project?.color }} /> {project?.name ?? 'Project'}
          {project && project.id !== INBOX_ID && (
            <button className="icon-btn proj-edit-btn" aria-label="Project settings" title="Project settings"
              onClick={() => { setProjName(project.name); setProjColor(project.color); setProjEditing(!projEditing); setProjConfirmDelete(false); }}>
              <Pencil size={15} strokeWidth={2} />
            </button>
          )}
          {projAll.length > 0 && (
            <span className="proj-progress">
              <span className="progress proj-bar"><span className="progress-fill" style={{ width: `${projPct}%` }} /></span>
              <span className="date-sub num">{projDone} of {projAll.length}</span>
            </span>
          )}
        </h1>
        {projEditing && project && (
          <div className="goal-add proj-settings">
            <input
              autoFocus
              value={projName}
              aria-label="Project name"
              onChange={(e) => setProjName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && projName.trim()) {
                  void updateProject(project.id, { name: projName, color: projColor });
                  setProjEditing(false);
                }
                if (e.key === 'Escape') setProjEditing(false);
              }}
            />
            <div className="proj-colors">
              {['#0f766e', '#2563eb', '#b45309', '#be123c', '#4d7c0f', '#0e7490', '#6366f1', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#38bdf8'].map((c) => (
                <button key={c} className={`swatch ${projColor === c ? 'on' : ''}`} style={{ background: c }}
                  aria-label={`Color ${c}`} aria-pressed={projColor === c} onClick={() => setProjColor(c)} />
              ))}
            </div>
            <div className="habit-edit-actions">
              <button className="btn-primary" disabled={!projName.trim()}
                onClick={() => { void updateProject(project.id, { name: projName, color: projColor }); setProjEditing(false); }}>
                Save
              </button>
              <button className="mini" onClick={() => setProjEditing(false)}>Cancel</button>
              {projConfirmDelete ? (
                <>
                  <span className="proj-del-hint">
                    Deletes its {projDirect.length} task{projDirect.length === 1 ? '' : 's'}
                    {projects.some((p) => (p.parentId ?? null) === project.id) ? '; subprojects move up one level' : ''}.
                  </span>
                  <button className="mini danger" onClick={() => { void deleteProject(project).then(() => setSelection({ kind: 'project', id: INBOX_ID })).catch((e: unknown) => window.alert(e instanceof Error ? e.message : 'Delete failed.')); }}>
                    Confirm delete
                  </button>
                </>
              ) : (
                <button className="mini danger" style={{ marginLeft: 'auto' }} onClick={() => setProjConfirmDelete(true)}>Delete project</button>
              )}
            </div>
          </div>
        )}
        {list.length === 0 && <p className="empty">No active tasks in this project or its subprojects.</p>}
        <TaskList tasks={list} allTasks={tasks} showDate onOpen={setOpenId} onTag={openTag}
          projectLabelFor={(t) => (t.projectId !== selection.id ? projNameById.get(t.projectId) : undefined)}
          onReorder={(dragId, targetId, after) => void moveTask(dragId, targetId, after, list)} />
      </section>
    );
  }

  return (
    <div className="app">
      <Sidebar projects={projects} selection={selection} onSelect={setSelection} counts={counts} activeByProject={activeByProject}
        onPalette={() => setPaletteOpen(true)}
        reminders={typeof Notification === 'undefined' ? 'unsupported' : Notification.permission === 'denied' ? 'blocked' : remindOn ? 'on' : 'off'}
        journalNudge={nudgeOn}
        onToggleJournalNudge={() => {
          const next = !nudgeOn;
          setJournalPromptEnabled(next);
          setNudgeOn(next);
        }}
        onToggleReminders={() => {
          if (remindOn) { setRemindersEnabled(false); setRemindOn(false); return; }
          if (typeof Notification === 'undefined') return;
          void (Notification.permission === 'granted'
            ? Promise.resolve('granted' as NotificationPermission)
            : Notification.requestPermission()
          ).then((perm) => {
            if (perm === 'granted') { setRemindersEnabled(true); setRemindOn(true); }
          });
        }}
        onScheduleToday={(id) => void updateTask(id, { dueDate: today })}
        onAI={() => setAiOpen(true)} onImport={() => setImportPreset(null)} onRestore={() => setImportPreset('lifedash-json')} onAutomation={() => setAutomationOpen(true)} onSync={() => setSyncOpen(true)} onAppearance={() => setAppearanceOpen(true)} />
      <main>
        <SyncConflictBanner />
        {showQuickAdd && (
          <QuickAdd
            projectId={quickAddContext.projectId}
            dueDate={quickAddContext.dueDate}
          />
        )}
        {body}
      </main>
      {openId && (
        <TaskDetail
          taskId={openId}
          onClose={() => setOpenId(null)}
          onOpenNote={(nid) => { setOpenId(null); setSelection({ kind: 'notes', openId: nid }); }}
        />
      )}
      {importPreset !== false && <ImportDialog projects={projects} initialSource={importPreset} onClose={() => setImportPreset(false)} />}
      {automationOpen && <AutomationDialog rules={rules} onChange={changeRules} userRules={userRules} onUserRulesChange={changeUserRules} onClose={() => setAutomationOpen(false)} />}
      {aiOpen && <AssistantDialog tasks={tasks} onClose={() => setAiOpen(false)} />}
      {syncOpen && <SyncDialog onClose={() => setSyncOpen(false)} />}
      {appearanceOpen && <AppearanceDialog onClose={() => setAppearanceOpen(false)} />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      <CommandPalette
        open={paletteOpen}
        tasks={tasks}
        notes={notes ?? []}
        journal={journal ?? []}
        onClose={() => setPaletteOpen(false)}
        onSelect={setSelection}
        onOpenTask={setOpenId}
        onNewTask={quickAddFocus}
        onToggleTheme={() => cycleTheme()}
        onAppearance={() => setAppearanceOpen(true)}
        onShortcuts={() => setShortcutsOpen(true)}
      />
    </div>
  );
}
