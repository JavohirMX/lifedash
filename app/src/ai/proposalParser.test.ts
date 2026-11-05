import { describe, it, expect } from 'vitest';
import { parseAiResponse } from './proposalParser';

describe('proposalParser', () => {
  it('returns clean text when there are no code blocks', () => {
    const res = parseAiResponse('Here is some advice on how to organize your day.');
    expect(res.cleanText).toBe('Here is some advice on how to organize your day.');
    expect(res.proposals).toHaveLength(0);
  });

  it('extracts subtasks proposals and strips the raw json block from clean text', () => {
    const input = `Here is a suggested breakdown for your task:

\`\`\`json
{
  "action": "subtasks",
  "parentTaskId": "task-123",
  "items": [
    "Draft the research outline",
    "Gather empirical data",
    "Review findings with team"
  ]
}
\`\`\`

Let me know if you want to refine these!`;

    const res = parseAiResponse(input);
    expect(res.proposals).toHaveLength(1);
    expect(res.proposals[0]).toEqual({
      action: 'subtasks',
      parentTaskId: 'task-123',
      items: [
        'Draft the research outline',
        'Gather empirical data',
        'Review findings with team',
      ],
    });
    expect(res.cleanText).not.toContain('```json');
    expect(res.cleanText).toContain('Here is a suggested breakdown');
    expect(res.cleanText).toContain('Let me know if you want to refine these!');
  });

  it('extracts schedule proposals with valid time and date', () => {
    const input = `I suggest this schedule for today:

\`\`\`json
{
  "action": "schedule",
  "items": [
    { "taskId": "t-1", "title": "Review PRs", "date": "2026-11-05", "time": "09:30", "durationMinutes": 45 },
    { "taskId": "t-2", "title": "Design sprint", "date": "2026-11-05", "time": "14:00" }
  ]
}
\`\`\``;

    const res = parseAiResponse(input);
    expect(res.proposals).toHaveLength(1);
    expect(res.proposals[0].action).toBe('schedule');
    if (res.proposals[0].action === 'schedule') {
      expect(res.proposals[0].items).toHaveLength(2);
      expect(res.proposals[0].items[0]).toEqual({
        taskId: 't-1',
        title: 'Review PRs',
        date: '2026-11-05',
        time: '09:30',
        durationMinutes: 45,
      });
      expect(res.proposals[0].items[1].time).toBe('14:00');
    }
  });

  it('extracts create_tasks proposals', () => {
    const input = `Extracted tasks from your note:

\`\`\`json
{
  "action": "create_tasks",
  "items": [
    { "title": "Send budget sheet to CFO", "priority": 1, "dueDate": "2026-11-06", "tags": ["finance"] },
    { "title": "Schedule 1:1 sync with Alice", "priority": 2 }
  ]
}
\`\`\``;

    const res = parseAiResponse(input);
    expect(res.proposals).toHaveLength(1);
    expect(res.proposals[0].action).toBe('create_tasks');
    if (res.proposals[0].action === 'create_tasks') {
      expect(res.proposals[0].items).toHaveLength(2);
      expect(res.proposals[0].items[0].title).toBe('Send budget sheet to CFO');
      expect(res.proposals[0].items[0].priority).toBe(1);
      expect(res.proposals[0].items[0].tags).toEqual(['finance']);
    }
  });

  it('ignores invalid JSON or non-proposal code blocks', () => {
    const input = `Here is Python code:

\`\`\`python
print("Hello world")
\`\`\`

And invalid JSON:

\`\`\`json
{ invalid json syntax
\`\`\``;

    const res = parseAiResponse(input);
    expect(res.proposals).toHaveLength(0);
    expect(res.cleanText).toContain('print("Hello world")');
  });
});
