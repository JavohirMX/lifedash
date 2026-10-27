import type { Task, Project, Habit, HabitLog, Goal, Note, JournalEntry } from '../types';
import { addDays } from '../dates';

/** Deterministic fictional content; dates move with the requested anchor day. */
export function sampleData(today: string) {
  const projects: Project[] = [
    { id: 'inbox', name: 'Inbox', color: '#0f766e', order: 0, archived: false },
    { id: 'sample-homelab', name: 'Homelab', color: '#6366f1', order: 1, archived: false },
    { id: 'sample-personal', name: 'Personal', color: '#d08a44', order: 2, archived: false },
  ];
  const base: Task = {
    id: '', title: '', note: '', noteDoc: null, projectId: 'inbox', parentId: null,
    goalId: null, noteId: null, status: 'active', pinned: false, priority: 0,
    dueDate: null, dueTime: null, recurrence: null, blockedBy: [], tags: [],
    order: 0, seriesId: null, createdAt: 1, updatedAt: 1, completedAt: null,
  };
  const specs: (Partial<Task> & Pick<Task, 'title'>)[] = [
    { title: 'Set up the backup volume', projectId: 'sample-homelab', dueDate: addDays(today, -1), priority: 1, pinned: true, goalId: 'sample-goal-lab' },
    { title: 'Test the restore process', projectId: 'sample-homelab', dueDate: today, blockedBy: ['sample-task-0'], goalId: 'sample-goal-lab' },
    { title: 'Review the weekly budget', projectId: 'sample-personal', dueDate: today, dueTime: '18:30', tags: ['weekly'] },
    { title: 'Plan meals for the week', projectId: 'sample-personal', dueDate: today, dueTime: '20:00' },
    { title: 'Prepare a small launch', projectId: 'sample-homelab', dueDate: today },
    { title: 'Check the release notes', parentId: 'sample-task-4', projectId: 'sample-homelab' },
    { title: 'Run a restore test', parentId: 'sample-task-4', projectId: 'sample-homelab' },
    { title: 'Water the plants', projectId: 'sample-personal', dueDate: today, recurrence: `DTSTART:${today.replaceAll('-', '')}T000000\nRRULE:FREQ=DAILY` },
    { title: 'Weekly review: clear the backlog', dueDate: addDays(today, 3), recurrence: `DTSTART:${today.replaceAll('-', '')}T000000\nRRULE:FREQ=WEEKLY` },
    { title: 'Document the network layout', projectId: 'sample-homelab', dueDate: addDays(today, 2), goalId: 'sample-goal-lab' },
    { title: 'Research a quieter case', projectId: 'sample-homelab' },
    { title: 'Sort the reading list', projectId: 'sample-personal' },
    { title: 'Organize desk cables', projectId: 'sample-homelab' },
    { title: 'Passport', projectId: 'sample-personal', noteId: 'sample-note-packing' },
    { title: 'Morning walk', status: 'done', dueDate: today, completedAt: 2 },
    { title: 'Review yesterday\'s notes', status: 'done', dueDate: today, completedAt: 3 },
  ];
  const tasks = specs.map((s, i) => ({ ...base, ...s, id: `sample-task-${i}`, order: i }));
  const habits: Habit[] = [
    { id: 'sample-walk', name: 'Morning walk', color: '#22a77a', weekdays: null, order: 0, archived: false, createdAt: 1 },
    { id: 'sample-read', name: 'Read 20 minutes', color: '#6366f1', weekdays: null, order: 1, archived: false, createdAt: 1 },
    { id: 'sample-stretch', name: 'Evening stretch', color: '#d08a44', weekdays: [1, 3, 5], order: 2, archived: false, createdAt: 1 },
  ];
  const habitLogs: HabitLog[] = [];
  for (const [index, h] of habits.entries()) for (let n = 1; n <= 28; n++) {
    const date = addDays(today, -n);
    const weekday = new Date(date + 'T12:00:00').getDay();
    if ((h.weekdays === null || h.weekdays.includes(weekday)) && (n + index) % 4 !== 0)
      habitLogs.push({ id: `${h.id}:${date}`, habitId: h.id, date, doneAt: 1 });
  }
  const goals: Goal[] = [
    { id: 'sample-goal-lab', title: 'Make the homelab dependable', note: 'Backups, restore tests and documentation.', targetDate: addDays(today, 30), status: 'active', order: 0, createdAt: 1, updatedAt: 1 },
    { id: 'sample-goal-health', title: 'Keep a steady daily rhythm', note: 'Small habits, kept simple.', targetDate: null, status: 'active', order: 1, createdAt: 1, updatedAt: 1 },
  ];
  const item = (text: string, checked: boolean) => ({ type: 'taskItem', attrs: { checked }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const notes: Note[] = [
    { id: 'sample-note-packing', title: 'Packing checklist', note: 'Passport\nCharger\nTickets', noteDoc: { type: 'doc', content: [{ type: 'taskList', content: [item('Passport', false), item('Charger', false), item('Tickets', true)] }] }, pinned: true, createdAt: 1, updatedAt: 1 },
    { id: 'sample-note-lab', title: 'Homelab maintenance', note: 'Keep a separate backup. Test the restore path before relying on it.', noteDoc: null, pinned: false, createdAt: 1, updatedAt: 1 },
  ];
  const journal: JournalEntry[] = [0, 1, 3, 6].map((n, i) => ({
    id: `sample-journal-${n}`, date: addDays(today, -n),
    note: i === 1 ? '' : 'A little progress is still progress. Made room for a walk and a quiet evening.',
    noteDoc: null, highlight: ['A good walk made the rest of the day easier.', 'Finished a small but useful improvement.', null, 'More time outside.'][i],
    mood: i === 1 ? null : 4, createdAt: 1, updatedAt: 1,
  }));
  return { projects, tasks, habits, habitLogs, goals, notes, journal };
}
