import { describe, it, expect, vi } from 'vitest';
import { calculateSwipeOffset, resolveSwipeAction } from './useSwipeGesture';

describe('useSwipeGesture helpers', () => {
  it('calculates horizontal swipe offsets up to max bound', () => {
    // Horizontal swipe right
    expect(calculateSwipeOffset(100, 100, 150, 105)).toBe(50);
    // Exceeds max clamp (+90)
    expect(calculateSwipeOffset(100, 100, 250, 100)).toBe(90);
    // Horizontal swipe left
    expect(calculateSwipeOffset(100, 100, 40, 105)).toBe(-60);
    // Exceeds negative clamp (-90)
    expect(calculateSwipeOffset(100, 100, 0, 100)).toBe(-90);
  });

  it('ignores vertical-dominant movements', () => {
    // dy > dx
    expect(calculateSwipeOffset(100, 100, 120, 180)).toBe(0);
    expect(calculateSwipeOffset(100, 100, 105, 50)).toBe(0);
  });

  it('resolves right swipe action when above threshold', () => {
    const onRight = vi.fn();
    const onLeft = vi.fn();

    const action = resolveSwipeAction(65, 60, onRight, onLeft);
    expect(action).toBe('right');
    expect(onRight).toHaveBeenCalledTimes(1);
    expect(onLeft).not.toHaveBeenCalled();
  });

  it('resolves left swipe action when below negative threshold', () => {
    const onRight = vi.fn();
    const onLeft = vi.fn();

    const action = resolveSwipeAction(-65, 60, onRight, onLeft);
    expect(action).toBe('left');
    expect(onLeft).toHaveBeenCalledTimes(1);
    expect(onRight).not.toHaveBeenCalled();
  });

  it('does nothing when threshold is not met', () => {
    const onRight = vi.fn();
    const onLeft = vi.fn();

    const action = resolveSwipeAction(40, 60, onRight, onLeft);
    expect(action).toBe('none');
    expect(onRight).not.toHaveBeenCalled();
    expect(onLeft).not.toHaveBeenCalled();
  });
});
