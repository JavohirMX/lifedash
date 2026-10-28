import './views/workflow.css';
import CompletionFailureNotice from './components/CompletionFailureNotice';
import CompletionDialog from './components/CompletionDialog';
import { setCompletionHandler, type CompletionPrompt } from './completionPrompt';
import { SAMPLE_MODE } from './dev/sampleMode';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Pencil, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, INBOX_ID, ensureSeed } from './db';
import AssistantDialog from './ai/AssistantDialog';
import Sidebar, { type Selection } from './components/Sidebar';
import QuickAdd from './components/QuickAdd';
import BacklogSchedule from './components/BacklogSchedule';
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
import GoogleCalendarDialog from './components/GoogleCalendarDialog';
import SettingsDialog from './components/SettingsDialog';
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
import type { Task, JournalEntry, Project } from './types';

export default function App() {
  const [completionPrompt, setCompletionPrompt] = useState<CompletionPrompt | null>(null);
  useEffect(() => { setCompletionHandler(setCompletionPrompt); return () => setCompletionHandler(null); }, []);
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
  const projWriting = useRef(false);
  const [projSaving, setProjSaving] = useState(false);
  const [projSaveError, setProjSaveError] = useState('');
  const projDeleting = useRef(false);
  const [projDeleteBusy, setProjDeleteBusy] = useState(false);
  const selectedProjectId = useRef<string | null>(null);
  selectedProjectId.current = selection.kind === 'project' ? selection.id : null;
  async function saveProject(id: string) {
    if (projWriting.current || projDeleting.current || !projName.trim()) return;
    projWriting.current = true; setProjSaving(true); setProjSaveError('');
    try {
      await updateProject(id, { name: projName, color: projColor });
      if (selectedProjectId.current === id) setProjEditing(false);
    } catch {
      if (selectedProjectId.current === id) setProjSaveError("Couldn't save this project. Your name and color are still here. Try Save again.");
    } finally { projWriting.current = false; setProjSaving(false); }
  }

  useEffect(() => { setProjEditing(false); setProjConfirmDelete(false); setProjSaveError(''); }, [selection.kind, selection.kind === 'project' ? selection.id : null]);
  async function removeProject(project: Project) {
    if (projDeleting.current || projWriting.current) return;
    projDeleting.current = true; setProjDeleteBusy(true);
    try {
      await deleteProject(project);
      if (selectedProjectId.current === project.id) setSelection({ kind: 'project', id: INBOX_ID });
    } catch (error: unknown) {
      window.alert(error instanceof Error ? error.message : 'Delete failed.');
    } finally { projDeleting.current = false; setProjDeleteBusy(false); }
  }
  const [openId, setOpenId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [importPreset, setImportPreset] = useState<ImportSource | null | false>(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [weeklyFailed, setWeeklyFailed] = useState(false);
  async function runWeeklyRules() {
    try { await applyWeeklyUserRules(todayStr()); }
    catch { setWeeklyFailed(true); }
  }
  const [rolloverFailed, setRolloverFailed] = useState(false);
  async function runRollover() {
    try { await applyRollover(todayStr()); }
    catch { setRolloverFailed(true); }
  }
  const [syncOpen, setSyncOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [googleCalendarOpen,setGoogleCalendarOpen]=useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsChild, setSettingsChild] = useState<'appearance' | 'sync' | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [rules, setRules] = useState<AutomationRules>(loadRules);
  const [userRules, setUserRules] = useState<UserRule[]>(loadUserRules);
  const [remindOn, setRemindOn] = useState(remindersEnabled);
  const [nudgeOn, setNudgeOn] = useState(journalPromptEnabled);
  const [notificationError, setNotificationError] = useState('');
  const notificationWriting = useRef(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  async function toggleReminders() {
    if (notificationWriting.current || typeof Notification === 'undefined') return;
    notificationWriting.current = true; setNotificationBusy(true); setNotificationError('');
    try {
      if (remindOn) { setRemindersEnabled(false); setRemindOn(false); return; }
      let permission: NotificationPermission;
      try { permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission(); }
      catch { setNotificationError("Couldn't request notification permission. Your reminder preference is unchanged. Try Reminders again."); return; }
      if (permission === 'granted') { setRemindersEnabled(true); setRemindOn(true); }
    } catch { setNotificationError("Couldn't save Reminders. Your previous preference is unchanged. Try Reminders again."); }
    finally { notificationWriting.current = false; setNotificationBusy(false); }
  }
  function toggleJournalNudge() {
    if (notificationWriting.current) return;
    setNotificationError('');
    try { const next = !nudgeOn; setJournalPromptEnabled(next); setNudgeOn(next); }
    catch { setNotificationError("Couldn't save Journal nudge. Your previous preference is unchanged. Try Journal nudge again."); }
  }

  const tasksRef = useRef<Task[]>([]);
  const journalRef = useRef<JournalEntry[]>([]);
  const [quickAddRequested, setQuickAddRequested] = useState(false);
  const quickAddFocus = () => {
    const input = document.querySelector<HTMLInputElement>('.quick-add input');
    if (input) input.focus();
    else { setSelection({ kind: 'backlog' }); setQuickAddRequested(true); }
  };
  useEffect(() => {
    if (!quickAddRequested) return;
    const input = document.querySelector<HTMLInputElement>('.quick-add input');
    if (input) { input.focus(); setQuickAddRequested(false); }
  }, [selection, quickAddRequested]);
  useGlobalKeys({
    onPalette: () => setPaletteOpen((o) => !o),
    onNewTask: quickAddFocus,
    onSelect: setSelection,
    onHelp: () => setShortcutsOpen((o) => !o),
  });

  useEffect(() => {
    void ensureSeed();
    startAutoSync();
    if (loadRules().rollover) void runRollover();
    void runWeeklyRules();
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
  const schedulingToday = useRef(new Set<string>());
  const [todayPending, setTodayPending] = useState<Set<string>>(new Set());
  const [todayErrors, setTodayErrors] = useState<Record<string, { title: string; date: string }>>({});
  async function scheduleDroppedToday(id: string, date: string) {
    if (schedulingToday.current.has(id)) return;
    schedulingToday.current.add(id); setTodayPending(new Set(schedulingToday.current));
    setTodayErrors(current => { const next = { ...current }; delete next[id]; return next; });
    const title = tasks?.find(task => task.id === id)?.title || 'task';
    try { await updateTask(id, { dueDate: date }); }
    catch { setTodayErrors(current => ({ ...current, [id]: { title, date } })); }
    finally { schedulingToday.current.delete(id); setTodayPending(new Set(schedulingToday.current)); }
  }


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
    saveUserRules(next);
    setUserRules(next);
  };
  const changeRules = (next: AutomationRules) => {
    saveRules(next);
    setRules(next);
    if (next.rollover && !rules.rollover) void runRollover();
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
        <p className="workflow-hint">Open tasks due today or earlier. Undated tasks stay in Backlog.</p>
        {counts.backlog > 0 && (
          <button className="nudge" onClick={() => setSelection({ kind: 'backlog' })}>
            {counts.backlog} task{counts.backlog === 1 ? '' : 's'} parked in Backlog
            <span className="nudge-cta">Review</span>
          </button>
        )}
        {list.length === 0 && <p className="empty">Nothing due today. Enjoy, or pull something in from Backlog.</p>}
        <TaskList tasks={list} allTasks={tasks} showDate onOpen={setOpenId} onTag={openTag}
          onReorder={(dragId, targetId, after) => moveTask(dragId, targetId, after, list)} />
      </section>
    );
  } else if (selection.kind === 'upcoming') {
    const groups = upcomingTasks(tasks, today);
    body = (
      <section>
        <h1>Upcoming</h1>
        <p className="workflow-hint">Tomorrow through the next 14 days. Overdue and today's tasks are in Today.</p>
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
        <p className="workflow-hint">Open tasks with no due date. Choose Today or a date beside a task to schedule it.</p>
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
            <BacklogSchedule id={t.id} title={t.title} today={today} />
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
            <button className="icon-btn proj-edit-btn" aria-label="Project settings" title="Project settings" disabled={projSaving || projDeleteBusy}
              onClick={() => { setProjName(project.name); setProjColor(project.color); setProjEditing(!projEditing); setProjConfirmDelete(false); setProjSaveError(''); }}>
              <Pencil size={15} strokeWidth={2} />
            </button>
          )}
          {projAll.length > 0 && (
            <span className="proj-progress">
              <span className="progress proj-bar"><span className="progress-fill" style={{ width: `${projPct}%` }} /></span>
              <span className="date-sub num" title="Including subprojects">{projDone} of {projAll.length}</span>
            </span>
          )}
        </h1>
        <p className="workflow-hint">Open tasks in this project and its subprojects. Progress above includes completed top-level tasks.</p>
        {projEditing && project && (
          <fieldset className="goal-add proj-settings save-form" disabled={projSaving || projDeleteBusy} aria-busy={projSaving || projDeleteBusy}>
            <input
              autoFocus
              value={projName}
              aria-label="Project name"
              onChange={(e) => setProjName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveProject(project.id);
                if (e.key === 'Escape' && !e.nativeEvent.isComposing) setProjEditing(false);
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
                onClick={() => void saveProject(project.id)}>
                Save
              </button>
              <button className="mini" onClick={() => setProjEditing(false)}>Cancel</button>
              {projConfirmDelete ? (
                <>
                  <span className="proj-del-hint">
                    Deletes its {projDirect.length} task{projDirect.length === 1 ? '' : 's'}
                    {projects.some((p) => (p.parentId ?? null) === project.id) ? '; subprojects move up one level' : ''}.
                  </span>
                  <button className="mini danger" onClick={() => void removeProject(project)}>
                    Confirm delete
                  </button>
                </>
              ) : (
                <button className="mini danger" style={{ marginLeft: 'auto' }} onClick={() => setProjConfirmDelete(true)}>Delete project</button>
              )}
            </div>
          {projSaving && <p className="form-save-status" role="status">Saving project…</p>}
          {projDeleteBusy && <p className="form-save-status" role="status">Deleting project…</p>}
            {projSaveError && <p className="form-save-error" role="alert">{projSaveError}</p>}
          </fieldset>
        )}
        {list.length === 0 && <p className="empty">No active tasks in this project or its subprojects.</p>}
        <TaskList tasks={list} allTasks={tasks} showDate onOpen={setOpenId} onTag={openTag}
          projectLabelFor={(t) => (t.projectId !== selection.id ? projNameById.get(t.projectId) : undefined)}
          onReorder={(dragId, targetId, after) => moveTask(dragId, targetId, after, list)} />
      </section>
    );
  }

  return (
    <div className="app">
      <Sidebar projects={projects} selection={selection} onSelect={setSelection} counts={counts} activeByProject={activeByProject}
        onPalette={() => setPaletteOpen(true)}
        reminders={typeof Notification === 'undefined' ? 'unsupported' : Notification.permission === 'denied' ? 'blocked' : remindOn ? 'on' : 'off'}
        journalNudge={nudgeOn}
        onToggleJournalNudge={toggleJournalNudge}
        onToggleReminders={() => void toggleReminders()}
        onScheduleToday={(id) => void scheduleDroppedToday(id, today)}
        onAI={() => setAiOpen(true)} onImport={() => setImportPreset(null)} onRestore={() => setImportPreset('lifedash-json')} onAutomation={() => setAutomationOpen(true)} onSync={() => { setSettingsChild(null); setSyncOpen(true); }} onAppearance={() => { setSettingsChild(null); setAppearanceOpen(true); }} onSettings={() => setSettingsOpen(true)} />
      <main className={selection.kind === 'home' ? 'home-main' : ['week', 'calendar'].includes(selection.kind) ? 'schedule-main' : undefined}>
        {SAMPLE_MODE && <div className="sample-banner" role="status">Sample-data sandbox · Fictional data · <a href="/">Exit to your real data</a></div>}
        <SyncConflictBanner />
        {weeklyFailed && !automationOpen && <div role="alert"><p>Couldn't finish running weekly rules. Some tasks may have been created or rule history may not have been saved. Check tasks and rules before trying again.</p><button className="btn-secondary" onClick={() => setWeeklyFailed(false)}>Dismiss weekly-rule notice</button></div>}
        {rolloverFailed && !automationOpen && <div role="alert"><p>Couldn't finish moving overdue tasks to Today. Part of the change may have been saved. Check task dates before trying again. Your automation setting is unchanged.</p><button className="btn-secondary" onClick={() => setRolloverFailed(false)}>Dismiss rollover notice</button></div>}
        <CompletionFailureNotice />
        {notificationError && !settingsOpen && <p className="form-save-error" role="alert">{notificationError}</p>}
        {showQuickAdd && (
          <QuickAdd
            projectId={quickAddContext.projectId}
            dueDate={quickAddContext.dueDate}
          />
        )}
        {todayPending.size > 0 && <p className="workflow-hint" role="status">Scheduling dropped task…</p>}
        {Object.entries(todayErrors).map(([id, error]) => <div key={id} className="sub-add-feedback">
          <p role="alert">Date wasn't saved for "{error.title}". Retry to schedule it for {error.date}.</p>
          <button className="btn-secondary" onClick={() => void scheduleDroppedToday(id, error.date)}>Retry Today drop for {error.title}</button>
        </div>)}
        {body}
      </main>
      {completionPrompt && <CompletionDialog prompt={completionPrompt} />}
      {openId && (
        <TaskDetail
          taskId={openId}
          onClose={() => setOpenId(null)}
          onOpenNote={(nid) => { setOpenId(null); setSelection({ kind: 'notes', openId: nid }); }}
        />
      )}
      {importPreset !== false && <ImportDialog projects={projects} initialSource={importPreset} onClose={() => setImportPreset(false)} />}
      {automationOpen && <AutomationDialog weeklyFailed={weeklyFailed} onDismissWeekly={() => setWeeklyFailed(false)} rolloverFailed={rolloverFailed} onDismissRollover={() => setRolloverFailed(false)} rules={rules} onChange={changeRules} userRules={userRules} onUserRulesChange={changeUserRules} onClose={() => setAutomationOpen(false)} />}
      {aiOpen && <AssistantDialog tasks={tasks} onClose={() => setAiOpen(false)} />}
      {syncOpen && <SyncDialog onClose={() => setSyncOpen(false)} onBack={settingsChild === 'sync' ? () => { setSyncOpen(false); setSettingsOpen(true); } : undefined} />}
      {googleCalendarOpen && <GoogleCalendarDialog onClose={()=>setGoogleCalendarOpen(false)} onBack={()=>{setGoogleCalendarOpen(false);setSettingsOpen(true);}}/>}
      {settingsOpen && <SettingsDialog
        onClose={() => setSettingsOpen(false)}
        onGoogleCalendar={()=>{setSettingsOpen(false);setGoogleCalendarOpen(true);}}
        onSync={() => { setSettingsChild('sync'); setSettingsOpen(false); setSyncOpen(true); }}
        onAppearance={() => { setSettingsChild('appearance'); setSettingsOpen(false); setAppearanceOpen(true); }}
        reminders={typeof Notification === 'undefined' ? 'unsupported' : Notification.permission === 'denied' ? 'blocked' : remindOn ? 'on' : 'off'}
        onToggleReminders={() => void toggleReminders()}
        journalNudge={nudgeOn}
        onToggleJournalNudge={toggleJournalNudge}
        notificationError={notificationError}
        notificationBusy={notificationBusy}
      />}
      {appearanceOpen && <AppearanceDialog onClose={() => setAppearanceOpen(false)} onBack={settingsChild === 'appearance' ? () => { setAppearanceOpen(false); setSettingsOpen(true); } : undefined} />}
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
        onAppearance={() => { setSettingsChild(null); setAppearanceOpen(true); }}
        onShortcuts={() => setShortcutsOpen(true)}
      />
    </div>
  );
}
