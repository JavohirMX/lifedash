import { describe, it, expect } from 'vitest';
import {
  getCaretToken,
  getAutocompleteItems,
  applyAutocomplete,
  stripTokenFromText,
  getQuickSuggestions,
  formatProjectToken,
} from './quickAddSuggestions';
import type { Project } from './types';

const sampleProjects: Project[] = [
  { id: 'inbox', name: 'Inbox', color: '#6366f1', order: 0, archived: false },
  { id: 'work', name: 'Work', color: '#0ea5e9', order: 1, archived: false },
  { id: 'health', name: 'Health & Fitness', color: '#10b981', order: 2, archived: false },
  { id: 'archived-proj', name: 'Old Project', color: '#9ca3af', order: 3, archived: true },
];

const sampleTags = ['reading', 'errands', 'finance', 'urgent'];

describe('quickAddSuggestions', () => {
  describe('formatProjectToken', () => {
    it('uses quotes for multi-word project names', () => {
      expect(formatProjectToken('Health & Fitness')).toBe('+"Health & Fitness"');
    });

    it('uses lowercase without quotes for single word names', () => {
      expect(formatProjectToken('Work')).toBe('+work');
    });
  });

  describe('getCaretToken', () => {
    it('detects project trigger with +', () => {
      const text = 'Call client +wo';
      const token = getCaretToken(text, text.length);
      expect(token).toEqual({
        word: '+wo',
        start: 12,
        end: 15,
        prefix: '+',
        query: 'wo',
        kind: 'project',
      });
    });

    it('detects project trigger with @', () => {
      const text = 'Finish report @hea';
      const token = getCaretToken(text, text.length);
      expect(token?.kind).toBe('project');
      expect(token?.query).toBe('hea');
    });

    it('detects tag trigger with #', () => {
      const text = 'Buy groceries #err';
      const token = getCaretToken(text, text.length);
      expect(token?.kind).toBe('tag');
      expect(token?.query).toBe('err');
    });

    it('detects priority triggers', () => {
      const t1 = getCaretToken('Task p1', 7);
      expect(t1?.kind).toBe('priority');
      expect(t1?.query).toBe('1');

      const t2 = getCaretToken('Task p', 6);
      expect(t2?.kind).toBe('priority');
    });

    it('detects time triggers like 2p or 9am', () => {
      const token = getCaretToken('Meeting 2p', 10);
      expect(token?.kind).toBe('time');
      expect(token?.query).toBe('2p');
    });

    it('detects date trigger words like tom or tod', () => {
      const token = getCaretToken('Doctor appointment tom', 22);
      expect(token?.kind).toBe('date');
      expect(token?.query).toBe('tom');
    });

    it('ignores trigger symbols inside email addresses or C++', () => {
      expect(getCaretToken('email@example.com', 8)).toBeNull();
      expect(getCaretToken('Learn C++', 9)).toBeNull();
    });
  });

  describe('getAutocompleteItems', () => {
    it('filters active projects by query and excludes archived projects', () => {
      const token = getCaretToken('Review budget +w', 16);
      const items = getAutocompleteItems(token, sampleProjects, sampleTags);
      expect(items.length).toBe(1);
      expect(items[0].label).toBe('Work');
      expect(items[0].insertText).toBe('+work');
    });

    it('filters tags by query and offers new tag option if not present', () => {
      const token = getCaretToken('Check email #rea', 16);
      const items = getAutocompleteItems(token, sampleProjects, sampleTags);
      expect(items.some((i) => i.label === '#reading')).toBe(true);

      const newToken = getCaretToken('Task #custom', 12);
      const newItems = getAutocompleteItems(newToken, sampleProjects, sampleTags);
      expect(newItems.some((i) => i.label === '#custom' && i.detail === 'New tag')).toBe(true);
    });

    it('offers priority options for p trigger', () => {
      const token = getCaretToken('Task p', 6);
      const items = getAutocompleteItems(token, sampleProjects, sampleTags);
      expect(items.length).toBe(4);
      expect(items[0].label).toContain('P1');
    });

    it('offers morning and afternoon for hour number time tokens', () => {
      const token = getCaretToken('Call 3', 6);
      const items = getAutocompleteItems(token, sampleProjects, sampleTags);
      expect(items.some((i) => i.insertText === '3pm')).toBe(true);
      expect(items.some((i) => i.insertText === '3am')).toBe(true);
    });
  });

  describe('applyAutocomplete', () => {
    it('replaces active token with inserted text and appends trailing space', () => {
      const text = 'Finish report +wo';
      const result = applyAutocomplete(text, [14, 17], '+work');
      expect(result.text).toBe('Finish report +work ');
      expect(result.newCursor).toBe('Finish report +work '.length);
    });

    it('does not duplicate space if space already exists after range', () => {
      const text = 'Finish report +wo now';
      const result = applyAutocomplete(text, [14, 17], '+work');
      expect(result.text).toBe('Finish report +work now');
    });
  });

  describe('stripTokenFromText', () => {
    it('removes project token', () => {
      const text = 'Prepare slides +work tomorrow 2pm';
      const stripped = stripTokenFromText(text, 'project', 'work', sampleProjects);
      expect(stripped).toBe('Prepare slides tomorrow 2pm');
    });

    it('removes tag token', () => {
      const text = 'Call dentist #health tomorrow';
      const stripped = stripTokenFromText(text, 'tag', 'health');
      expect(stripped).toBe('Call dentist tomorrow');
    });

    it('removes date token', () => {
      const text = 'Submit invoice tomorrow 5pm';
      const stripped = stripTokenFromText(text, 'date');
      expect(stripped).toBe('Submit invoice 5pm');
    });

    it('removes time token', () => {
      const text = 'Submit invoice tomorrow 5pm';
      const stripped = stripTokenFromText(text, 'time');
      expect(stripped).toBe('Submit invoice tomorrow');
    });

    it('removes priority token', () => {
      const text = 'Fix critical bug p1 today';
      const stripped = stripTokenFromText(text, 'priority');
      expect(stripped).toBe('Fix critical bug today');
    });
  });

  describe('getQuickSuggestions', () => {
    it('suggests Today and Tomorrow when no date is present', () => {
      const suggestions = getQuickSuggestions(
        { project: null, dueDate: null, dueTime: null, priority: 0, recurrence: null, tags: [] },
        sampleProjects,
        sampleTags,
      );
      expect(suggestions.some((s) => s.label === 'Today')).toBe(true);
      expect(suggestions.some((s) => s.label === 'Tomorrow')).toBe(true);
    });

    it('suggests times when date is present but no time', () => {
      const suggestions = getQuickSuggestions(
        { project: null, dueDate: '2026-11-10', dueTime: null, priority: 0, recurrence: null, tags: [] },
        sampleProjects,
        sampleTags,
      );
      expect(suggestions.some((s) => s.label === '9:00 AM')).toBe(true);
      expect(suggestions.some((s) => s.label === '2:00 PM')).toBe(true);
    });

    it('suggests P1 when no priority is present', () => {
      const suggestions = getQuickSuggestions(
        { project: null, dueDate: null, dueTime: null, priority: 0, recurrence: null, tags: [] },
        sampleProjects,
        sampleTags,
      );
      expect(suggestions.some((s) => s.label === 'P1')).toBe(true);
    });

    it('suggests top non-inbox projects when no project is set', () => {
      const suggestions = getQuickSuggestions(
        { project: null, dueDate: null, dueTime: null, priority: 0, recurrence: null, tags: [] },
        sampleProjects,
        sampleTags,
      );
      expect(suggestions.some((s) => s.label === 'Work')).toBe(true);
    });
  });
});
