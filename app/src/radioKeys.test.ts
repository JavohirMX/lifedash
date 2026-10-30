import { describe, expect, it } from 'vitest';
import { radioKeyIndex } from './radioKeys';
describe('radio keyboard navigation', () => {
  it('moves forward and wraps at the last choice', () => {
    expect(radioKeyIndex('ArrowRight', 2, 3)).toBe(0);
    expect(radioKeyIndex('ArrowDown', 0, 3)).toBe(1);
  });
  it('moves backward and wraps at the first choice', () => {
    expect(radioKeyIndex('ArrowLeft', 0, 8)).toBe(7);
    expect(radioKeyIndex('ArrowUp', 3, 8)).toBe(2);
  });
  it('supports the first and last choices', () => {
    expect(radioKeyIndex('Home', 4, 8)).toBe(0);
    expect(radioKeyIndex('End', 0, 8)).toBe(7);
  });
  it('leaves Tab and unrelated keys alone and tolerates an empty group', () => {
    expect(radioKeyIndex('Tab', 0, 3)).toBeNull();
    expect(radioKeyIndex('x', 0, 3)).toBeNull();
    expect(radioKeyIndex('ArrowDown', 0, 0)).toBeNull();
  });
});
