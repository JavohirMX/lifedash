import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from './logic';

describe('parseQuickAdd', () => {
  it('extracts tags and cleans the title', () => {
    expect(parseQuickAdd('Water plants #home #daily')).toEqual({ title: 'Water plants', tags: ['home', 'daily'] });
  });
  it('normalizes case and dash-separated words', () => {
    expect(parseQuickAdd('File taxes #Life-Admin')).toEqual({ title: 'File taxes', tags: ['life-admin'] });
  });
  it('ignores a bare # and mid-word hashes', () => {
    expect(parseQuickAdd('C# notes # dev')).toEqual({ title: 'C# notes # dev', tags: [] });
  });
});
