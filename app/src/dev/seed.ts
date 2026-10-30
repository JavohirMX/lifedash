import { db } from '../db';
import { todayStr } from '../dates';
import { sampleData } from './sampleData';
let pending: Promise<void> | null = null;
export function seedSample(): Promise<void> {
  return pending ??= db.transaction('rw', [db.projects, db.tasks, db.habits, db.habitLogs, db.goals, db.notes, db.journal, db.syncmeta], async () => {
    if (await db.syncmeta.get('sample-seeded-v1')) return;
    const data = sampleData(todayStr());
    await db.projects.bulkPut(data.projects);
    await db.tasks.bulkPut(data.tasks);
    await db.habits.bulkPut(data.habits);
    await db.habitLogs.bulkPut(data.habitLogs);
    await db.goals.bulkPut(data.goals);
    await db.notes.bulkPut(data.notes);
    await db.journal.bulkPut(data.journal);
    await db.syncmeta.put({ key: 'sample-seeded-v1', value: true });
  }).catch(e => { pending = null; throw e; });
}
