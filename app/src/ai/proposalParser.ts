export interface SubtaskProposal {
  action: 'subtasks';
  parentTaskId?: string;
  items: string[];
}

export interface ScheduleItem {
  taskId: string;
  title?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  durationMinutes?: number;
}

export interface ScheduleProposal {
  action: 'schedule';
  items: ScheduleItem[];
}

export interface TaskItemProposal {
  title: string;
  priority?: number;
  dueDate?: string | null;
  dueTime?: string | null;
  tags?: string[];
  note?: string;
}

export interface CreateTasksProposal {
  action: 'create_tasks';
  items: TaskItemProposal[];
}

export type AiProposal = SubtaskProposal | ScheduleProposal | CreateTasksProposal;

export interface ParsedAiResponse {
  cleanText: string;
  proposals: AiProposal[];
}

function sanitizeSubtasks(raw: unknown): SubtaskProposal | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.action !== 'subtasks' || !Array.isArray(obj.items)) return null;

  const validItems = obj.items
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 500);

  if (validItems.length === 0) return null;
  return {
    action: 'subtasks',
    parentTaskId: typeof obj.parentTaskId === 'string' ? obj.parentTaskId : undefined,
    items: validItems,
  };
}

function sanitizeSchedule(raw: unknown): ScheduleProposal | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.action !== 'schedule' || !Array.isArray(obj.items)) return null;

  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  const validItems: ScheduleItem[] = [];
  for (const item of obj.items) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    if (typeof it.taskId !== 'string' || !it.taskId.trim()) continue;
    const date = typeof it.date === 'string' && dateRegex.test(it.date.trim()) ? it.date.trim() : '';
    const time = typeof it.time === 'string' && timeRegex.test(it.time.trim()) ? it.time.trim() : '';
    if (!date || !time) continue;

    const dur = typeof it.durationMinutes === 'number' && it.durationMinutes > 0 && it.durationMinutes <= 1440
      ? it.durationMinutes
      : undefined;

    validItems.push({
      taskId: it.taskId.trim(),
      title: typeof it.title === 'string' ? it.title.trim() : undefined,
      date,
      time,
      durationMinutes: dur,
    });
  }

  if (validItems.length === 0) return null;
  return { action: 'schedule', items: validItems };
}

function sanitizeCreateTasks(raw: unknown): CreateTasksProposal | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.action !== 'create_tasks' || !Array.isArray(obj.items)) return null;

  const validItems: TaskItemProposal[] = [];
  for (const item of obj.items) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    if (typeof it.title !== 'string' || !it.title.trim()) continue;

    const priority = [0, 1, 2, 3].includes(Number(it.priority)) ? (Number(it.priority) as 0 | 1 | 2 | 3) : 0;
    const dueDate = typeof it.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(it.dueDate.trim()) ? it.dueDate.trim() : null;
    const dueTime = typeof it.dueTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(it.dueTime.trim()) ? it.dueTime.trim() : null;
    const tags = Array.isArray(it.tags)
      ? it.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim().toLowerCase())
      : undefined;

    validItems.push({
      title: it.title.trim().slice(0, 500),
      priority,
      dueDate,
      dueTime,
      tags,
      note: typeof it.note === 'string' ? it.note.trim() : undefined,
    });
  }

  if (validItems.length === 0) return null;
  return { action: 'create_tasks', items: validItems };
}

export function parseAiResponse(rawText: string): ParsedAiResponse {
  if (!rawText || !rawText.trim()) {
    return { cleanText: '', proposals: [] };
  }

  const proposals: AiProposal[] = [];
  // Match fenced code blocks with ```json ... ``` or just ``` ... ```
  const blockRegex = /```(?:json)?\s*\n([\s\S]*?)\n```/gi;

  let cleanText = rawText;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(rawText)) !== null) {
    const rawContent = match[1].trim();
    try {
      const parsed = JSON.parse(rawContent);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];

      let recognized = false;
      for (const item of candidates) {
        const sub = sanitizeSubtasks(item);
        if (sub) {
          proposals.push(sub);
          recognized = true;
          continue;
        }
        const sch = sanitizeSchedule(item);
        if (sch) {
          proposals.push(sch);
          recognized = true;
          continue;
        }
        const ct = sanitizeCreateTasks(item);
        if (ct) {
          proposals.push(ct);
          recognized = true;
          continue;
        }
      }

      if (recognized) {
        // Strip the matched JSON block from the clean user-facing prose text
        cleanText = cleanText.replace(match[0], '').trim();
      }
    } catch {
      // Non-JSON code block - keep in text
    }
  }

  return { cleanText, proposals };
}
