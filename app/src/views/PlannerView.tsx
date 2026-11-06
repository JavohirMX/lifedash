import './workflow.css';
import './planner.css';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock,
  Calendar,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Undo2,
  Redo2,
  PanelLeftClose,
  PanelLeftOpen,
  ListPlus,
  GripVertical,
  Circle,
  CheckCircle2,
  ExternalLink,
  Repeat,
  Sparkles,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, INBOX_ID } from '../db';
import type { Task } from '../types';
import { webcalEventsToDayBlocks, type WebcalEvent } from '../webcal';
import { addTask, deleteTask, toggleComplete, updateTask } from '../repo';
import { addDays, friendlyDate, parseLocalDate, todayStr, weekdayLabel } from '../dates';
import { PageHeader } from '../components/Page';
import { useAiSettings, loadAiSettings } from '../ai/aiSettings';
import { reviewRequest, requestAdvice } from '../ai/provider';
import { parseAiResponse } from '../ai/proposalParser';
import {
  DAY_MINUTES,
  DEFAULT_SNAP,
  LIFEDASH_PALETTE,
  combineDayBlocks,
  computeTimelineLayout,
  cut,
  fmt,
  fmtD,
  loadRecurringDoneKeys,
  loadRecurringPlans,
  nowMin,
  pad,
  parseTime,
  saveRecurringDoneKeys,
  saveRecurringPlans,
  snap,
  type RecurringPlan,
  type RecurrenceType,
  type ScheduledBlock,
} from '../dayPlanner';
import { planError, validDate, type PlanPatch } from '../planning';
import { RecurringPlanModal } from './planner/RecurringPlanModal';
import { TaskPlanModal } from './planner/TaskPlanModal';
import { PlannerTray } from './planner/PlannerTray';
export { PlanEditor } from './planner/PlanEditor';

export default function PlannerView(props: {
  tasks: Task[];
  onOpen: (id: string) => void;
  onTag?: (tag: string) => void;
  initialSideTab?: 'tasks' | 'recurring';
}) {
  const today = todayStr();
  const [date, setDate] = useState<string>(today);
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');

  // Query projects for color mapping
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const projectColors = useMemo(
    () => new Map(projects.map((p) => [p.id, p.color])),
    [projects]
  );

  // Recurring plans state
  const [recurringPlans, setRecurringPlans] = useState<RecurringPlan[]>(() =>
    loadRecurringPlans()
  );
  const [recurringDoneKeys, setRecurringDoneKeys] = useState<Set<string>>(() =>
    loadRecurringDoneKeys()
  );

  // Settings
  const [snapVal, setSnapVal] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('dp-snap');
      return saved ? Number(saved) : DEFAULT_SNAP;
    } catch {
      return DEFAULT_SNAP;
    }
  });

  const [zoomVal, setZoomVal] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('dp-zoom');
      return saved ? Number(saved) : 44;
    } catch {
      return 44;
    }
  });

  const [trayCollapsed, setTrayCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('dp-side');
      if (saved !== null) return saved === '1';
      return typeof window !== 'undefined' && window.innerWidth <= 820;
    } catch {
      return false;
    }
  });

  const [trayTab, setTrayTab] = useState<'tasks' | 'recurring'>(
    props.initialSideTab || 'tasks'
  );
  const [taskSearch, setTaskSearch] = useState('');

  // Undo / Redo history
  interface HistoryEntry {
    taskId: string;
    prev: {
      plannedDate?: string | null;
      plannedTime?: string | null;
      durationMinutes?: number | null;
      status?: 'active' | 'done' | 'archived';
    };
    next: {
      plannedDate?: string | null;
      plannedTime?: string | null;
      durationMinutes?: number | null;
      status?: 'active' | 'done' | 'archived';
    };
  }
  const hist = useRef<HistoryEntry[]>([]);
  const fut = useRef<HistoryEntry[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Live time ticker
  const [nowMinute, setNowMinute] = useState<number>(() => nowMin());
  useEffect(() => {
    const timer = setInterval(() => setNowMinute(nowMin()), 10000);
    return () => clearInterval(timer);
  }, []);

  // Update zoom CSS property
  useEffect(() => {
    document.documentElement.style.setProperty('--dp-hp', `${zoomVal}px`);
    try {
      localStorage.setItem('dp-zoom', String(zoomVal));
    } catch {
      // ignore
    }
  }, [zoomVal]);

  const toggleTray = () => {
    setTrayCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('dp-side', next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  const updateSnap = (val: number) => {
    setSnapVal(val);
    try {
      localStorage.setItem('dp-snap', String(val));
    } catch {
      // ignore
    }
  };

  // Toast notification
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMsg(null), 5000);
  };

  // Record action for undo
  const recordHistory = (entry: HistoryEntry) => {
    hist.current.push(entry);
    if (hist.current.length > 50) hist.current.shift();
    fut.current = [];
    setCanUndo(true);
    setCanRedo(false);
  };

  const undo = async () => {
    if (!hist.current.length) return;
    const entry = hist.current.pop()!;
    fut.current.push(entry);
    await updateTask(entry.taskId, entry.prev);
    setCanUndo(hist.current.length > 0);
    setCanRedo(true);
    showToast('Plan change undone');
  };

  const redo = async () => {
    if (!fut.current.length) return;
    const entry = fut.current.pop()!;
    hist.current.push(entry);
    await updateTask(entry.taskId, entry.next);
    setCanUndo(true);
    setCanRedo(fut.current.length > 0);
    showToast('Plan change redone');
  };

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        !(e.ctrlKey || e.metaKey) ||
        /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName)
      ) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) void redo();
        else void undo();
      } else if (k === 'y') {
        e.preventDefault();
        void redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Toggle recurring block completion for a specific date
  const toggleRecurringDone = (planId: string, dateStr: string) => {
    const key = `${planId}:${dateStr}`;
    setRecurringDoneKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveRecurringDoneKeys(next);
      return next;
    });
  };

  // Webcal external calendar events
  const webcalMeta = useLiveQuery(() => db.syncmeta.get('webcal.eventsCache'), []);
  const webcalEvents = useMemo(
    () => (webcalMeta?.value as WebcalEvent[] | undefined) ?? [],
    [webcalMeta]
  );

  // Scheduled blocks for the selected day (tasks + recurring + webcal)
  const scheduledBlocks = useMemo(() => {
    const base = combineDayBlocks(
      props.tasks,
      recurringPlans,
      recurringDoneKeys,
      date,
      projectColors
    );
    const webcal = webcalEventsToDayBlocks(webcalEvents, date);
    return [...base, ...webcal];
  }, [props.tasks, recurringPlans, recurringDoneKeys, date, projectColors, webcalEvents]);

  const timelineLayout = useMemo(() => {
    return computeTimelineLayout(scheduledBlocks);
  }, [scheduledBlocks]);


  // 7 days of the current week (Monday through Sunday)
  const weekDays = useMemo(() => {
    const d = parseLocalDate(date);
    const dow = (d.getDay() + 6) % 7; // Mon = 0
    const monday = addDays(date, -dow);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [date]);

  // Active tasks for the left tray (not yet scheduled on this date)
  const unscheduledTasks = useMemo(() => {
    return props.tasks
      .filter((t) => {
        if (t.status !== 'active' || t.parentId !== null) return false;
        const isScheduledToday =
          t.plannedDate === date && t.plannedTime && /^\d{2}:\d{2}$/.test(t.plannedTime);
        return !isScheduledToday;
      })
      .filter(
        (t) =>
          !taskSearch ||
          t.title.toLowerCase().includes(taskSearch.toLowerCase()) ||
          t.tags.some((tag) => tag.toLowerCase().includes(taskSearch.toLowerCase()))
      )
      .sort((a, b) => {
        if (a.dueDate === date && b.dueDate !== date) return -1;
        if (b.dueDate === date && a.dueDate !== date) return 1;
        if (a.priority !== b.priority) return (b.priority || 0) - (a.priority || 0);
        return a.order - b.order;
      });
  }, [props.tasks, date, taskSearch]);

  // Drag payload state
  const dragPayload = useRef<{
    type: 'task' | 'recurring' | 'block';
    id: string;
    offY?: number;
  } | null>(null);

  // Modals state
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editingRecurring, setEditingRecurring] = useState<RecurringPlan | null>(null);

  // Drag-to-create rubberband
  const [rubberband, setRubberband] = useState<{ start: number; dur: number; targetDate: string } | null>(null);

  const handleTrackPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    targetDate: string
  ) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.planner-block')) return;

    const track = e.currentTarget;
    const rect = track.getBoundingClientRect();
    const toM = (clientY: number) =>
      Math.max(0, Math.min(DAY_MINUTES, ((clientY - rect.top) / rect.height) * DAY_MINUTES));

    const initialMinutes = Math.min(
      DAY_MINUTES - snapVal,
      Math.floor(toM(e.clientY) / snapVal) * snapVal
    );

    let currentStart = initialMinutes;
    let currentDur = snapVal;
    setRubberband({ start: currentStart, dur: currentDur, targetDate });

    const handlePointerMove = (ev: PointerEvent) => {
      const m = toM(ev.clientY);
      if (m >= initialMinutes) {
        currentStart = initialMinutes;
        currentDur = Math.max(snapVal, Math.ceil((m - initialMinutes) / snapVal) * snapVal);
      } else {
        currentStart = Math.floor(m / snapVal) * snapVal;
        currentDur = Math.max(snapVal, initialMinutes + snapVal - currentStart);
      }
      currentDur = Math.min(currentDur, DAY_MINUTES - currentStart);
      setRubberband({ start: currentStart, dur: currentDur, targetDate });
    };

    const handlePointerUp = async (ev: PointerEvent) => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      setRubberband(null);

      if (ev.type === 'pointercancel') return;

      let finalDur = currentDur;
      let finalStart = currentStart;
      if (finalDur <= snapVal) {
        finalDur = 60;
        finalStart = Math.min(finalStart, DAY_MINUTES - 60);
      }

      const created = await addTask({
        title: 'New work block',
        projectId: INBOX_ID,
      });

      await updateTask(created.id, {
        plannedDate: targetDate,
        plannedTime: fmt(finalStart),
        durationMinutes: finalDur,
      });

      recordHistory({
        taskId: created.id,
        prev: { plannedDate: null, plannedTime: null, durationMinutes: null },
        next: { plannedDate: targetDate, plannedTime: fmt(finalStart), durationMinutes: finalDur },
      });

      setEditingTask({
        ...created,
        plannedDate: targetDate,
        plannedTime: fmt(finalStart),
        durationMinutes: finalDur,
      });
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  // Block duration resize via bottom edge handle
  const handleResizePointerDown = (
    e: React.PointerEvent,
    task: Task,
    initialDur: number
  ) => {
    e.stopPropagation();
    const track = (e.target as HTMLElement).closest('.planner-track');
    if (!track) return;

    const trackHeight = track.getBoundingClientRect().height;
    const startY = e.clientY;
    let finalDur = initialDur;

    const handlePointerMove = (ev: PointerEvent) => {
      const deltaY = ev.clientY - startY;
      const deltaMinutes = (deltaY / trackHeight) * DAY_MINUTES;
      finalDur = Math.max(snapVal, Math.min(DAY_MINUTES, snap(initialDur + deltaMinutes, snapVal)));

      const card = (e.target as HTMLElement).closest('.planner-block') as HTMLElement;
      if (card) {
        const heightPct = (finalDur / DAY_MINUTES) * 100;
        card.style.height = `calc(${heightPct}% - 1px)`;
        const timeSpan = card.querySelector('.planner-block-time');
        if (timeSpan && task.plannedTime) {
          const s = parseTime(task.plannedTime);
          timeSpan.textContent = `${fmt(s)} – ${fmt(s + finalDur)} (${fmtD(finalDur)})`;
        }
      }
    };

    const handlePointerUp = async () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);

      if (finalDur !== initialDur) {
        await updateTask(task.id, { durationMinutes: finalDur });
        recordHistory({
          taskId: task.id,
          prev: { durationMinutes: initialDur },
          next: { durationMinutes: finalDur },
        });
        showToast(`Duration set to ${fmtD(finalDur)}`);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  // Drop onto timeline track (Day or Week)
  const handleTrackDrop = async (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const payload = dragPayload.current;
    if (!payload) return;

    const track = e.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    const offsetY = payload.offY || 0;
    const rawMinutes = ((e.clientY - rect.top - offsetY) / rect.height) * DAY_MINUTES;
    const clampedStart = Math.max(0, Math.min(DAY_MINUTES - snapVal, snap(rawMinutes, snapVal)));

    if (payload.type === 'task') {
      const task = props.tasks.find((t) => t.id === payload.id);
      if (!task) return;
      const dur = task.durationMinutes && task.durationMinutes >= 1 ? task.durationMinutes : 45;
      await updateTask(task.id, {
        plannedDate: targetDate,
        plannedTime: fmt(clampedStart),
        durationMinutes: dur,
      });
      recordHistory({
        taskId: task.id,
        prev: {
          plannedDate: task.plannedDate,
          plannedTime: task.plannedTime,
          durationMinutes: task.durationMinutes,
        },
        next: { plannedDate: targetDate, plannedTime: fmt(clampedStart), durationMinutes: dur },
      });
      showToast(`Scheduled "${task.title}" on ${friendlyDate(targetDate, today)} at ${fmt(clampedStart)}`);
    } else if (payload.type === 'recurring') {
      const plan = recurringPlans.find((r) => r.id === payload.id);
      if (!plan) return;
      const created = await addTask({
        title: plan.title,
        projectId: INBOX_ID,
        tags: ['routine'],
      });
      await updateTask(created.id, {
        plannedDate: targetDate,
        plannedTime: fmt(clampedStart),
        durationMinutes: plan.durationMinutes,
      });
      showToast(`Added "${plan.title}" on ${friendlyDate(targetDate, today)} at ${fmt(clampedStart)}`);
    } else if (payload.type === 'block') {
      const task = props.tasks.find((t) => t.id === payload.id);
      if (!task) return;
      const prevTime = task.plannedTime;
      const prevDate = task.plannedDate;
      await updateTask(task.id, {
        plannedDate: targetDate,
        plannedTime: fmt(clampedStart),
      });
      recordHistory({
        taskId: task.id,
        prev: { plannedDate: prevDate, plannedTime: prevTime },
        next: { plannedDate: targetDate, plannedTime: fmt(clampedStart) },
      });
    }

    dragPayload.current = null;
  };


  // Quick schedule task at next free slot
  const handleQuickSchedule = async (task: Task) => {
    const dur = task.durationMinutes && task.durationMinutes >= 1 ? task.durationMinutes : 45;
    let targetMin = Math.ceil(nowMinute / snapVal) * snapVal;
    if (scheduledBlocks.length > 0) {
      const maxEnd = Math.max(...scheduledBlocks.map((b) => b.start + b.dur));
      targetMin = Math.max(targetMin, maxEnd);
    }
    targetMin = Math.min(DAY_MINUTES - snapVal, targetMin);

    await updateTask(task.id, {
      plannedDate: date,
      plannedTime: fmt(targetMin),
      durationMinutes: dur,
    });
    recordHistory({
      taskId: task.id,
      prev: {
        plannedDate: task.plannedDate,
        plannedTime: task.plannedTime,
        durationMinutes: task.durationMinutes,
      },
      next: { plannedDate: date, plannedTime: fmt(targetMin), durationMinutes: dur },
    });
    showToast(`Scheduled "${task.title}" at ${fmt(targetMin)}`);
  };

  // AI Day Plan state & handler
  const aiSettings = useAiSettings();
  const [aiPlanOpen, setAiPlanOpen] = useState(false);
  const [aiPlanLoading, setAiPlanLoading] = useState(false);
  const [aiPlanItems, setAiPlanItems] = useState<{ taskId: string; title: string; time: string; durationMinutes: number }[]>([]);
  const [selectedAiPlan, setSelectedAiPlan] = useState<Record<string, boolean>>({});

  const handleAiDayPlan = async () => {
    if (unscheduledTasks.length === 0) {
      showToast('All active tasks are already scheduled.');
      return;
    }
    setAiPlanOpen(true);
    setAiPlanLoading(true);

    try {
      const s = loadAiSettings();
      if (s.baseUrl && s.model) {
        const taskList = unscheduledTasks.slice(0, 8).map((t) => ({ id: t.id, title: t.title, priority: t.priority, est: t.durationMinutes || 45 }));
        const existing = scheduledBlocks.map((b) => ({ time: fmt(b.start), dur: b.dur, title: b.title }));
        const prompt = `Schedule these tasks for today (${date}) around existing commitments (${JSON.stringify(existing)}). Output JSON: \`\`\`json\n{ "action": "schedule", "items": [{ "taskId": "id", "title": "title", "date": "${date}", "time": "HH:MM", "durationMinutes": 45 }] }\n\`\`\``;
        const reviewed = reviewRequest({ baseUrl: s.baseUrl, model: s.model, apiKey: s.apiKey }, prompt, JSON.stringify(taskList));
        const raw = await requestAdvice({ baseUrl: s.baseUrl, model: s.model, apiKey: s.apiKey }, reviewed, true);
        const parsed = parseAiResponse(raw);
        const sch = parsed.proposals.find((p) => p.action === 'schedule');
        if (sch && sch.items.length > 0) {
          const items = sch.items.map((it) => ({
            taskId: it.taskId,
            title: it.title || unscheduledTasks.find((t) => t.id === it.taskId)?.title || 'Task',
            time: it.time,
            durationMinutes: it.durationMinutes || 45,
          }));
          setAiPlanItems(items);
          const map: Record<string, boolean> = {};
          items.forEach((it) => (map[it.taskId] = true));
          setSelectedAiPlan(map);
          setAiPlanLoading(false);
          return;
        }
      }
    } catch {
      // Fallback to heuristic allocation below
    }

    let cur = Math.max(9 * 60, Math.ceil(nowMinute / snapVal) * snapVal);
    const items: { taskId: string; title: string; time: string; durationMinutes: number }[] = [];
    const map: Record<string, boolean> = {};

    for (const t of unscheduledTasks.slice(0, 6)) {
      const dur = t.durationMinutes && t.durationMinutes >= 1 ? t.durationMinutes : 45;
      while (scheduledBlocks.some((b) => cur < b.start + b.dur && cur + dur > b.start)) {
        const overlap = scheduledBlocks.find((b) => cur < b.start + b.dur && cur + dur > b.start);
        if (overlap) cur = overlap.start + overlap.dur;
      }
      if (cur + dur > DAY_MINUTES - snapVal) break;
      items.push({ taskId: t.id, title: t.title, time: fmt(cur), durationMinutes: dur });
      map[t.id] = true;
      cur += dur + snapVal;
    }

    setAiPlanItems(items);
    setSelectedAiPlan(map);
    setAiPlanLoading(false);
  };

  const handleApplyAiPlan = async () => {
    let count = 0;
    for (const item of aiPlanItems) {
      if (selectedAiPlan[item.taskId]) {
        await updateTask(item.taskId, {
          plannedDate: date,
          plannedTime: item.time,
          durationMinutes: item.durationMinutes,
        });
        count++;
      }
    }
    showToast(`Scheduled ${count} task${count === 1 ? '' : 's'} on timeline.`);
    setAiPlanOpen(false);
    setAiPlanItems([]);
  };

  // Save updated recurring plan
  const handleSaveRecurringPlan = (updated: RecurringPlan) => {
    setRecurringPlans((prev) => {
      const idx = prev.findIndex((p) => p.id === updated.id);
      const next = idx >= 0 ? [...prev] : [...prev, updated];
      if (idx >= 0) next[idx] = updated;
      saveRecurringPlans(next);
      return next;
    });
    setEditingRecurring(null);
    showToast(`Saved recurring plan "${updated.title}"`);
  };

  const handleDeleteRecurringPlan = (id: string) => {
    setRecurringPlans((prev) => {
      const next = prev.filter((p) => p.id !== id);
      saveRecurringPlans(next);
      return next;
    });
    setEditingRecurring(null);
    showToast('Recurring plan removed');
  };

  return (
    <section className="lifedash-planner page-planning">
      {/* Lifedash PageHeader */}
      <PageHeader
        eyebrow="Plan · Daily & weekly time blocking"
        title="Planner"
        meta={`${friendlyDate(date, today)} · ${weekdayLabel(date)}`}
        description="Visual 24-hour time blocking, recurring routines, and circular clock. Drag tasks to plan your week."
        actions={
          <div className="planner-header-actions">
            <div className="planner-header-actions-row">
              {/* Day navigation */}
              <span className="planner-nav-group">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Previous day"
                  title="Previous day"
                  onClick={() => setDate(addDays(date, viewMode === 'week' ? -7 : -1))}
                >
                  <ChevronLeft size={16} strokeWidth={2} />
                </button>
                {date !== today && (
                  <button
                    type="button"
                    className="mini"
                    onClick={() => setDate(today)}
                  >
                    Today
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Next day"
                  title="Next day"
                  onClick={() => setDate(addDays(date, viewMode === 'week' ? 7 : 1))}
                >
                  <ChevronRight size={16} strokeWidth={2} />
                </button>
                <input
                  type="date"
                  className="planner-date-input"
                  aria-label="Planner date"
                  value={date}
                  onChange={(e) => {
                    if (validDate(e.target.value)) setDate(e.target.value);
                  }}
                />
              </span>

              {/* Undo / Redo */}
              <div className="planner-history-group">
                <button
                  type="button"
                  className="icon-btn"
                  disabled={!canUndo}
                  onClick={() => void undo()}
                  title="Undo (Ctrl+Z)"
                >
                  <Undo2 size={16} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={!canRedo}
                  onClick={() => void redo()}
                  title="Redo (Ctrl+Shift+Z)"
                >
                  <Redo2 size={16} strokeWidth={2} />
                </button>
              </div>
            </div>

            {/* View Mode Switcher: Day, Week, Circle */}
            <div className="planner-segmented">
              <button
                type="button"
                className={`planner-segmented-btn ${viewMode === 'day' ? 'active' : ''}`}
                onClick={() => setViewMode('day')}
              >
                <Clock size={15} />
                <span>Day</span>
              </button>
              <button
                type="button"
                className={`planner-segmented-btn ${viewMode === 'week' ? 'active' : ''}`}
                onClick={() => setViewMode('week')}
              >
                <CalendarRange size={15} />
                <span>Week</span>
              </button>
            </div>
          </div>
        }
      />

      {/* Capacity & Summary Bar */}
      <div className="planner-summary-bar">
        <div className="planner-summary-stats">
          <span>
            <strong>{fmtD(timelineLayout.totalPlannedMinutes)}</strong> planned
          </span>
          <span>·</span>
          <span>
            <strong>{fmtD(timelineLayout.freeMinutes)}</strong> free
          </span>
          <span>·</span>
          <span>
            {timelineLayout.doneCount} of {scheduledBlocks.length} completed
          </span>
          {timelineLayout.hasOverlap && (
            <span className="planner-stat-pill overlap">⚠ Overlaps detected</span>
          )}
        </div>

        <div className="planner-summary-controls">
          {aiSettings.enabled && (
            <button
              type="button"
              className="planner-ai-btn mini"
              onClick={() => void handleAiDayPlan()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
                fontSize: 12,
                borderRadius: 6,
                background: 'var(--surface-2, #f0f0eb)',
                border: '1px solid var(--control, #d2d2cb)',
                cursor: 'pointer',
                color: 'var(--text, #17202a)',
              }}
              title="Auto-plan day schedule with AI"
            >
              <Sparkles size={13} color="var(--accent, #0f766e)" />
              <span>AI Plan</span>
            </button>
          )}
          <label>
            Zoom
            <input
              type="range"
              min="30"
              max="80"
              value={zoomVal}
              onChange={(e) => setZoomVal(Number(e.target.value))}
            />
          </label>
          <label>
            Snap
            <select
              value={snapVal}
              onChange={(e) => updateSnap(Number(e.target.value))}
            >
              <option value={5}>5m</option>
              <option value={15}>15m</option>
              <option value={30}>30m</option>
            </select>
          </label>
        </div>
      </div>

      {/* Main Layout: Tray + Canvas */}
      <div className="planner-layout">
        {/* Left Tray: Tasks to Plan & Recurring Plans */}
        <PlannerTray
          trayCollapsed={trayCollapsed}
          toggleTray={toggleTray}
          trayTab={trayTab}
          setTrayTab={setTrayTab}
          unscheduledTasks={unscheduledTasks}
          recurringPlans={recurringPlans}
          taskSearch={taskSearch}
          setTaskSearch={setTaskSearch}
          projectColors={projectColors}
          date={date}
          dragPayload={dragPayload}
          handleQuickSchedule={handleQuickSchedule}
          setEditingRecurring={setEditingRecurring}
        />

        {/* Right Canvas: Day, Week, or Circle */}
        <main className="planner-canvas">
          {viewMode === 'day' ? (
            /* Single Day Timeline */
            <div className="planner-timeline-wrapper planner-day-timeline">
              <div className="planner-time-axis">
                {Array.from({ length: 24 }, (_, i) => (
                  <span
                    key={i}
                    className="planner-axis-hour"
                    style={{ top: `${(i / 24) * 100}%` }}
                  >
                    {pad(i)}:00
                  </span>
                ))}
                {date === today && (
                  <span
                    className="planner-axis-now-pill"
                    style={{ top: `${(nowMinute / DAY_MINUTES) * 100}%` }}
                  >
                    {fmt(nowMinute)}
                  </span>
                )}
              </div>

              <div
                className="planner-track"
                onPointerDown={(e) => handleTrackPointerDown(e, date)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.add('drag-over');
                }}
                onDragLeave={(e) => {
                  e.currentTarget.classList.remove('drag-over');
                }}
                onDrop={(e) => handleTrackDrop(e, date)}
              >
                {date === today && (
                  <div
                    className="planner-now-line"
                    style={{ top: `${(nowMinute / DAY_MINUTES) * 100}%` }}
                  />
                )}

                {timelineLayout.segments.map((seg, idx) => {
                  const b = seg.b;
                  const task = b.rawTask;
                  const timeRange = `${fmt(b.start)} – ${fmt(b.start + b.dur)}`;
                  const topPct = (seg.s / DAY_MINUTES) * 100;
                  const heightPct = ((seg.e - seg.s) / DAY_MINUTES) * 100;
                  const leftCalc = `calc(${(seg.i / seg.n) * 100}% + 2px)`;
                  const widthCalc = `calc(${100 / seg.n}% - 4px)`;

                  return (
                    <div
                      key={`${b.id}:${idx}`}
                      className={`planner-block ${seg.cont ? 'continuation' : ''} ${
                        b.done ? 'done' : ''
                      } ${seg.n > 1 ? 'overlap' : ''} ${b.isRecurring ? 'is-recurring' : ''} ${
                        b.id.startsWith('webcal-') ? 'is-webcal' : ''
                      }`}
                      draggable={!seg.cont && !b.isRecurring && !b.id.startsWith('webcal-')}
                      onDragStart={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        dragPayload.current = {
                          type: 'block',
                          id: b.id,
                          offY: e.clientY - rect.top,
                        };
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', b.title);
                      }}
                      onDragEnd={() => {
                        dragPayload.current = null;
                      }}
                      onClick={() => {
                        if (task) setEditingTask(task);
                        else if (b.recurringPlanId) {
                          const plan = recurringPlans.find((p) => p.id === b.recurringPlanId);
                          if (plan) setEditingRecurring(plan);
                        }
                      }}
                      title={`${b.title} (${timeRange})${b.isRecurring ? ' [Recurring]' : ''}`}
                      style={{
                        top: `${topPct}%`,
                        height: `calc(${heightPct}% - 1px)`,
                        left: leftCalc,
                        width: widthCalc,
                        borderLeftColor: b.color,
                      }}
                    >
                      <div className="planner-block-head">
                        {b.id.startsWith('webcal-') ? (
                          <span
                            title="Calendar event"
                            style={{ display: 'inline-flex', alignItems: 'center', opacity: 0.75, marginRight: 4 }}
                          >
                            <Calendar size={13} aria-hidden="true" />
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={`planner-block-check ${b.done ? 'checked' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (task) void toggleComplete(task);
                              else if (b.recurringPlanId) toggleRecurringDone(b.recurringPlanId, date);
                            }}
                            title={b.done ? 'Mark open' : 'Mark completed'}
                          >
                            {b.done ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                          </button>
                        )}
                        <span className="planner-block-title">{b.title}</span>
                        {b.isRecurring && (
                          <span className="planner-block-badge">
                            <Repeat size={10} />
                          </span>
                        )}
                      </div>
                      <span className="planner-block-time">
                        {timeRange} ({fmtD(b.dur)})
                      </span>
                      {seg.last && task && (
                        <i
                          className="planner-resize-handle"
                          onPointerDown={(e) => handleResizePointerDown(e, task, b.dur)}
                          title="Drag to resize duration"
                        />
                      )}
                    </div>
                  );
                })}

                {rubberband && rubberband.targetDate === date && (
                  <div
                    className="planner-rubberband"
                    style={{
                      top: `${(rubberband.start / DAY_MINUTES) * 100}%`,
                      height: `${(rubberband.dur / DAY_MINUTES) * 100}%`,
                    }}
                  >
                    {fmt(rubberband.start)} – {fmt(rubberband.start + rubberband.dur)}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* 7-Day Multi-Day Week Board */
            <div className="planner-timeline-wrapper planner-week-timeline">
              <div className="planner-time-axis">
                {Array.from({ length: 24 }, (_, i) => (
                  <span
                    key={i}
                    className="planner-axis-hour"
                    style={{ top: `${(i / 24) * 100}%` }}
                  >
                    {pad(i)}:00
                  </span>
                ))}
              </div>

              <div className="planner-week-board">
                {weekDays.map((dStr) => {
                  const dayBlocks = [
                    ...combineDayBlocks(
                      props.tasks,
                      recurringPlans,
                      recurringDoneKeys,
                      dStr,
                      projectColors
                    ),
                    ...webcalEventsToDayBlocks(webcalEvents, dStr),
                  ];
                  const dayLayout = computeTimelineLayout(dayBlocks);
                  const isTodayCol = dStr === today;
                  const isSelectedCol = dStr === date;
                  const donePct = dayBlocks.length
                    ? (dayLayout.doneCount / dayBlocks.length) * 100
                    : 0;

                  return (
                    <div
                      key={dStr}
                      className={`planner-week-day-col ${isSelectedCol ? 'selected' : ''}`}
                      onClick={() => setDate(dStr)}
                    >
                      <div className="planner-week-day-head">
                        <div className={`planner-week-day-name ${isTodayCol ? 'is-today' : ''}`}>
                          <span>{weekdayLabel(dStr)}</span>
                          <span>{parseLocalDate(dStr).getDate()}</span>
                        </div>
                        <div className="planner-week-day-meta">
                          {fmtD(dayLayout.totalPlannedMinutes)} planned
                        </div>
                        <div className="planner-week-day-pb">
                          <i style={{ width: `${donePct}%` }} />
                        </div>
                      </div>

                      <div
                        className="planner-track"
                        onPointerDown={(e) => handleTrackPointerDown(e, dStr)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.currentTarget.classList.add('drag-over');
                        }}
                        onDragLeave={(e) => {
                          e.currentTarget.classList.remove('drag-over');
                        }}
                        onDrop={(e) => handleTrackDrop(e, dStr)}
                      >
                        {isTodayCol && (
                          <div
                            className="planner-now-line"
                            style={{ top: `${(nowMinute / DAY_MINUTES) * 100}%` }}
                          />
                        )}

                        {dayLayout.segments.map((seg, idx) => {
                          const b = seg.b;
                          const task = b.rawTask;
                          const topPct = (seg.s / DAY_MINUTES) * 100;
                          const heightPct = ((seg.e - seg.s) / DAY_MINUTES) * 100;
                          const leftCalc = `calc(${(seg.i / seg.n) * 100}% + 1px)`;
                          const widthCalc = `calc(${100 / seg.n}% - 2px)`;

                          return (
                            <div
                              key={`${b.id}:${idx}`}
                              className={`planner-block ${seg.cont ? 'continuation' : ''} ${
                                b.done ? 'done' : ''
                              } ${seg.n > 1 ? 'overlap' : ''} ${b.isRecurring ? 'is-recurring' : ''} ${
                                b.id.startsWith('webcal-') ? 'is-webcal' : ''
                              }`}
                              draggable={!seg.cont && !b.isRecurring && !b.id.startsWith('webcal-')}
                              onDragStart={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                dragPayload.current = {
                                  type: 'block',
                                  id: b.id,
                                  offY: e.clientY - rect.top,
                                };
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', b.title);
                              }}
                              onDragEnd={() => {
                                dragPayload.current = null;
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (task) setEditingTask(task);
                                else if (b.recurringPlanId) {
                                  const plan = recurringPlans.find((p) => p.id === b.recurringPlanId);
                                  if (plan) setEditingRecurring(plan);
                                }
                              }}
                              title={`${b.title} (${fmt(b.start)}–${fmt(b.start + b.dur)})`}
                              style={{
                                top: `${topPct}%`,
                                height: `calc(${heightPct}% - 1px)`,
                                left: leftCalc,
                                width: widthCalc,
                                borderLeftColor: b.color,
                              }}
                            >
                              <div className="planner-block-head">
                                {b.id.startsWith('webcal-') ? (
                                  <span
                                    title="Calendar event"
                                    style={{ display: 'inline-flex', alignItems: 'center', opacity: 0.75, marginRight: 2 }}
                                  >
                                    <Calendar size={11} aria-hidden="true" />
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className={`planner-block-check ${b.done ? 'checked' : ''}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (task) void toggleComplete(task);
                                      else if (b.recurringPlanId) toggleRecurringDone(b.recurringPlanId, dStr);
                                    }}
                                  >
                                    {b.done ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                                  </button>
                                )}
                                <span className="planner-block-title">{b.title}</span>
                              </div>
                            </div>
                          );
                        })}

                        {rubberband && rubberband.targetDate === dStr && (
                          <div
                            className="planner-rubberband"
                            style={{
                              top: `${(rubberband.start / DAY_MINUTES) * 100}%`,
                              height: `${(rubberband.dur / DAY_MINUTES) * 100}%`,
                            }}
                          >
                            {fmt(rubberband.start)}–{fmt(rubberband.start + rubberband.dur)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Task Plan Modal */}
      {editingTask && (
        <TaskPlanModal
          task={editingTask}
          date={date}
          onClose={() => setEditingTask(null)}
          onOpenDetail={() => {
            props.onOpen(editingTask.id);
            setEditingTask(null);
          }}
          onSave={async (patch) => {
            await updateTask(editingTask.id, patch);
            setEditingTask(null);
            showToast(`Updated "${editingTask.title}"`);
          }}
          onUnschedule={async () => {
            await updateTask(editingTask.id, {
              plannedDate: null,
              plannedTime: null,
            });
            setEditingTask(null);
            showToast(`Unscheduled "${editingTask.title}"`);
          }}
          onDelete={async () => {
            await deleteTask(editingTask);
            setEditingTask(null);
            showToast(`Deleted "${editingTask.title}"`);
          }}
        />
      )}

      {/* Recurring Plan Editor Modal */}
      {editingRecurring && (
        <RecurringPlanModal
          plan={editingRecurring}
          onClose={() => setEditingRecurring(null)}
          onSave={handleSaveRecurringPlan}
          onDelete={handleDeleteRecurringPlan}
        />
      )}

      {/* AI Day Plan Modal */}
      {aiSettings.enabled && aiPlanOpen && (
        <div
          className="planner-modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setAiPlanOpen(false)}
        >
          <div
            className="planner-ai-modal"
            style={{
              background: 'var(--surface, #fff)',
              color: 'var(--text, #17202a)',
              border: '1px solid var(--border, #cad1d7)',
              borderRadius: 12,
              padding: 20,
              width: 'min(500px, 90vw)',
              maxHeight: '80vh',
              overflow: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={16} color="var(--accent, #0f766e)" />
                AI Day Schedule Proposal
              </h3>
              <button type="button" className="mini" onClick={() => setAiPlanOpen(false)}>
                ✕
              </button>
            </div>
            <p style={{ fontSize: 12, opacity: 0.8, margin: '0 0 14px' }}>
              Review proposed time slots for {friendlyDate(date, today)}. Uncheck any you do not want to schedule.
            </p>

            {aiPlanLoading ? (
              <p style={{ fontSize: 13, color: 'var(--muted, #64748b)' }}>Generating schedule around commitments…</p>
            ) : aiPlanItems.length === 0 ? (
              <p style={{ fontSize: 13 }}>No available time slots found for today.</p>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  {aiPlanItems.map((item) => (
                    <label
                      key={item.taskId}
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 8,
                        fontSize: 13,
                        cursor: 'pointer',
                        padding: '6px 8px',
                        background: 'var(--surface-2, #f8fafc)',
                        borderRadius: 6,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedAiPlan[item.taskId] ?? false}
                        onChange={(e) =>
                          setSelectedAiPlan((prev) => ({ ...prev, [item.taskId]: e.target.checked }))
                        }
                      />
                      <span>
                        <strong>{item.time}</strong> — {item.title} ({item.durationMinutes}m)
                      </span>
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button type="button" className="mini" onClick={() => setAiPlanOpen(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!Object.values(selectedAiPlan).some(Boolean)}
                    onClick={() => void handleApplyAiPlan()}
                  >
                    Apply Schedule to Timeline
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMsg && (
        <div className="planner-toast" role="status">
          <span>{toastMsg}</span>
          <button
            type="button"
            className="planner-toast-btn"
            onClick={() => {
              void undo();
              setToastMsg(null);
            }}
          >
            Undo
          </button>
        </div>
      )}
    </section>
  );
}
