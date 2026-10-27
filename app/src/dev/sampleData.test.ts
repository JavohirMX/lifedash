import { describe, expect, it } from 'vitest';
import { sampleData } from './sampleData';
describe('sampleData', () => {
  it('contains deterministic linked fictional content', () => {
    const data = sampleData('2026-10-27');
    expect(sampleData('2026-10-27')).toEqual(data);
    expect(data.tasks).toHaveLength(16);
    expect(data.habits).toHaveLength(3);
    expect(data.journal).toHaveLength(4);
    const ids = new Set(data.tasks.map(t => t.id));
    for (const t of data.tasks) {
      if (t.parentId) expect(ids.has(t.parentId)).toBe(true);
      for (const b of t.blockedBy) expect(ids.has(b)).toBe(true);
    }
    expect(data.habitLogs.every(l => l.date < '2026-10-27')).toBe(true);
  });
  it('moves dates relative to the anchor rather than freezing the demo', () => {
    expect(sampleData('2026-11-01').tasks[0].dueDate).toBe('2026-10-31');
    expect(sampleData('2026-11-01').tasks[1].dueDate).toBe('2026-11-01');
  });
});
