import { describe, expect, it } from 'vitest';
import {
  detectSource,
  parseCsv,
  parseDate,
  parseGenericCsv,
  parseLifedashJson,
  parseObsidianMd,
  parseTodoistCsv,
} from './import';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, CRLF and empty lines', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n\r\nd,e,f\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['d', 'e', 'f'],
    ]);
  });
});

describe('parseDate', () => {
  it('reads ISO and Todoist named dates', () => {
    expect(parseDate('2026-10-21')).toBe('2026-10-21');
    expect(parseDate('18 Oct 2026')).toBe('2026-10-18');
    expect(parseDate('5 jan 2026 14:00')).toBe('2026-01-05');
    expect(parseDate('next week')).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});

describe('parseTodoistCsv', () => {
  it('parses tasks with priority, indent and dates', () => {
    const csv = 'TYPE,CONTENT,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE\n' +
      'task,Buy milk,1,1,,,2026-10-21,en,\n' +
      'task,Go to store,4,2,,,18 Oct 2026,en,\n' +
      'task,Call mom,2,1,,,,en,\n';
    const { tasks, warnings } = parseTodoistCsv(csv);
    expect(warnings).toEqual([]);
    expect(tasks).toHaveLength(3);
    expect(tasks[0]).toMatchObject({ title: 'Buy milk', dueDate: '2026-10-21', indent: 0, pinned: false });
    expect(tasks[1]).toMatchObject({ title: 'Go to store', indent: 1, pinned: true, dueDate: '2026-10-18' });
    expect(tasks[2]).toMatchObject({ title: 'Call mom', dueDate: null });
  });

  it('warns on unreadable dates and skips notes', () => {
    const csv = 'TYPE,CONTENT,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE\n' +
      'note,a note row,1,1,,,,en,\n' +
      'task,Weird date,1,1,,,next Friday,en,\n';
    const { tasks, warnings } = parseTodoistCsv(csv);
    expect(tasks).toHaveLength(1);
    expect(warnings).toHaveLength(2);
  });
});

describe('parseGenericCsv', () => {
  it('maps common header names', () => {
    const csv = 'Title,Due,Project,Tags,Done\n' +
      'Write report,2026-10-25,Work,work;urgent,no\n' +
      'Buy gift,,Personal,,yes\n';
    const { tasks, warnings } = parseGenericCsv(csv);
    expect(warnings).toEqual([]);
    expect(tasks[0]).toMatchObject({ title: 'Write report', dueDate: '2026-10-25', project: 'Work', tags: ['work', 'urgent'], done: false });
    expect(tasks[1]).toMatchObject({ title: 'Buy gift', done: true, dueDate: null });
  });

  it('falls back to first column without a header', () => {
    const { tasks, warnings } = parseGenericCsv('one thing\nanother thing\n');
    expect(tasks).toHaveLength(2);
    expect(warnings[0]).toMatch(/no header/i);
  });
});

describe('parseObsidianMd', () => {
  it('parses tasks with tags, due dates, done state and indent', () => {
    const md = '# Errands\n' +
      '- [ ] Buy milk #home 📅 2026-10-21\n' +
      '  - [x] Get a cart\n' +
      '- [ ] Call the bank\n' +
      '\n' +
      '# Work\n' +
      '- [ ] Ship the release #work\n';
    const { tasks, warnings } = parseObsidianMd(md);
    expect(warnings).toEqual([]);
    expect(tasks).toHaveLength(4);
    expect(tasks[0]).toMatchObject({ title: 'Buy milk', tags: ['home'], dueDate: '2026-10-21', done: false, project: 'Errands', indent: 0 });
    expect(tasks[1]).toMatchObject({ title: 'Get a cart', done: true, indent: 1 });
    expect(tasks[3]).toMatchObject({ title: 'Ship the release', tags: ['work'], project: 'Work' });
  });

  it('warns when no tasks found', () => {
    expect(parseObsidianMd('just prose').warnings[0]).toMatch(/no .* task/i);
  });
});

describe('parseLifedashJson', () => {
  it('imports an export file', () => {
    const json = JSON.stringify({ tasks: [
      { title: 'A', status: 'done', dueDate: '2026-10-01', tags: ['x'], pinned: true },
      { title: 'B', status: 'active', dueDate: null, tags: [], pinned: false },
      { notitle: true },
    ] });
    const { tasks, warnings } = parseLifedashJson(json);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ title: 'A', done: true, pinned: true, tags: ['x'] });
    expect(warnings).toHaveLength(1);
  });

  it('rejects non-json and missing tasks', () => {
    expect(parseLifedashJson('nope').warnings[0]).toMatch(/not valid json/i);
    expect(parseLifedashJson('{}').warnings[0]).toMatch(/no "tasks"/i);
  });
});

describe('detectSource', () => {
  it('uses filename first, then content', () => {
    expect(detectSource('x.csv', 'TYPE,CONTENT')).toBe('todoist-csv');
    expect(detectSource('x.csv', 'a,b')).toBe('generic-csv');
    expect(detectSource('x.md', '- [ ] t')).toBe('obsidian-md');
    expect(detectSource('x.json', '{}')).toBe('lifedash-json');
    expect(detectSource('paste', '- [ ] t')).toBe('obsidian-md');
    expect(detectSource('paste', '{"tasks":[]}')).toBe('lifedash-json');
  });
});
