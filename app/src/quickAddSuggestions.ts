import { addDays, todayStr, friendlyDate } from './dates';
import { normalizeProjectKey, type RecurrenceKind } from './logic';
import type { Project } from './types';

export interface CaretToken {
  word: string;
  start: number;
  end: number;
  prefix: string;
  query: string;
  kind: 'project' | 'tag' | 'priority' | 'date' | 'time' | null;
}

export interface AutocompleteItem {
  id: string;
  kind: 'project' | 'tag' | 'priority' | 'date' | 'time' | 'recurrence';
  label: string;
  detail?: string;
  insertText: string;
  color?: string;
}

export interface QuickSuggestion {
  id: string;
  kind: 'date' | 'time' | 'priority' | 'project' | 'tag';
  label: string;
  insertText: string;
  color?: string;
}

export function formatProjectToken(name: string): string {
  if (/\s/.test(name)) {
    return `+"${name}"`;
  }
  return `+${name.toLowerCase()}`;
}

/**
 * Identify the token being typed around the caret position.
 */
export function getCaretToken(text: string, caretIndex: number): CaretToken | null {
  if (!text || caretIndex < 0 || caretIndex > text.length) return null;

  // Find word boundary before caret
  let start = caretIndex;
  while (start > 0 && !/\s/.test(text[start - 1])) {
    start--;
  }

  // Find word boundary after caret
  let end = caretIndex;
  while (end < text.length && !/\s/.test(text[end])) {
    end++;
  }

  const word = text.slice(start, end);
  if (!word) return null;

  // Disallow triggers if preceded by non-whitespace (e.g. "email@domain.com", "C++")
  if (start > 0 && !/\s/.test(text[start - 1])) {
    return null;
  }

  // Project trigger: starts with + or @
  if (word.startsWith('+') || word.startsWith('@')) {
    const prefix = word[0];
    const query = word.slice(1).replace(/^["']/, '');
    return { word, start, end, prefix, query, kind: 'project' };
  }

  // Tag trigger: starts with #
  if (word.startsWith('#')) {
    const prefix = '#';
    const query = word.slice(1);
    return { word, start, end, prefix, query, kind: 'tag' };
  }

  // Priority trigger: p1, p2, p3, p, !1, !2, !3, !
  if (/^(![1-3]?|p[0-3]?)$/i.test(word)) {
    return { word, start, end, prefix: word[0], query: word.slice(1), kind: 'priority' };
  }

  // Time triggers: e.g. 9a, 2p, 10am, 5pm, 14:00
  if (/^\d{1,2}(a|am|p|pm)?$/i.test(word) || /^\d{1,2}:\d{0,2}$/.test(word)) {
    return { word, start, end, prefix: '', query: word, kind: 'time' };
  }

  // Date triggers: prefixes of today, tomorrow, tonight, weekdays, every, in, weekend, this, eod, eow, eom
  const lower = word.toLowerCase();
  const datePrefixes = [
    'tod', 'tom', 'ton', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
    'next', 'this', 'every', 'week', 'end', 'eod', 'eow', 'eom', 'day',
  ];
  if (datePrefixes.some((p) => p.startsWith(lower) || lower.startsWith(p))) {
    return { word, start, end, prefix: '', query: word, kind: 'date' };
  }

  return null;
}

/**
 * Return autocomplete candidates based on the active caret token.
 */
export function getAutocompleteItems(
  token: CaretToken | null,
  projects: Project[],
  availableTags: string[],
): AutocompleteItem[] {
  if (!token) return [];

  if (token.kind === 'project') {
    const q = token.query.toLowerCase().trim();
    const activeProjects = projects.filter((p) => !p.archived);
    const matches = activeProjects.filter((p) => {
      if (!q) return true;
      const normName = normalizeProjectKey(p.name);
      const normQ = normalizeProjectKey(q);
      return normName.includes(normQ) || p.name.toLowerCase().includes(q);
    });

    return matches.slice(0, 6).map((p) => ({
      id: `proj-${p.id}`,
      kind: 'project',
      label: p.name,
      detail: p.id === 'inbox' ? 'Default inbox' : 'Project',
      insertText: formatProjectToken(p.name),
      color: p.color,
    }));
  }

  if (token.kind === 'tag') {
    const q = token.query.toLowerCase().trim();
    const matches = availableTags.filter((t) => t.toLowerCase().includes(q));
    const items: AutocompleteItem[] = matches.slice(0, 6).map((t) => ({
      id: `tag-${t}`,
      kind: 'tag',
      label: `#${t}`,
      insertText: `#${t}`,
    }));

    // If query isn't in existing tags and has letters, allow creating it
    if (q && !matches.some((t) => t.toLowerCase() === q)) {
      items.push({
        id: `tag-new-${q}`,
        kind: 'tag',
        label: `#${q}`,
        detail: 'New tag',
        insertText: `#${q}`,
      });
    }

    return items;
  }

  if (token.kind === 'priority') {
    const q = token.query.toLowerCase();
    const allPriorities: AutocompleteItem[] = [
      { id: 'p1', kind: 'priority', label: 'P1 · High priority', detail: 'p1', insertText: 'p1', color: '#ef4444' },
      { id: 'p2', kind: 'priority', label: 'P2 · Medium priority', detail: 'p2', insertText: 'p2', color: '#f59e0b' },
      { id: 'p3', kind: 'priority', label: 'P3 · Low priority', detail: 'p3', insertText: 'p3', color: '#3b82f6' },
      { id: 'p0', kind: 'priority', label: 'None · Normal priority', detail: 'p0', insertText: 'p0' },
    ];
    if (!q) return allPriorities;
    return allPriorities.filter((p) => p.insertText.startsWith(`p${q}`) || p.insertText === `p${q}`);
  }

  if (token.kind === 'time') {
    const num = parseInt(token.query, 10);
    if (!isNaN(num) && num >= 1 && num <= 12) {
      const am = `${num}:00 AM`;
      const pm = `${num}:00 PM`;
      return [
        { id: `t-${num}am`, kind: 'time', label: am, detail: 'Morning', insertText: `${num}am` },
        { id: `t-${num}pm`, kind: 'time', label: pm, detail: 'Afternoon / Evening', insertText: `${num}pm` },
      ];
    }
  }

  if (token.kind === 'date') {
    const q = token.query.toLowerCase();
    const today = todayStr();
    const candidates: AutocompleteItem[] = [
      { id: 'd-today', kind: 'date', label: 'Today', detail: friendlyDate(today, today), insertText: 'today' },
      { id: 'd-tomorrow', kind: 'date', label: 'Tomorrow', detail: friendlyDate(addDays(today, 1), today), insertText: 'tomorrow' },
      { id: 'd-weekend', kind: 'date', label: 'This weekend', detail: 'Coming Saturday', insertText: 'this weekend' },
      { id: 'd-next-weekend', kind: 'date', label: 'Next weekend', detail: 'Saturday next week', insertText: 'next weekend' },
      { id: 'd-this-fri', kind: 'date', label: 'This Friday', detail: 'Friday this week', insertText: 'this Friday' },
      { id: 'd-next-fri', kind: 'date', label: 'Next Friday', detail: 'Friday next week', insertText: 'next Friday' },
      { id: 'd-eow', kind: 'date', label: 'End of week (5:00 PM)', detail: 'Friday 17:00', insertText: 'end of week' },
      { id: 'd-eod', kind: 'date', label: 'End of day (5:00 PM)', detail: 'Today 17:00', insertText: 'end of day' },
      { id: 'd-tonight', kind: 'date', label: 'Tonight (8:00 PM)', detail: 'Today 20:00', insertText: 'tonight' },
      { id: 'd-day-after', kind: 'date', label: 'Day after tomorrow', detail: friendlyDate(addDays(today, 2), today), insertText: 'day after tomorrow' },
      { id: 'r-daily', kind: 'recurrence', label: 'Every day', detail: 'Recurring daily', insertText: 'every day' },
      { id: 'r-weekly', kind: 'recurrence', label: 'Every week', detail: 'Recurring weekly', insertText: 'every week' },
      { id: 'r-weekend', kind: 'recurrence', label: 'Every weekend', detail: 'Recurring on weekends', insertText: 'every weekend' },
    ];

    return candidates.filter((c) => c.insertText.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)).slice(0, 6);
  }

  return [];
}

/**
 * Replace the active word with the selected autocomplete token, maintaining proper spacing.
 */
export function applyAutocomplete(
  text: string,
  range: [number, number],
  insertText: string,
): { text: string; newCursor: number } {
  const [start, end] = range;
  const before = text.slice(0, start);
  const after = text.slice(end);

  // If after doesn't start with a space and isn't empty, append a space
  const needsSpace = after.length === 0 || !/^\s/.test(after);
  const replacement = insertText + (needsSpace ? ' ' : '');

  const newText = before + replacement + after;
  const newCursor = before.length + replacement.length;

  return { text: newText, newCursor };
}

/**
 * Remove a parsed token from the text string cleanly.
 */
export function stripTokenFromText(
  text: string,
  kind: 'project' | 'date' | 'time' | 'priority' | 'tag' | 'recurrence',
  value?: string,
  projects?: Project[],
): string {
  let updated = text;

  if (kind === 'project') {
    // Matches +project, +"project name", @project, @'project name'
    if (value && projects) {
      const proj = projects.find((p) => p.id === value || p.name === value);
      if (proj) {
        const escaped = proj.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(?:[+@](?:"${escaped}"|'${escaped}'|${escaped}))\\b`, 'gi');
        updated = updated.replace(pattern, '');
      }
    }
    // Generic fallback for any project token
    updated = updated.replace(/(?:^|\s)[+@](?:"[^"]+"|[^\s]+)/g, ' ');
  } else if (kind === 'tag') {
    if (value) {
      const tagQuery = value.startsWith('#') ? value.slice(1) : value;
      const escaped = tagQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(?:^|\\s)#${escaped}\\b`, 'gi');
      updated = updated.replace(pattern, ' ');
    } else {
      updated = updated.replace(/(?:^|\s)#[^\s]+/g, ' ');
    }
  } else if (kind === 'priority') {
    updated = updated.replace(/(?:^|\s)(?:p[0-3]|![1-3])\b/gi, ' ');
  } else if (kind === 'date') {
    // Strip date words: today, tomorrow, tonight, weekend, next <weekday>, in N days/weeks/hours, end of day/week/month, etc.
    updated = updated.replace(
      /(?:^|\s)(?:by\s+|due\s+|before\s+|on\s+)?(?:today|tomorrow|tonight|day\s+after\s+tomorrow|this\s+weekend|next\s+weekend|the\s+weekend|weekend|eow|eod|eom|end\s+of\s+(?:day|week|month)|this\s+(?:morning|afternoon|evening|night)|(?:this|next|coming|upcoming)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|week|month)|in\s+\d+\s+(?:days?|weeks?|hours?|hrs?|mins?|minutes?)|in\s+(?:a|an|one)\s+(?:week|hour))\b/gi,
      ' ',
    );
  } else if (kind === 'time') {
    // Strip time words: 9am, 2:30pm, 14:00, noon, midnight, etc.
    updated = updated.replace(
      /(?:^|\s)(?:by\s+|before\s+|at\s+)?(?:\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|a|p)|\d{1,2}[:.]\d{2}|noon|midday|midnight)\b/gi,
      ' ',
    );
  } else if (kind === 'recurrence') {
    updated = updated.replace(
      /(?:^|\s)every\s+(?:day|morning|evening|week|month|weekend|weekday|other\s+(?:day|week)|\d+\s+days?|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun))\b/gi,
      ' ',
    );
  }

  return updated.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Generate contextual 1-click suggestion pills for attributes that have not yet been provided.
 */
export function getQuickSuggestions(
  parsed: {
    project?: Project | null;
    dueDate?: string | null;
    dueTime?: string | null;
    priority?: number;
    recurrence?: string | null;
    tags: string[];
  },
  projects: Project[],
  availableTags: string[],
): QuickSuggestion[] {
  const suggestions: QuickSuggestion[] = [];

  // Date suggestions if no date
  if (!parsed.dueDate) {
    suggestions.push({
      id: 'sug-today',
      kind: 'date',
      label: 'Today',
      insertText: 'today',
    });
    suggestions.push({
      id: 'sug-tomorrow',
      kind: 'date',
      label: 'Tomorrow',
      insertText: 'tomorrow',
    });
    suggestions.push({
      id: 'sug-weekend',
      kind: 'date',
      label: 'This weekend',
      insertText: 'this weekend',
    });
  } else if (!parsed.dueTime) {
    // Time suggestions if date is set but no time
    suggestions.push({
      id: 'sug-9am',
      kind: 'time',
      label: '9:00 AM',
      insertText: '9am',
    });
    suggestions.push({
      id: 'sug-2pm',
      kind: 'time',
      label: '2:00 PM',
      insertText: '2pm',
    });
    suggestions.push({
      id: 'sug-6pm',
      kind: 'time',
      label: '6:00 PM',
      insertText: '6pm',
    });
  }

  // Priority suggestion if none
  if (!parsed.priority || parsed.priority === 0) {
    suggestions.push({
      id: 'sug-p1',
      kind: 'priority',
      label: 'P1',
      insertText: 'p1',
      color: '#ef4444',
    });
  }

  // Project suggestion if default/inbox and there are active projects
  if (!parsed.project || parsed.project.id === 'inbox') {
    const nonInbox = projects.filter((p) => !p.archived && p.id !== 'inbox');
    for (const p of nonInbox.slice(0, 2)) {
      suggestions.push({
        id: `sug-proj-${p.id}`,
        kind: 'project',
        label: p.name,
        insertText: formatProjectToken(p.name),
        color: p.color,
      });
    }
  }

  // Tag suggestions for top unused tags
  const unusedTags = availableTags.filter((t) => !parsed.tags.includes(t));
  for (const t of unusedTags.slice(0, 2)) {
    suggestions.push({
      id: `sug-tag-${t}`,
      kind: 'tag',
      label: `#${t}`,
      insertText: `#${t}`,
    });
  }

  return suggestions;
}
