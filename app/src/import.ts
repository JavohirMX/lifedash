// Import parsers for external formats. Pure functions - unit-tested,
// no Dexie access. The dialog turns results into rows and repo.importTasks
// writes them in one transaction.

export interface ImportedTask {
  title: string;
  done: boolean;
  dueDate: string | null;
  tags: string[];
  pinned: boolean;
  indent: number; // 0 = top-level; N>0 = subtask of the previous indent N-1 task
  project?: string; // source project/section name, when the format carries one
}

export type ImportSource = 'todoist-csv' | 'generic-csv' | 'obsidian-md' | 'lifedash-json';

export interface ParseResult {
  tasks: ImportedTask[];
  warnings: string[];
}

/** Minimal CSV: quoted fields, escaped quotes, CRLF, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); if (row.some((c) => c !== '')) rows.push(row); row = []; };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { pushField(); i++; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      pushRow(); i++; continue;
    }
    field += c; i++;
  }
  pushRow();
  return rows;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** ISO YYYY-MM-DD, or Todoist's "18 Oct 2026" / "18 Oct 2026 14:00". */
export function parseDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const named = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})/.exec(s);
  if (named) {
    const m = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (m) return `${named[3]}-${m}-${named[1].padStart(2, '0')}`;
  }
  return null;
}

export function parseTodoistCsv(text: string): ParseResult {
  const warnings: string[] = [];
  const rows = parseCsv(text);
  if (rows.length === 0) return { tasks: [], warnings: ['Empty file.'] };
  let start = 0;
  const head = rows[0].map((c) => c.trim().toUpperCase());
  if (head[0] === 'TYPE') start = 1;
  const tasks: ImportedTask[] = [];
  for (let i = start; i < rows.length; i++) {
    const [type, content, priority, indent, , , date] = rows[i];
    if (!content?.trim()) continue;
    if (type && !/^task$/i.test(type.trim())) {
      warnings.push(`Row ${i + 1}: skipped non-task row (${type}).`);
      continue;
    }
    const dueDate = parseDate(date);
    if (date?.trim() && !dueDate) warnings.push(`Row ${i + 1}: could not read date "${date}".`);
    const p = Number(priority);
    tasks.push({
      title: content.trim(),
      done: false,
      dueDate,
      tags: [],
      pinned: p >= 4, // Todoist CSV: 4 = its "p1" (highest)
      indent: Math.max(0, (Number(indent) || 1) - 1),
    });
  }
  return { tasks, warnings };
}

export function parseGenericCsv(text: string): ParseResult {
  const warnings: string[] = [];
  const rows = parseCsv(text);
  if (rows.length < 1) return { tasks: [], warnings: ['Empty file.'] };
  const header = rows[0].map((c) => c.trim().toLowerCase());
  const col = (names: string[]) => header.findIndex((h) => names.includes(h));
  const ci = {
    title: col(['title', 'task', 'name', 'content']),
    due: col(['due', 'date', 'duedate', 'due_date']),
    project: col(['project', 'list']),
    tags: col(['tags', 'labels']),
    done: col(['done', 'completed', 'status', 'checked']),
  };
  if (ci.title < 0) {
    // no header: treat every first column as a title
    return {
      tasks: rows.filter((r) => r[0]?.trim()).map((r) => ({
        title: r[0].trim(), done: false, dueDate: null, tags: [], pinned: false, indent: 0,
      })),
      warnings: ['No header row found; imported the first column as titles.'],
    };
  }
  const tasks: ImportedTask[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const title = r[ci.title]?.trim();
    if (!title) continue;
    const due = ci.due >= 0 ? parseDate(r[ci.due]) : null;
    if (ci.due >= 0 && r[ci.due]?.trim() && !due) warnings.push(`Row ${i + 1}: could not read date "${r[ci.due]}".`);
    const doneRaw = ci.done >= 0 ? r[ci.done]?.trim().toLowerCase() : '';
    tasks.push({
      title,
      done: ['done', 'true', 'yes', '1', 'x', 'completed'].includes(doneRaw),
      dueDate: due,
      tags: ci.tags >= 0 ? r[ci.tags].split(/[;|]/).map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean) : [],
      pinned: false,
      indent: 0,
      project: ci.project >= 0 ? r[ci.project]?.trim() || undefined : undefined,
    });
  }
  return { tasks, warnings };
}

const OB_TASK = /^(\s*)[-*] \[([ xX])\] (.*)$/;
const OB_DUE = /📅\s*(\d{4}-\d{2}-\d{2})/u;
const OB_TAG = /#([\p{L}\p{N}_/-]+)/gu;

export function parseObsidianMd(text: string): ParseResult {
  const warnings: string[] = [];
  const tasks: ImportedTask[] = [];
  let section: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) { section = h[1].trim(); continue; }
    const m = OB_TASK.exec(line);
    if (!m) continue;
    let title = m[3].trim();
    const dueM = OB_DUE.exec(title);
    const dueDate = dueM ? dueM[1] : null;
    title = title.replace(OB_DUE, '');
    const tags: string[] = [];
    title = title.replace(OB_TAG, (_all, t: string) => { tags.push(t.toLowerCase()); return ''; });
    title = title.replace(/\s{2,}/g, ' ').trim();
    if (!title) { warnings.push('Skipped a task with no text after removing tags/dates.'); continue; }
    const indent = Math.floor(m[1].replace(/\t/g, '  ').length / 2);
    tasks.push({ title, done: m[2] !== ' ', dueDate, tags, pinned: false, indent, project: section });
  }
  if (tasks.length === 0) warnings.push('No "- [ ]" task lines found.');
  return { tasks, warnings };
}

export function parseLifedashJson(text: string): ParseResult {
  const warnings: string[] = [];
  let data: { tasks?: Array<Record<string, unknown>> };
  try {
    data = JSON.parse(text);
  } catch {
    return { tasks: [], warnings: ['Not valid JSON.'] };
  }
  if (!Array.isArray(data.tasks)) return { tasks: [], warnings: ['No "tasks" array in this file.'] };
  const tasks: ImportedTask[] = [];
  for (const t of data.tasks) {
    if (typeof t.title !== 'string' || !t.title.trim()) { warnings.push('Skipped a task without a title.'); continue; }
    tasks.push({
      title: t.title.trim(),
      done: t.status === 'done',
      dueDate: typeof t.dueDate === 'string' ? t.dueDate : null,
      tags: Array.isArray(t.tags) ? (t.tags as string[]) : [],
      pinned: t.pinned === true,
      indent: 0, // parent links by id can't be restored across installs
    });
  }
  return { tasks, warnings };
}

export function detectSource(filename: string, text: string): ImportSource {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.json')) return 'lifedash-json';
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')) return 'obsidian-md';
  if (lower.endsWith('.csv')) {
    const firstLine = (text.split(/\r?\n/, 1)[0] ?? '').toUpperCase();
    if (firstLine.startsWith('TYPE,') || firstLine.startsWith('"TYPE",')) return 'todoist-csv';
    return 'generic-csv';
  }
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) return 'lifedash-json';
  if (/^[-*] \[[ xX]\]/m.test(text)) return 'obsidian-md';
  if (text.toUpperCase().startsWith('TYPE,')) return 'todoist-csv';
  return text.includes(',') ? 'generic-csv' : 'obsidian-md';
}

export function parse(source: ImportSource, text: string): ParseResult {
  switch (source) {
    case 'todoist-csv': return parseTodoistCsv(text);
    case 'generic-csv': return parseGenericCsv(text);
    case 'obsidian-md': return parseObsidianMd(text);
    case 'lifedash-json': return parseLifedashJson(text);
  }
}
