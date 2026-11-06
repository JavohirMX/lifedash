import { useRef, useState, type TouchEvent } from 'react';

export interface SwipeGestureOptions {
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  threshold?: number;
}

export function calculateSwipeOffset(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  maxOffset = 90
): number {
  const dx = currentX - startX;
  const dy = currentY - startY;

  // Track horizontal motion only if predominantly horizontal
  if (Math.abs(dx) > Math.abs(dy)) {
    return Math.max(-maxOffset, Math.min(maxOffset, dx));
  }
  return 0;
}

export function resolveSwipeAction(
  offsetX: number,
  threshold: number,
  onSwipeRight?: () => void,
  onSwipeLeft?: () => void
): 'right' | 'left' | 'none' {
  if (offsetX >= threshold && onSwipeRight) {
    onSwipeRight();
    return 'right';
  } else if (offsetX <= -threshold && onSwipeLeft) {
    onSwipeLeft();
    return 'left';
  }
  return 'none';
}

export function useSwipeGesture({
  onSwipeRight,
  onSwipeLeft,
  threshold = 60,
}: SwipeGestureOptions) {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const [offsetX, setOffsetX] = useState(0);

  const onTouchStart = (e: TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
  };

  const onTouchMove = (e: TouchEvent) => {
    if (startX.current === null || startY.current === null) return;
    const offset = calculateSwipeOffset(
      startX.current,
      startY.current,
      e.touches[0].clientX,
      e.touches[0].clientY
    );
    if (offset !== 0) {
      setOffsetX(offset);
    }
  };

  const onTouchEnd = () => {
    resolveSwipeAction(offsetX, threshold, onSwipeRight, onSwipeLeft);
    setOffsetX(0);
    startX.current = null;
    startY.current = null;
  };

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    offsetX,
  };
}
