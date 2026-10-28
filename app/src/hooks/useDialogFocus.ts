import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog focus management: focus an initial control (or the first
 * focusable one), trap Tab/Shift+Tab inside the panel, close on Escape, and
 * return focus to the opener on unmount.
 */
export function useDialogFocus<T extends HTMLElement = HTMLDivElement>(
  onClose: () => void,
  initialFocus?: string,
  enabled = true,
) {
  const panel = useRef<T>(null);

  useEffect(() => {
    if (!enabled) return;
    const opener = document.activeElement as HTMLElement | null;
    const el = panel.current;
    if (!el) return;
    const target =
      (initialFocus ? el.querySelector<HTMLElement>(initialFocus) : null) ??
      el.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();

    const onKey = (e: KeyboardEvent) => {
      // Candidate selection/cancellation belongs to the input method.
      if (e.isComposing) return;
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => !n.hasAttribute('disabled') && n.tabIndex >= 0 && n.getClientRects().length > 0,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return panel;
}
