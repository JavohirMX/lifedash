import DataBackupDialog from './components/DataBackupDialog';
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
import CaptureDialog from './components/CaptureDialog';
import BacklogSchedule from './components/BacklogSchedule';
import TaskList, { TASK_DRAG_MIME } from './components/TaskList';
import { EmptyState, PageHeader } from './components/Page';
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
import { isTvEnabled, setTvEnabled, TV_PREFERENCE_CHANGED_EVENT } from './tv';
import SyncDialog from './components/SyncDialog';
import AppearanceDialog from './components/AppearanceDialog';
import AiSettingsDialog from './components/AiSettingsDialog';
import { useAiSettings } from './ai/aiSettings';
import GoogleCalendarDialog from './components/GoogleCalendarDialog';
import WebcalDialog from './components/WebcalDialog';
import FocusWorkspace from './components/FocusWorkspace';
import SettingsView from './views/SettingsView';
import Onboarding from './components/Onboarding';
import { isFreshInstallPending, markFreshInstall, markOnboardingDone } from './onboarding';
import { loadSyncSettings } from './sync';
import AgentKeysDialog from './components/AgentKeysDialog';
import { cycleTheme } from './theme';
import { projectWithDescendants } from './projects';
import { loadRules, saveRules, loadUserRules, saveUserRules, hydrateAutomation, AUTOMATION_CHANGED_EVENT, type AutomationRules, type UserRule } from './automation';
import { publishLocalSettings, ensureDeviceSettingsPublished, DEVICE_SETTINGS_CHANGED_EVENT } from './deviceSettings';
import { remindersEnabled, setRemindersEnabled, journalPromptEnabled, setJournalPromptEnabled, startReminders, reminderGate } from './reminders';
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
  activeBlockers,
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
  // null = not known yet (seed check pending): onboarding never renders
  // before freshness is established, so upgrading users never flash it.
  const [freshInstall, setFreshInstall] = useState<boolean | null>(null);
  const [isTv, setIsTv] = useState(() => window.location.hash === '#/tv');
  useEffect(() => {
    const onHash = () => setIsTv(window.location.hash === '#/tv');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const [tvOn, setTvOn] = useState(() => isTvEnabled());
  useEffect(() => {
    const onTvChange = () => setTvOn(isTvEnabled());
    window.addEventListener(TV_PREFERENCE_CHANGED_EVENT, onTvChange);
    return () => window.removeEventListener(TV_PREFERENCE_CHANGED_EVENT, onTvChange);
  }, []);
  useEffect(() => {
    const onNavigateNote = (e: Event) => {
      const noteId = (e as CustomEvent<{ noteId: string }>).detail?.noteId;
      if (noteId) {
        setOpenId(null);
        setSelection({ kind: 'notes', openId: noteId });
      }
    };
    window.addEventListener('lifedash-navigate-note', onNavigateNote);
    return () => window.removeEventListener('lifedash-navigate-note', onNavigateNote);
  }, []);
  const toggleTv = () => {
    const next = !tvOn;
    setTvEnabled(next);
    setTvOn(next);
  };
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
  const aiSettings = useAiSettings();
  const [aiOpen, setAiOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [googleCalendarOpen,setGoogleCalendarOpen]=useState(false);
  const [webcalOpen, setWebcalOpen] = useState(false);
  const [focusWorkspaceTaskId, setFocusWorkspaceTaskId] = useState<string | null>(null);
  const [agentKeysOpen, setAgentKeysOpen] = useState(false);
  const [dataBackupOpen, setDataBackupOpen] = useState(false);
  const [settingsChild, setSettingsChild] = useState<'appearance' | 'sync' | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [rules, setRules] = useState<AutomationRules>(loadRules);
  const [userRules, setUserRules] = useState<UserRule[]>(loadUserRules);
  const [sampleDismissed, setSampleDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('lifedash-sample-banner-dismissed') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onAutomationChanged = () => { setRules(loadRules()); setUserRules(loadUserRules()); };
    window.addEventListener(AUTOMATION_CHANGED_EVENT, onAutomationChanged);
    return () => window.removeEventListener(AUTOMATION_CHANGED_EVENT, onAutomationChanged);
  }, []);

  useEffect(() => {
    const onDeviceSettings = () => { setRemindOn(remindersEnabled()); setNudgeOn(journalPromptEnabled()); };
    window.addEventListener(DEVICE_SETTINGS_CHANGED_EVENT, onDeviceSettings);
    return () => window.removeEventListener(DEVICE_SETTINGS_CHANGED_EVENT, onDeviceSettings);
  }, []);
  const [remindOn, setRemindOn] = useState(remindersEnabled);
  const [nudgeOn, setNudgeOn] = useState(journalPromptEnabled);
  const [notificationError, setNotificationError] = useState('');
  const notificationWriting = useRef(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  async function toggleReminders() {
    if (notificationWriting.current || typeof Notification === 'undefined') return;
    notificationWriting.current = true; setNotificationBusy(true); setNotificationError('');
    try {
      // On + granted toggles off. On + never-asked (e.g. enabled remotely)
      // makes this tap the permission ask, not a silent disable.
      if (remindOn && Notification.permission === 'granted') { setRemindersEnabled(false); setRemindOn(false); publishLocalSettings(); return; }
      let permission: NotificationPermission;
      try { permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission(); }
      catch { setNotificationError("Couldn't request notification permission. Your reminder preference is unchanged. Try Reminders again."); return; }
      if (permission === 'granted') { setRemindersEnabled(true); setRemindOn(true); publishLocalSettings(); }
    } catch { setNotificationError("Couldn't save Reminders. Your previous preference is unchanged. Try Reminders again."); }
    finally { notificationWriting.current = false; setNotificationBusy(false); }
  }
  function toggleJournalNudge() {
    if (notificationWriting.current) return;
    setNotificationError('');
    try { const next = !nudgeOn; setJournalPromptEnabled(next); setNudgeOn(next); publishLocalSettings(); }
    catch { setNotificationError("Couldn't save Journal nudge. Your previous preference is unchanged. Try Journal nudge again."); }
  }

  const tasksRef = useRef<Task[]>([]);
  const journalRef = useRef<JournalEntry[]>([]);
  const [captureState, setCaptureState] = useState<'open' | 'closed' | null>(null);
  const quickAddFocus = () => setCaptureState('open');
  useGlobalKeys({
    onPalette: () => setPaletteOpen((o) => !o),
    onNewTask: quickAddFocus,
    onSelect: setSelection,
    onHelp: () => setShortcutsOpen((o) => !o),
  });

  useEffect(() => {
    void ensureSeed().then(async (seeded) => {
      // First creation of the database: record the durable fresh-install
      // marker. Later loads (and reloads before any dismissal) re-read the
      // marker, so the welcome survives until Skip or a successful connect.
      if (seeded) markFreshInstall();
      setFreshInstall(isFreshInstallPending());
      // Move legacy localStorage automation config into Dexie (once), adopt
      // any config sync already delivered, then re-read the cache.
      await hydrateAutomation();
    ensureDeviceSettingsPublished();
      setRules(loadRules());
      setUserRules(loadUserRules());
      startAutoSync();
      if (loadRules().rollover) void runRollover();
      void runWeeklyRules();
    });
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

  const schedulingBacklog = useRef(new Set<string>());
  const [backlogPending, setBacklogPending] = useState<Set<string>>(new Set());
  const [backlogErrors, setBacklogErrors] = useState<Record<string, { title: string }>>({});
  async function scheduleDroppedBacklog(id: string) {
    if (schedulingBacklog.current.has(id)) return;
    schedulingBacklog.current.add(id); setBacklogPending(new Set(schedulingBacklog.current));
    setBacklogErrors(current => { const next = { ...current }; delete next[id]; return next; });
    const title = tasks?.find(task => task.id === id)?.title || 'task';
    try { await updateTask(id, { dueDate: null, dueTime: null }); }
    catch { setBacklogErrors(current => ({ ...current, [id]: { title } })); }
    finally { schedulingBacklog.current.delete(id); setBacklogPending(new Set(schedulingBacklog.current)); }
  }

  const movingProject = useRef(new Set<string>());
  const [projectMovePending, setProjectMovePending] = useState<Set<string>>(new Set());
  const [projectMoveErrors, setProjectMoveErrors] = useState<Record<string, { title: string; projectId: string; projectName: string }>>({});
  async function moveDroppedProject(id: string, projectId: string) {
    if (movingProject.current.has(id)) return;
    movingProject.current.add(id); setProjectMovePending(new Set(movingProject.current));
    setProjectMoveErrors(current => { const next = { ...current }; delete next[id]; return next; });
    const title = tasks?.find(task => task.id === id)?.title || 'task';
    const projectName = (projects ?? []).find(p => p.id === projectId)?.name || 'project';
    try { await updateTask(id, { projectId }); }
    catch { setProjectMoveErrors(current => ({ ...current, [id]: { title, projectId, projectName } })); }
    finally { movingProject.current.delete(id); setProjectMovePending(new Set(movingProject.current)); }
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

  const smartFilterCounts = useMemo(() => {
    const all = (tasks ?? []).filter((t) => t.status === 'active' && t.parentId === null);
    return {
      'quick-wins': all.filter((t) => typeof t.durationMinutes === 'number' && t.durationMinutes > 0 && t.durationMinutes <= 15).length,
      'high-priority': all.filter((t) => t.priority === 1).length,
      'blocked': all.filter((t) => activeBlockers(tasks ?? [], t).length > 0).length,
    };
  }, [tasks]);

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
    if (selection.kind === 'filter') {
      if (selection.filterId === 'high-priority') return { projectId: INBOX_ID, dueDate: null, priority: 1 };
      if (selection.filterId === 'quick-wins') return { projectId: INBOX_ID, dueDate: null, durationMinutes: 15 };
    }
    return { projectId: INBOX_ID, dueDate: null };
  })();
  const openTag = (tag: string) => setSelection({ kind: 'search', query: `#${tag}` });
  const showQuickAdd = selection.kind !== 'completed' && selection.kind !== 'search' && selection.kind !== 'habits' && selection.kind !== 'planner' && selection.kind !== 'week' && selection.kind !== 'home' && selection.kind !== 'goals' && selection.kind !== 'notes' && selection.kind !== 'journal' && selection.kind !== 'calendar' && selection.kind !== 'settings';

  if (isTv) return <TVDashboard />;

  let body;
  if (selection.kind === 'settings') {
    body = (
      <SettingsView
        onDataBackup={() => setDataBackupOpen(true)}
        onSync={() => { setSettingsChild('sync'); setSyncOpen(true); }}
        onAppearance={() => { setSettingsChild('appearance'); setAppearanceOpen(true); }}
        onAiSettings={() => setAiSettingsOpen(true)}
        onGoogleCalendar={() => setGoogleCalendarOpen(true)}
        onWebcal={() => setWebcalOpen(true)}
        onAgentKeys={() => setAgentKeysOpen(true)}
        onShortcuts={() => setShortcutsOpen(true)}
        onAutomation={() => setAutomationOpen(true)}
        onImport={() => setImportPreset(null)}
        onRestore={() => setImportPreset('lifedash-json')}
        reminders={reminderGate(remindOn)}
        onToggleReminders={() => void toggleReminders()}
        journalNudge={nudgeOn}
        onToggleJournalNudge={toggleJournalNudge}
        tvDashboard={tvOn}
        onToggleTvDashboard={toggleTv}
        notificationError={notificationError}
        notificationBusy={notificationBusy}
      />
    );
  }
  if (selection.kind === 'home') {
    body = (
      <HomeView
        tasks={tasks}
        onNavigate={setSelection}
        onSelect={(kind) => setSelection({ kind } as Selection)}
        onOpen={setOpenId}
        onOpenFocusWorkspace={setFocusWorkspaceTaskId}
      />
    );
  } else if (selection.kind === 'today') {
    const list = todayTasks(tasks, today);
    body = (
      <section>
        <PageHeader
          eyebrow="Tasks · due today and overdue"
          title="Today"
          meta={weekdayLabel(today)}
          description={list.length === 0 ? 'A clear day. Pull something in from Backlog, or leave it open.' : `${list.length} task${list.length === 1 ? '' : 's'} need${list.length === 1 ? 's' : ''} a decision. Finish one before choosing the next.`}
        />
        {counts.backlog > 0 && (
          <button className="nudge" onClick={() => setSelection({ kind: 'backlog' })}>
            {counts.backlog} task{counts.backlog === 1 ? '' : 's'} parked in Backlog
            <span className="nudge-cta">Review</span>
          </button>
        )}
        {list.length === 0 && <EmptyState>Nothing due today. Enjoy, or pull something in from Backlog.</EmptyState>}
        <TaskList tasks={list} allTasks={tasks} showDate onOpen={setOpenId} onTag={openTag}
          onReorder={(dragId, targetId, after) => moveTask(dragId, targetId, after, list)} />
      </section>
    );
  } else if (selection.kind === 'upcoming') {
    const groups = upcomingTasks(tasks, today);
    body = (
      <section>
        <PageHeader
          eyebrow="Tasks · the next two weeks"
          title="Upcoming"
          description={groups.size === 0 ? 'Nothing scheduled in the next two weeks.' : 'Scheduled work, grouped by the day it is due. Drag to reorder within a day.'}
        />
        {groups.size === 0 && <EmptyState>Nothing scheduled in the next two weeks.</EmptyState>}
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
        <PageHeader
          eyebrow="Tasks · no due date"
          title="Backlog"
          description="A holding area, not a graveyard. Schedule what matters, archive what does not."
        />
        {list.length === 0 && <EmptyState>Backlog is empty. Quick-add below to park something here.</EmptyState>}
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
        <PageHeader
          eyebrow="History · most recent first"
          title="Completed"
          meta={list.length > 0 ? `${list.length} task${list.length === 1 ? '' : 's'}` : undefined}
          description="A record of finished work. Reopen anything that needs another pass."
        />
        {list.length === 0 && <EmptyState>Nothing completed yet. Finished tasks will collect here.</EmptyState>}
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
    body = <GoalsView tasks={tasks} onOpen={setOpenId} onNavigate={setSelection} />;
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
  } else if (selection.kind === 'filter') {
    let title = 'Filter';
    let eyebrow = 'Smart List';
    let description = '';
    let filtered: Task[] = [];

    const activeTopTasks = tasks.filter((t) => t.status === 'active' && t.parentId === null);

    if (selection.filterId === 'quick-wins') {
      title = 'Quick Wins';
      eyebrow = 'Smart List · 15 minutes or less';
      description = 'Small tasks with estimated duration up to 15 minutes to knock out quickly.';
      filtered = activeTopTasks.filter((t) => typeof t.durationMinutes === 'number' && t.durationMinutes > 0 && t.durationMinutes <= 15);
    } else if (selection.filterId === 'high-priority') {
      title = 'High Priority';
      eyebrow = 'Smart List · Priority 1';
      description = 'Critical and high-priority tasks requiring urgent attention.';
      filtered = activeTopTasks.filter((t) => t.priority === 1);
    } else if (selection.filterId === 'blocked') {
      title = 'Blocked Tasks';
      eyebrow = 'Smart List · Waiting on blockers';
      description = 'Tasks with unresolved dependencies that cannot be completed yet.';
      filtered = activeTopTasks.filter((t) => activeBlockers(tasks, t).length > 0);
    }

    body = (
      <section>
        <PageHeader
          eyebrow={eyebrow}
          title={title}
          meta={filtered.length > 0 ? `${filtered.length} task${filtered.length === 1 ? '' : 's'}` : undefined}
          description={description}
        />
        {filtered.length === 0 && (
          <EmptyState>No tasks match this filter right now.</EmptyState>
        )}
        <TaskList
          tasks={filtered}
          allTasks={tasks}
          showDate
          onOpen={setOpenId}
          onTag={openTag}
        />
      </section>
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
        <PageHeader
          eyebrow="Project"
          title={<><span className="dot" style={{ background: project?.color }} /> {project?.name ?? 'Project'}</>}
          description="Includes subprojects · Top-level task progress"
          actions={project && project.id !== INBOX_ID ? (
            <button className="btn-secondary proj-edit-btn" aria-label="Project settings" title="Project settings" disabled={projSaving || projDeleteBusy}
              onClick={() => { setProjName(project.name); setProjColor(project.color); setProjEditing(!projEditing); setProjConfirmDelete(false); setProjSaveError(''); }}>
              <Pencil size={15} strokeWidth={2} aria-hidden="true" /> Edit project
            </button>
          ) : undefined}
        />
        {projAll.length > 0 && (
          <div className="proj-progress page-progress">
            <span className="progress proj-bar"><span className="progress-fill" style={{ width: `${projPct}%` }} /></span>
            <span className="date-sub num" title="Including subprojects">{projDone} of {projAll.length} done</span>
          </div>
        )}
        {projEditing && project && (
          <fieldset className="goal-add proj-settings save-form" disabled={projSaving || projDeleteBusy} aria-busy={projSaving || projDeleteBusy}>
            <input
              autoFocus
              value={projName}
              placeholder="Project name"
              aria-label="Project name"
              enterKeyHint="done"
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
      <Sidebar projects={projects} selection={selection} onSelect={setSelection} counts={counts} smartFilterCounts={smartFilterCounts} activeByProject={activeByProject}
        onCapture={quickAddFocus}
        onPalette={() => setPaletteOpen(true)}
        reminders={reminderGate(remindOn)}
        journalNudge={nudgeOn}
        onToggleJournalNudge={toggleJournalNudge}
        onToggleReminders={() => void toggleReminders()}
        onScheduleToday={(id) => void scheduleDroppedToday(id, today)}
        onScheduleBacklog={(id) => void scheduleDroppedBacklog(id)}
        onMoveToProject={(id, pId) => void moveDroppedProject(id, pId)}
        onAI={aiSettings.enabled ? () => setAiOpen(true) : undefined} onAutomation={() => setAutomationOpen(true)} onSync={() => { setSettingsChild(null); setSyncOpen(true); }} onAppearance={() => { setSettingsChild(null); setAppearanceOpen(true); }} onSettings={() => setSelection({ kind: 'settings' })}
        tvEnabled={tvOn} />
      <main className={selection.kind === 'home' ? 'home-main' : ['week', 'calendar'].includes(selection.kind) ? 'schedule-main' : undefined}>
        {SAMPLE_MODE && !sampleDismissed && (
          <div className="sample-banner" role="status">
            <div className="sample-banner-text">
              Sample-data sandbox · Fictional data · <a href="/">Exit to your real data</a>
            </div>
            <button
              type="button"
              className="sample-banner-dismiss"
              aria-label="Dismiss sample banner"
              title="Dismiss"
              onClick={() => {
                setSampleDismissed(true);
                try {
                  sessionStorage.setItem('lifedash-sample-banner-dismissed', '1');
                } catch {}
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}
        <SyncConflictBanner />
        {weeklyFailed && !automationOpen && <div role="alert"><p>Couldn't finish running weekly rules. Some tasks may have been created or rule history may not have been saved. Check tasks and rules before trying again.</p><button className="btn-secondary" onClick={() => setWeeklyFailed(false)}>Dismiss weekly-rule notice</button></div>}
        {rolloverFailed && !automationOpen && <div role="alert"><p>Couldn't finish moving overdue tasks to Today. Part of the change may have been saved. Check task dates before trying again. Your automation setting is unchanged.</p><button className="btn-secondary" onClick={() => setRolloverFailed(false)}>Dismiss rollover notice</button></div>}
        <CompletionFailureNotice />
        {notificationError && selection.kind !== 'settings' && <p className="form-save-error" role="alert">{notificationError}</p>}
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
        {backlogPending.size > 0 && <p className="workflow-hint" role="status">Moving dropped task to Backlog…</p>}
        {Object.entries(backlogErrors).map(([id, error]) => <div key={id} className="sub-add-feedback">
          <p role="alert">Could not move "{error.title}" to Backlog.</p>
          <button className="btn-secondary" onClick={() => void scheduleDroppedBacklog(id)}>Retry Backlog move for {error.title}</button>
        </div>)}
        {projectMovePending.size > 0 && <p className="workflow-hint" role="status">Moving dropped task to project…</p>}
        {Object.entries(projectMoveErrors).map(([id, error]) => <div key={id} className="sub-add-feedback">
          <p role="alert">Could not move "{error.title}" to {error.projectName}.</p>
          <button className="btn-secondary" onClick={() => void moveDroppedProject(id, error.projectId)}>Retry move for {error.title}</button>
        </div>)}
        {body}
      </main>
      {captureState !== null && <CaptureDialog open={captureState === 'open'} projects={projects} onClose={() => setCaptureState('closed')} />}
      {completionPrompt && <CompletionDialog prompt={completionPrompt} />}
      {openId && (
        <TaskDetail
          taskId={openId}
          onClose={() => setOpenId(null)}
          onOpenNote={(nid) => { setOpenId(null); setSelection({ kind: 'notes', openId: nid }); }}
          onOpenFocusWorkspace={setFocusWorkspaceTaskId}
        />
      )}
      {importPreset !== false && <ImportDialog projects={projects} initialSource={importPreset} onRestoreSettled={() => { setRules(loadRules()); setUserRules(loadUserRules()); }} onClose={() => setImportPreset(false)} />}
      {automationOpen && <AutomationDialog weeklyFailed={weeklyFailed} onDismissWeekly={() => setWeeklyFailed(false)} rolloverFailed={rolloverFailed} onDismissRollover={() => setRolloverFailed(false)} rules={rules} onChange={changeRules} userRules={userRules} onUserRulesChange={changeUserRules} projects={projects} onClose={() => setAutomationOpen(false)} />}
      {aiOpen && aiSettings.enabled && <AssistantDialog tasks={tasks} onClose={() => setAiOpen(false)} />}
      {aiSettingsOpen && <AiSettingsDialog onClose={() => setAiSettingsOpen(false)} />}
      {syncOpen && <SyncDialog onClose={() => { setSyncOpen(false); if (loadSyncSettings()) { markOnboardingDone(); setFreshInstall(false); } }} onBack={settingsChild === 'sync' ? () => setSyncOpen(false) : undefined} />}
      {googleCalendarOpen && <GoogleCalendarDialog onClose={()=>setGoogleCalendarOpen(false)} onBack={()=>setGoogleCalendarOpen(false)}/>}
      {webcalOpen && <WebcalDialog onClose={() => setWebcalOpen(false)} />}
      {focusWorkspaceTaskId && (
        <FocusWorkspace
          taskId={focusWorkspaceTaskId}
          onClose={() => setFocusWorkspaceTaskId(null)}
          onOpenDetail={setOpenId}
        />
      )}
      {dataBackupOpen && <DataBackupDialog onClose={() => setDataBackupOpen(false)} />}
      {agentKeysOpen && <AgentKeysDialog onClose={() => setAgentKeysOpen(false)} />}
      {appearanceOpen && <AppearanceDialog onClose={() => setAppearanceOpen(false)} onBack={settingsChild === 'appearance' ? () => setAppearanceOpen(false) : undefined} />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {freshInstall === true && !syncOpen && (
        <Onboarding
          // Set up sync does NOT dismiss: onboarding survives closing or
          // failing the dialog, and completes only on a successful connect
          // (SyncDialog onClose below) or an explicit Skip.
          onSetUpSync={() => { setSettingsChild(null); setSyncOpen(true); }}
          onSkip={() => { markOnboardingDone(); setFreshInstall(false); }}
        />
      )}
      <CommandPalette
        open={paletteOpen}
        tasks={tasks}
        notes={notes ?? []}
        journal={journal ?? []}
        onClose={() => setPaletteOpen(false)}
        onSelect={setSelection}
        onOpenTask={setOpenId}
        onNewTask={quickAddFocus}
        onToggleTheme={() => { cycleTheme(); publishLocalSettings(); }}
        onAppearance={() => { setSettingsChild(null); setAppearanceOpen(true); }}
        onShortcuts={() => setShortcutsOpen(true)}
      />
    </div>
  );
}
