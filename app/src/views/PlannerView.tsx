import './workflow.css';
import './planner.css';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock,
  CalendarRange,
  CircleDot,
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
  computeCircleLayout,
  computeTimelineLayout,
  cut,
  fmt,
  fmtD,
  loadRecurringDoneKeys,
  loadRecurringPlans,
  nowMin,
  pad,
  parseTime,
  polarToCartesian,
  saveRecurringDoneKeys,
  saveRecurringPlans,
  snap,
  type RecurringPlan,
  type RecurrenceType,
  type ScheduledBlock,
} from '../dayPlanner';
import { planError, validDate, type PlanPatch } from '../planning';

export default function PlannerView(props: {
  tasks: Task[];
  onOpen: (id: string) => void;
  onTag?: (tag: string) => void;
  initialSideTab?: 'tasks' | 'recurring';
}) {
  const today = todayStr();
  const [date, setDate] = useState<string>(today);
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'circle'>('day');

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

  // Scheduled blocks for the selected day (tasks + recurring)
  const scheduledBlocks = useMemo(() => {
    return combineDayBlocks(
      props.tasks,
      recurringPlans,
      recurringDoneKeys,
      date,
      projectColors
    );
  }, [props.tasks, recurringPlans, recurringDoneKeys, date, projectColors]);

  const timelineLayout = useMemo(() => {
    return computeTimelineLayout(scheduledBlocks);
  }, [scheduledBlocks]);

  const circleLayout = useMemo(() => {
    return computeCircleLayout(scheduledBlocks, nowMinute);
  }, [scheduledBlocks, nowMinute]);

  const [nx, ny] = polarToCartesian(260, 260, 226, nowMinute);

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

  // Drop onto 24-hour Circle
  const handleCircleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const payload = dragPayload.current;
    if (!payload) return;

    const svg = (e.target as HTMLElement).closest('.planner-circle-svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);

    let m = (Math.atan2(dx, -dy) / (2 * Math.PI)) * DAY_MINUTES;
    if (m < 0) m += DAY_MINUTES;
    const clampedStart = Math.max(0, Math.min(DAY_MINUTES - snapVal, snap(m, snapVal)));

    if (payload.type === 'task') {
      const task = props.tasks.find((t) => t.id === payload.id);
      if (!task) return;
      const dur = task.durationMinutes && task.durationMinutes >= 1 ? task.durationMinutes : 45;
      await updateTask(task.id, {
        plannedDate: date,
        plannedTime: fmt(clampedStart),
        durationMinutes: dur,
      });
      showToast(`Scheduled "${task.title}" at ${fmt(clampedStart)}`);
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
              <button
                type="button"
                className={`planner-segmented-btn ${viewMode === 'circle' ? 'active' : ''}`}
                onClick={() => setViewMode('circle')}
              >
                <CircleDot size={15} />
                <span>24h Circle</span>
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
        <aside className={`planner-tray ${trayCollapsed ? 'collapsed' : ''}`}>
          <div
            className="planner-tray-head"
            onClick={trayCollapsed ? toggleTray : undefined}
            role={trayCollapsed ? 'button' : undefined}
            tabIndex={trayCollapsed ? 0 : undefined}
            aria-label={trayCollapsed ? 'Expand tasks to plan' : undefined}
            onKeyDown={
              trayCollapsed
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleTray();
                    }
                  }
                : undefined
            }
          >
            <h2 className="planner-tray-title">
              {trayCollapsed ? (
                <span className="planner-tray-collapsed-label">
                  <ListPlus size={15} aria-hidden="true" />
                  <span>Tasks to Plan ({unscheduledTasks.length})</span>
                </span>
              ) : (
                trayTab === 'tasks' ? 'Tasks to Plan' : 'Recurring Plans'
              )}
            </h2>
            <button
              type="button"
              className="icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                toggleTray();
              }}
              title={trayCollapsed ? 'Expand planning tray' : 'Collapse planning tray'}
            >
              {trayCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>

          {!trayCollapsed && (
            <>
              {/* Tab Selector */}
              <div className="planner-tray-tabs">
                <button
                  type="button"
                  className={`planner-tray-tab-btn ${trayTab === 'tasks' ? 'active' : ''}`}
                  onClick={() => setTrayTab('tasks')}
                >
                  Tasks ({unscheduledTasks.length})
                </button>
                <button
                  type="button"
                  className={`planner-tray-tab-btn ${trayTab === 'recurring' ? 'active' : ''}`}
                  onClick={() => setTrayTab('recurring')}
                >
                  Recurring ({recurringPlans.length})
                </button>
              </div>

              {trayTab === 'tasks' ? (
                <>
                  <input
                    type="text"
                    className="planner-tray-search"
                    placeholder="Search tasks to plan…"
                    value={taskSearch}
                    onChange={(e) => setTaskSearch(e.target.value)}
                  />
                  <div className="planner-tray-list">
                    {unscheduledTasks.map((t) => {
                      const color =
                        projectColors.get(t.projectId) ||
                        (t.priority === 1
                          ? '#dc2626'
                          : t.priority === 2
                          ? '#d97706'
                          : '#0f766e');
                      return (
                        <div
                          key={t.id}
                          className="planner-tray-card"
                          draggable
                          onDragStart={(e) => {
                            dragPayload.current = { type: 'task', id: t.id };
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', t.title);
                          }}
                          onDragEnd={() => {
                            dragPayload.current = null;
                          }}
                        >
                          <GripVertical size={13} className="planner-card-grip" />
                          <span
                            className="planner-card-color"
                            style={{ background: color }}
                          />
                          <div className="planner-card-info">
                            <div className="planner-card-title">{t.title}</div>
                            <div className="planner-card-meta">
                              {t.dueDate === date
                                ? 'Due today'
                                : t.dueDate
                                ? `Due ${t.dueDate}`
                                : 'No deadline'}
                              {t.durationMinutes ? ` · ${fmtD(t.durationMinutes)}` : ''}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="planner-card-add-btn"
                            title="Schedule at next slot"
                            onClick={() => void handleQuickSchedule(t)}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      );
                    })}
                    {!unscheduledTasks.length && (
                      <p className="workflow-hint" style={{ margin: '16px 0', textAlign: 'center' }}>
                        No waiting tasks. All set!
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* Recurring Plans List */}
                  <button
                    type="button"
                    className="btn-secondary planner-tray-add-header-btn"
                    onClick={() => {
                      setEditingRecurring({
                        id: `rec-${Date.now()}`,
                        title: '',
                        color: '#0f766e',
                        startTime: '09:00',
                        durationMinutes: 60,
                        recurrence: 'weekdays',
                        active: true,
                      });
                    }}
                  >
                    <Plus size={14} />
                    <span>Add recurring plan</span>
                  </button>

                  <div className="planner-tray-list">
                    {recurringPlans.map((r) => (
                      <div
                        key={r.id}
                        className="planner-tray-card"
                        style={{ opacity: r.active ? 1 : 0.55 }}
                        onClick={() => setEditingRecurring(r)}
                      >
                        <Repeat size={13} className="planner-card-grip" />
                        <span
                          className="planner-card-color"
                          style={{ background: r.color }}
                        />
                        <div className="planner-card-info">
                          <div className="planner-card-title">{r.title}</div>
                          <div className="planner-card-meta">
                            <span>{fmt(parseTime(r.startTime))}</span>
                            <span>·</span>
                            <span>{fmtD(r.durationMinutes)}</span>
                            <span>·</span>
                            <span>
                              {r.recurrence === 'daily'
                                ? 'Daily'
                                : r.recurrence === 'weekdays'
                                ? 'Mon–Fri'
                                : r.recurrence === 'weekends'
                                ? 'Sat–Sun'
                                : 'Custom'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </aside>

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
                      } ${seg.n > 1 ? 'overlap' : ''} ${b.isRecurring ? 'is-recurring' : ''}`}
                      draggable={!seg.cont && !b.isRecurring}
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
          ) : viewMode === 'week' ? (
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
                  const dayBlocks = combineDayBlocks(
                    props.tasks,
                    recurringPlans,
                    recurringDoneKeys,
                    dStr,
                    projectColors
                  );
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
                              } ${seg.n > 1 ? 'overlap' : ''} ${b.isRecurring ? 'is-recurring' : ''}`}
                              draggable={!seg.cont && !b.isRecurring}
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
          ) : (
            /* 24-Hour Circle Mode */
            <div className="planner-circle-wrapper">
              <div
                className="planner-circle-container"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleCircleDrop}
              >
                <svg className="planner-circle-svg" viewBox="0 0 520 520">
                  <circle
                    cx="260"
                    cy="260"
                    r="226"
                    fill="none"
                    stroke="var(--border)"
                    strokeWidth="1.5"
                  />
                  <circle
                    cx="260"
                    cy="260"
                    r="108"
                    fill="var(--surface-2)"
                    stroke="var(--border)"
                  />
                  {Array.from({ length: 24 }, (_, h) => {
                    const [a, b] = polarToCartesian(260, 260, 108, h * 60);
                    const [c, d2] = polarToCartesian(260, 260, 226, h * 60);
                    const [, f] = polarToCartesian(260, 260, 233, h * 60);
                    const [x, y] = polarToCartesian(260, 260, 247, h * 60);
                    return (
                      <React.Fragment key={h}>
                        <line
                          x1={a}
                          y1={b}
                          x2={c}
                          y2={d2}
                          stroke="var(--rule)"
                          strokeWidth="1"
                        />
                        <line
                          x1={c}
                          y1={d2}
                          x2={c}
                          y2={f}
                          stroke="var(--muted)"
                          strokeWidth="1"
                        />
                        <text
                          x={x}
                          y={y}
                          textAnchor="middle"
                          dominantBaseline="middle"
                        >
                          {pad(h)}
                        </text>
                      </React.Fragment>
                    );
                  })}

                  {circleLayout.arcs.map((item, idx) => (
                    <React.Fragment key={`${item.b.id}:${idx}`}>
                      <path
                        d={item.pathD}
                        fill={item.b.color}
                        data-b={item.b.id}
                        opacity={item.b.done ? 0.45 : 0.85}
                        onClick={() => {
                          if (item.b.rawTask) setEditingTask(item.b.rawTask);
                          else if (item.b.recurringPlanId) {
                            const plan = recurringPlans.find(
                              (p) => p.id === item.b.recurringPlanId
                            );
                            if (plan) setEditingRecurring(plan);
                          }
                        }}
                      >
                        <title>
                          {item.b.title} ({fmt(item.b.start)} – {fmt(item.b.start + item.b.dur)})
                        </title>
                      </path>
                      {item.labelCoord && item.labelText && (
                        <text
                          x={item.labelCoord[0]}
                          y={item.labelCoord[1]}
                          fill="#ffffff"
                          fontSize="10"
                          fontWeight="600"
                          textAnchor="middle"
                          dominantBaseline="middle"
                          pointerEvents="none"
                        >
                          {item.labelText}
                        </text>
                      )}
                    </React.Fragment>
                  ))}

                  {date === today && (
                    <>
                      <line
                        x1="260"
                        y1="260"
                        x2={nx}
                        y2={ny}
                        stroke="#ef4444"
                        strokeWidth="2.5"
                      />
                      <circle cx={nx} cy={ny} r="4.5" fill="#ef4444" />
                      <circle cx="260" cy="260" r="4" fill="#ef4444" />
                    </>
                  )}

                  <text className="circle-day-title" x="260" y="236" textAnchor="middle">
                    {friendlyDate(date, today)}
                  </text>
                  <text className="circle-stat" x="260" y="258" textAnchor="middle">
                    {fmtD(circleLayout.totalPlannedMinutes)} planned
                  </text>
                  <text className="circle-active-label" x="260" y="282" textAnchor="middle">
                    {fmt(Math.floor(nowMinute))} ·{' '}
                    {circleLayout.activeBlock
                      ? cut(circleLayout.activeBlock.title, 16)
                      : 'Free time'}
                  </text>
                </svg>
              </div>

              <div className="planner-circle-list">
                <div className="planner-circle-list-title">Day Agenda</div>
                {scheduledBlocks.length > 0 ? (
                  scheduledBlocks
                    .sort((a, b) => a.start - b.start)
                    .map((b) => (
                      <div
                        key={b.id}
                        className={`planner-agenda-row ${b.done ? 'done' : ''}`}
                        onClick={() => {
                          if (b.rawTask) setEditingTask(b.rawTask);
                          else if (b.recurringPlanId) {
                            const plan = recurringPlans.find(
                              (p) => p.id === b.recurringPlanId
                            );
                            if (plan) setEditingRecurring(plan);
                          }
                        }}
                      >
                        <button
                          type="button"
                          className={`planner-block-check ${b.done ? 'checked' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (b.rawTask) void toggleComplete(b.rawTask);
                            else if (b.recurringPlanId) toggleRecurringDone(b.recurringPlanId, date);
                          }}
                        >
                          {b.done ? <CheckCircle2 size={15} /> : <Circle size={15} />}
                        </button>
                        <span
                          className="planner-agenda-color"
                          style={{ background: b.color }}
                        />
                        <span className="planner-agenda-title">{b.title}</span>
                        <span className="planner-agenda-time">
                          {fmt(b.start)} – {fmt(b.start + b.dur)}
                        </span>
                      </div>
                    ))
                ) : (
                  <p className="workflow-hint">
                    No tasks planned yet. Drag any task onto the circle clock to schedule it.
                  </p>
                )}
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

// Recurring Plan Modal
function RecurringPlanModal(props: {
  plan: RecurringPlan;
  onClose: () => void;
  onSave: (updated: RecurringPlan) => void;
  onDelete: (id: string) => void;
}) {
  const { plan, onClose, onSave, onDelete } = props;
  const [title, setTitle] = useState(plan.title);
  const [recurrence, setRecurrence] = useState<RecurrenceType>(plan.recurrence);
  const [weekdays, setWeekdays] = useState<number[]>(plan.weekdays || [1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState(plan.startTime);
  const [duration, setDuration] = useState(String(plan.durationMinutes));
  const [color, setColor] = useState(plan.color);
  const [active, setActive] = useState(plan.active);

  const startMin = parseTime(startTime);
  const durMin = Math.max(5, Number(duration) || 30);

  const toggleWeekday = (dayNum: number) => {
    setWeekdays((prev) =>
      prev.includes(dayNum) ? prev.filter((d) => d !== dayNum) : [...prev, dayNum].sort()
    );
  };

  const WEEKDAY_NAMES = [
    { num: 1, label: 'Mo' },
    { num: 2, label: 'Tu' },
    { num: 3, label: 'We' },
    { num: 4, label: 'Th' },
    { num: 5, label: 'Fr' },
    { num: 6, label: 'Sa' },
    { num: 0, label: 'Su' },
  ];

  return (
    <div className="planner-modal-overlay" onClick={onClose}>
      <div className="planner-modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>{plan.title ? `Edit Recurring: ${plan.title}` : 'New Recurring Plan'}</h3>

        <label>Title</label>
        <input
          type="text"
          value={title}
          autoFocus
          placeholder="e.g. Deep Work, Gym, Sleep…"
          onChange={(e) => setTitle(e.target.value)}
        />

        <label>Repeats</label>
        <select
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value as RecurrenceType)}
        >
          <option value="daily">Daily (Every day)</option>
          <option value="weekdays">Weekdays (Mon–Fri)</option>
          <option value="weekends">Weekends (Sat–Sun)</option>
          <option value="weekly">Custom days of the week</option>
        </select>

        {recurrence === 'weekly' && (
          <div className="planner-weekday-chips">
            {WEEKDAY_NAMES.map((wd) => (
              <button
                key={wd.num}
                type="button"
                className={`planner-weekday-chip ${weekdays.includes(wd.num) ? 'active' : ''}`}
                onClick={() => toggleWeekday(wd.num)}
              >
                {wd.label}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ flex: 1 }}>
            <label>Start Time</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label>Duration (minutes)</label>
            <input
              type="number"
              min="5"
              step="5"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
        </div>

        <div style={{ margin: '6px 0', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: 'var(--muted)' }}>
          Runs from {startTime} to {fmt(startMin + durMin)} ({fmtD(durMin)})
        </div>

        <label>Color</label>
        <select
          value={color}
          onChange={(e) => setColor(e.target.value)}
          style={{ width: '100%', marginBottom: '10px' }}
        >
          {LIFEDASH_PALETTE.map((c) => (
            <option key={c} value={c}>
              ● {c}
            </option>
          ))}
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Active in schedule
        </label>

        <div className="planner-modal-actions">
          <span>
            {plan.id.startsWith('rec-') && (
              <button
                type="button"
                className="icon-btn"
                style={{ color: 'var(--negative)' }}
                onClick={() => onDelete(plan.id)}
                title="Delete recurring plan"
              >
                <Trash2 size={16} />
              </button>
            )}
          </span>
          <span style={{ display: 'flex', gap: '8px' }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                onSave({
                  ...plan,
                  title: title.trim() || 'Untitled Recurring Plan',
                  recurrence,
                  weekdays,
                  startTime,
                  durationMinutes: durMin,
                  color,
                  active,
                });
              }}
            >
              Save Recurring Plan
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

// Task Plan Modal
function TaskPlanModal(props: {
  task: Task;
  date: string;
  onClose: () => void;
  onOpenDetail: () => void;
  onSave: (patch: {
    title: string;
    plannedDate: string | null;
    plannedTime: string | null;
    durationMinutes: number | null;
  }) => Promise<void>;
  onUnschedule: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { task, date, onClose, onOpenDetail, onSave, onUnschedule, onDelete } = props;
  const [title, setTitle] = useState(task.title);
  const [planDate, setPlanDate] = useState(task.plannedDate || date);
  const [planTime, setPlanTime] = useState(task.plannedTime || '09:00');
  const [duration, setDuration] = useState(
    task.durationMinutes ? String(task.durationMinutes) : '45'
  );

  const startMin = parseTime(planTime);
  const durMin = Math.max(1, Number(duration) || 45);

  return (
    <div className="planner-modal-overlay" onClick={onClose}>
      <div className="planner-modal-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Plan Work Block</h3>
          <button
            type="button"
            className="btn-quiet"
            onClick={onOpenDetail}
            title="Open full task detail"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}
          >
            Full detail <ExternalLink size={13} />
          </button>
        </div>

        <label>Task Title</label>
        <input
          type="text"
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />

        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ flex: 1 }}>
            <label>Work Date</label>
            <input
              type="date"
              value={planDate}
              onChange={(e) => setPlanDate(e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label>Start Time</label>
            <input
              type="time"
              value={planTime}
              onChange={(e) => setPlanTime(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ flex: 1 }}>
            <label>Duration (minutes)</label>
            <input
              type="number"
              min="5"
              step="5"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
          <div style={{ flex: 1, alignSelf: 'flex-end', paddingBottom: '8px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--muted)' }}>
              Ends at {fmt(startMin + durMin)}
            </span>
          </div>
        </div>

        <div className="planner-modal-actions">
          <span>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void onUnschedule()}
            >
              Unschedule
            </button>
            <button
              type="button"
              className="icon-btn"
              style={{ color: 'var(--negative)', marginLeft: '6px' }}
              onClick={() => void onDelete()}
              title="Delete task"
            >
              <Trash2 size={16} />
            </button>
          </span>
          <span style={{ display: 'flex', gap: '8px' }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                void onSave({
                  title: title.trim() || task.title,
                  plannedDate: planDate,
                  plannedTime: planTime,
                  durationMinutes: durMin,
                });
              }}
            >
              Save
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

// Preserve exported PlanEditor for HomeView.tsx compatibility
const dirtyPlanEditors = new Set<string>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (dirtyPlanEditors.size) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}

export function PlanEditor({
  task,
  date,
  suggestedTime,
  close,
}: {
  task: Task;
  date: string;
  suggestedTime: string | null;
  close: () => void;
}) {
  const [workDate, setDate] = useState(suggestedTime !== null ? date : task.plannedDate || date);
  const [time, setTime] = useState(suggestedTime ?? task.plannedTime ?? '');
  const [duration, setDuration] = useState(
    task.durationMinutes ? String(task.durationMinutes) : ''
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    formRef.current?.scrollIntoView({ block: 'nearest' });
    formRef.current?.querySelector('input')?.focus();
  }, []);

  const initial = useRef({ workDate, time, duration });
  useEffect(() => {
    const dirty =
      workDate !== initial.current.workDate ||
      time !== initial.current.time ||
      duration !== initial.current.duration;
    if (dirty) dirtyPlanEditors.add(task.id);
    else dirtyPlanEditors.delete(task.id);
    return () => {
      dirtyPlanEditors.delete(task.id);
    };
  }, [workDate, time, duration, task.id]);

  async function save(patch: PlanPatch) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await updateTask(task.id, patch);
      close();
    } catch {
      setError('Plan was not saved. Your choices are kept; retry.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      ref={formRef}
      className="planner-editor"
      onSubmit={(e) => {
        e.preventDefault();
        const invalid = planError(workDate, time, duration);
        if (invalid) {
          setError(invalid);
          return;
        }
        void save({
          plannedDate: workDate || null,
          plannedTime: time || null,
          durationMinutes: duration ? Number(duration) : null,
        });
      }}
    >
      <fieldset disabled={busy}>
        <legend>Work plan for {task.title}</legend>
        <p>Saving changes only the work plan and estimate, never the deadline or calendar.</p>
        <label>
          Planned work date
          <input
            type="date"
            value={workDate}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          Planned start
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>
        <label>
          Estimate (minutes)
          <input
            type="number"
            min="1"
            max="1440"
            step="1"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>
        <div className="planner-toolbar">
          <button type="submit" className="btn-primary">
            {busy ? 'Saving…' : 'Save plan'}
          </button>
          <button
            type="button"
            className="btn-secondary planner-action"
            onClick={() =>
              void save({
                plannedDate: null,
                plannedTime: null,
                durationMinutes: task.durationMinutes ?? null,
              })
            }
          >
            Remove work plan
          </button>
          <button type="button" className="btn-secondary planner-action" onClick={close}>
            Cancel
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </fieldset>
    </form>
  );
}
