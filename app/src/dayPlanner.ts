import type { Task } from './types';
import { parseLocalDate } from './dates';

export const DAY_MINUTES = 1440;
export const DEFAULT_SNAP = 15;
export const RECURRING_STORAGE_KEY = 'lifedash-planner-recurring-v1';
export const RECURRING_DONE_STORAGE_KEY = 'lifedash-planner-recurring-done';

export const LIFEDASH_PALETTE = [
  '#0f766e', // teal (Lifedash accent)
  '#2563eb', // blue
  '#7c3aed', // violet
  '#db2777', // pink
  '#dc2626', // red
  '#d97706', // amber
  '#16a34a', // green
  '#475569', // slate
];

export type RecurrenceType =
  | 'none' // One-off
  | 'daily' // Every day
  | 'weekdays' // Mon-Fri
  | 'weekends' // Sat-Sun
  | 'weekly'; // Specific days (weekdays array)

export interface RecurringPlan {
  id: string;
  title: string;
  color: string;
  startTime: string; // HH:MM
  durationMinutes: number; // 1..1440
  recurrence: RecurrenceType;
  weekdays?: number[]; // [0..6] (0=Sun, 1=Mon, ..., 6=Sat)
  active: boolean;
  notes?: string;
}

export interface ScheduledBlock {
  id: string;
  taskId?: string;
  isRecurring?: boolean;
  recurringPlanId?: string;
  title: string;
  color: string;
  start: number; // 0..1439
  dur: number; // duration in minutes
  done?: boolean;
  rawTask?: Task;
}

export const pad = (n: number): string => String(n).padStart(2, '0');

export const fmt = (m: number): string => {
  const norm = ((Math.floor(m) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${pad(Math.floor(norm / 60))}:${pad(norm % 60)}`;
};

export const fmtD = (m: number): string => {
  const rounded = Math.round(m);
  const h = Math.floor(rounded / 60);
  const r = rounded % 60;
  if (!h && !r) return '0m';
  return `${h ? `${h}h` : ''}${r ? `${h ? ' ' : ''}${r}m` : ''}`;
};

export const parseTime = (t: string): number => {
  if (!t || typeof t !== 'string') return 0;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return ((h * 60 + m) % DAY_MINUTES + DAY_MINUTES) % DAY_MINUTES;
};

export const snap = (m: number, snapVal = DEFAULT_SNAP): number => {
  if (snapVal <= 0) return Math.round(m);
  return Math.round(m / snapVal) * snapVal;
};

export const nowMin = (): number => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
};

export const cut = (t: string, maxLen: number): string => {
  return t.length > maxLen ? `${t.slice(0, maxLen - 1)}…` : t;
};

// Check if a recurring plan applies to a given YYYY-MM-DD date string
export function isRecurringOnDate(
  plan: Pick<RecurringPlan, 'recurrence' | 'weekdays' | 'active'>,
  dateStr: string
): boolean {
  if (!plan.active) return false;
  if (plan.recurrence === 'none') return false;
  if (plan.recurrence === 'daily') return true;

  const d = parseLocalDate(dateStr);
  const dayOfWeek = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  if (plan.recurrence === 'weekdays') {
    return dayOfWeek >= 1 && dayOfWeek <= 5;
  }
  if (plan.recurrence === 'weekends') {
    return dayOfWeek === 0 || dayOfWeek === 6;
  }
  if (plan.recurrence === 'weekly') {
    return Array.isArray(plan.weekdays) ? plan.weekdays.includes(dayOfWeek) : true;
  }
  return false;
}

export interface TimelineSegment {
  b: ScheduledBlock;
  s: number; // segment start in day minutes (0..1440)
  e: number; // segment end in day minutes (0..1440)
  cont: boolean; // is continuation from previous day (wrapped after midnight)
  last: boolean; // is last segment of this block
  i: number; // lane index
  n: number; // total concurrent lanes in this segment's cluster
}

export interface TimelineDayLayout {
  segments: TimelineSegment[];
  totalPlannedMinutes: number;
  freeMinutes: number;
  hasOverlap: boolean;
  doneCount: number;
}

export function computeTimelineLayout(blocks: ScheduledBlock[]): TimelineDayLayout {
  const segs: TimelineSegment[] = [];
  const lanes: Array<Array<{ s: number; e: number }>> = [];

  const sorted = [...blocks].sort(
    (x, y) =>
      (x.start + x.dur > DAY_MINUTES ? 0 : x.start) -
      (y.start + y.dur > DAY_MINUTES ? 0 : y.start)
  );

  sorted.forEach((b) => {
    const end = b.start + b.dur;
    const pieces: Array<{
      b: ScheduledBlock;
      s: number;
      e: number;
      cont: boolean;
      last: boolean;
      i: number;
      n: number;
    }> =
      end > DAY_MINUTES
        ? [
            { b, s: b.start, e: DAY_MINUTES, cont: false, last: false, i: 0, n: 1 },
            { b, s: 0, e: end - DAY_MINUTES, cont: true, last: true, i: 0, n: 1 },
          ]
        : [{ b, s: b.start, e: end, cont: false, last: true, i: 0, n: 1 }];

    pieces.forEach((p) => {
      let laneIdx = lanes.findIndex((L) => !L.some((x) => p.s < x.e && x.s < p.e));
      if (laneIdx < 0) {
        laneIdx = lanes.length;
        lanes.push([]);
      }
      lanes[laneIdx].push({ s: p.s, e: p.e });
      p.i = laneIdx;
      segs.push(p);
    });
  });

  segs.forEach((g) => {
    const overlapping = segs.filter((p) => p.s < g.e && g.s < p.e);
    g.n = 1 + Math.max(...overlapping.map((p) => p.i));
  });

  segs.sort((a, b) => a.s - b.s);

  let tot = 0;
  let cs = 0;
  let ce = 0;
  segs.forEach((g) => {
    if (g.s > ce) {
      tot += ce - cs;
      cs = g.s;
      ce = g.e;
    } else {
      ce = Math.max(ce, g.e);
    }
  });
  tot += ce - cs;

  const hasOverlap = segs.some((g) => g.n > 1);
  const doneCount = blocks.filter((b) => b.done).length;

  return {
    segments: segs,
    totalPlannedMinutes: tot,
    freeMinutes: Math.max(0, DAY_MINUTES - tot),
    hasOverlap,
    doneCount,
  };
}



export const DEFAULT_RECURRING_PLANS: RecurringPlan[] = [
  {
    id: 'rec-sleep',
    title: 'Sleep',
    color: '#5b5bd6',
    startTime: '23:00',
    durationMinutes: 480, // 8 hours
    recurrence: 'daily',
    active: true,
  },
  {
    id: 'rec-morning',
    title: 'Morning Routine',
    color: '#16a34a',
    startTime: '07:00',
    durationMinutes: 45,
    recurrence: 'daily',
    active: true,
  },
  {
    id: 'rec-deepwork',
    title: 'Deep Work',
    color: '#0f766e',
    startTime: '09:00',
    durationMinutes: 150, // 2h 30m
    recurrence: 'weekdays',
    active: true,
  },
  {
    id: 'rec-lunch',
    title: 'Lunch & Break',
    color: '#d97706',
    startTime: '12:30',
    durationMinutes: 60,
    recurrence: 'daily',
    active: true,
  },
  {
    id: 'rec-afternoon',
    title: 'Afternoon Focus',
    color: '#0f766e',
    startTime: '14:00',
    durationMinutes: 120, // 2 hours
    recurrence: 'weekdays',
    active: true,
  },
  {
    id: 'rec-workout',
    title: 'Workout',
    color: '#dc2626',
    startTime: '17:00',
    durationMinutes: 60,
    recurrence: 'weekly',
    weekdays: [1, 3, 5], // Mon, Wed, Fri
    active: true,
  },
  {
    id: 'rec-reading',
    title: 'Reading & Wind Down',
    color: '#2563eb',
    startTime: '21:30',
    durationMinutes: 45,
    recurrence: 'daily',
    active: true,
  },
  {
    id: 'rec-weekly-review',
    title: 'Weekly Review',
    color: '#7c3aed',
    startTime: '16:00',
    durationMinutes: 60,
    recurrence: 'weekly',
    weekdays: [0], // Sunday
    active: true,
  },
];

export function loadRecurringPlans(): RecurringPlan[] {
  if (typeof window === 'undefined') return DEFAULT_RECURRING_PLANS;
  try {
    const raw = localStorage.getItem(RECURRING_STORAGE_KEY);
    if (!raw) return DEFAULT_RECURRING_PLANS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // fallback
  }
  return DEFAULT_RECURRING_PLANS;
}

export function saveRecurringPlans(plans: RecurringPlan[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(RECURRING_STORAGE_KEY, JSON.stringify(plans));
  } catch {
    // ignore
  }
}

export function loadRecurringDoneKeys(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(RECURRING_DONE_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch {
    // ignore
  }
  return new Set();
}

export function saveRecurringDoneKeys(keys: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(RECURRING_DONE_STORAGE_KEY, JSON.stringify(Array.from(keys)));
  } catch {
    // ignore
  }
}

// Combines Lifedash tasks and recurring plans for a chosen date
export function combineDayBlocks(
  tasks: Task[],
  recurringPlans: RecurringPlan[],
  recurringDoneKeys: Set<string>,
  dateStr: string,
  projectColors: Map<string, string> = new Map()
): ScheduledBlock[] {
  const blocks: ScheduledBlock[] = [];

  // 1. Recurring plans matching this date
  recurringPlans
    .filter((plan) => isRecurringOnDate(plan, dateStr))
    .forEach((plan) => {
      const isDone = recurringDoneKeys.has(`${plan.id}:${dateStr}`);
      blocks.push({
        id: `rec:${plan.id}:${dateStr}`,
        isRecurring: true,
        recurringPlanId: plan.id,
        title: plan.title,
        color: plan.color,
        start: parseTime(plan.startTime),
        dur: plan.durationMinutes,
        done: isDone,
      });
    });

  // 2. Lifedash tasks scheduled on this date
  tasks
    .filter(
      (t) =>
        t.status !== 'archived' &&
        t.parentId === null &&
        t.plannedDate === dateStr &&
        t.plannedTime &&
        /^\d{2}:\d{2}$/.test(t.plannedTime)
    )
    .forEach((t) => {
      const color =
        projectColors.get(t.projectId) ||
        (t.priority === 1 ? '#dc2626' : t.priority === 2 ? '#d97706' : '#0f766e');
      blocks.push({
        id: t.id,
        taskId: t.id,
        title: t.title,
        color,
        start: parseTime(t.plannedTime!),
        dur: t.durationMinutes && t.durationMinutes >= 1 ? t.durationMinutes : 45,
        done: t.status === 'done',
        rawTask: t,
      });
    });

  return blocks;
}
