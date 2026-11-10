/**
 * Picture-in-Picture Service
 * Provides native OS floating Picture-in-Picture window via Document Picture-in-Picture API
 * with HTML5 Video + Canvas PiP fallback.
 * Integrates directly with React portals so the native PiP window renders 100% of the Lifedash
 * design system, fonts, tokens, and active state.
 */

import {
  getTimerState,
  getBreathingState,
  getElapsedTimerSeconds,
  BREATHING_PHASES,
  unpinTimerPiP,
  unpinBreathingPiP,
} from './activeTools';
import { formatClock, calculateRemaining } from './focus';

export type DocPipListener = (win: Window | null, type: 'timer' | 'breathing') => void;

let activeDocPipWindow: Window | null = null;
let activeDocPipType: 'timer' | 'breathing' = 'timer';
const docPipListeners = new Set<DocPipListener>();

let videoPipElement: HTMLVideoElement | null = null;
let videoCanvas: HTMLCanvasElement | null = null;
let animFrameId: number | null = null;

export function isNativePiPSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'documentPictureInPicture' in window ||
    Boolean(document.pictureInPictureEnabled)
  );
}

export function isNativePiPActive(): boolean {
  if (activeDocPipWindow && !activeDocPipWindow.closed) return true;
  if (typeof document !== 'undefined' && document.pictureInPictureElement) return true;
  return false;
}

export function getActiveDocPipWindow(): Window | null {
  if (activeDocPipWindow && !activeDocPipWindow.closed) {
    return activeDocPipWindow;
  }
  return null;
}

export function getActiveDocPipType(): 'timer' | 'breathing' {
  return activeDocPipType;
}

export function subscribeDocPip(listener: DocPipListener): () => void {
  docPipListeners.add(listener);
  listener(getActiveDocPipWindow(), activeDocPipType);
  return () => {
    docPipListeners.delete(listener);
  };
}

function notifyDocPipListeners() {
  const win = getActiveDocPipWindow();
  for (const listener of docPipListeners) {
    try {
      listener(win, activeDocPipType);
    } catch (e) {
      console.error('Error in docPipListener:', e);
    }
  }
}

export function closeNativePiP(): void {
  try {
    unpinTimerPiP();
    unpinBreathingPiP();
  } catch {
    // Ignore in tests or when unmounted
  }
  if (activeDocPipWindow && !activeDocPipWindow.closed) {
    try {
      activeDocPipWindow.close();
    } catch {
      // Ignore if already closed
    }
  }
  activeDocPipWindow = null;
  notifyDocPipListeners();

  if (typeof document !== 'undefined' && document.pictureInPictureElement) {
    void document.exitPictureInPicture().catch(() => {});
  }
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

/**
 * Copies all active Lifedash stylesheets, theme attributes, and fonts
 * from the main document to the target PiP window's document.
 */
export function copyDocumentStyles(targetDoc: Document): void {
  // Clear any existing copied tags
  targetDoc.head.innerHTML = '';

  // Title
  targetDoc.title = document.title ? `${document.title} · PiP` : 'Lifedash PiP';

  // 1. Copy all <link rel="stylesheet"> and <style> elements from main document head
  const headElements = document.querySelectorAll('link[rel="stylesheet"], style');
  headElements.forEach((node) => {
    targetDoc.head.appendChild(node.cloneNode(true));
  });

  // 2. Sync root documentElement dataset attributes (data-theme, data-style, data-font, etc.)
  for (const [key, val] of Object.entries(document.documentElement.dataset)) {
    if (val !== undefined) {
      targetDoc.documentElement.dataset[key] = val;
    }
  }

  // 3. Sync root inline styles (CSS custom properties, e.g., --font, --wallpaper-image)
  targetDoc.documentElement.style.cssText = document.documentElement.style.cssText;

  // 4. Style body to match app background and font
  targetDoc.body.style.margin = '0';
  targetDoc.body.style.padding = '0';
  targetDoc.body.style.background = 'var(--ground)';
  targetDoc.body.style.color = 'var(--text)';
  targetDoc.body.style.fontFamily = 'var(--font, ui-sans-serif, system-ui, sans-serif)';
  targetDoc.body.style.overflow = 'hidden';
  targetDoc.body.style.width = '100vw';
  targetDoc.body.style.height = '100vh';
}

/**
 * Keeps documentElement attributes and styles synchronized with the main document in real time.
 */
export function observeDocumentTheme(targetDoc: Document): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }
  const syncAttributes = () => {
    for (const [key, val] of Object.entries(document.documentElement.dataset)) {
      if (val !== undefined) {
        targetDoc.documentElement.dataset[key] = val;
      } else {
        delete targetDoc.documentElement.dataset[key];
      }
    }
    targetDoc.documentElement.style.cssText = document.documentElement.style.cssText;
  };

  const observer = new MutationObserver(syncAttributes);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-style', 'data-font', 'style'],
  });

  return () => {
    observer.disconnect();
  };
}

/**
 * Requests native OS Picture-in-Picture for Timer or Breathing.
 */
export async function requestNativePiP(type: 'timer' | 'breathing'): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  // 1. Try Document Picture-in-Picture (Chrome, Edge 116+)
  if ('documentPictureInPicture' in window) {
    try {
      if (activeDocPipWindow && !activeDocPipWindow.closed) {
        activeDocPipType = type;
        notifyDocPipListeners();
        activeDocPipWindow.focus();
        return true;
      }

      const pipWin = await (window as any).documentPictureInPicture.requestWindow({
        width: 340,
        height: 180,
      });

      copyDocumentStyles(pipWin.document);
      const stopObserving = observeDocumentTheme(pipWin.document);

      activeDocPipWindow = pipWin;
      activeDocPipType = type;
      notifyDocPipListeners();

      pipWin.addEventListener('pagehide', () => {
        stopObserving();
        try {
          unpinTimerPiP();
          unpinBreathingPiP();
        } catch {
          // Ignore
        }
        if (activeDocPipWindow === pipWin) {
          activeDocPipWindow = null;
          notifyDocPipListeners();
        }
      });

      return true;
    } catch (err) {
      console.warn('Document Picture-in-Picture request failed, attempting canvas fallback:', err);
    }
  }

  // 2. Fallback: HTML5 Video Canvas PiP (Safari, Firefox, Chrome)
  if (typeof document !== 'undefined' && document.pictureInPictureEnabled) {
    try {
      return await startCanvasVideoPiP(type);
    } catch (err) {
      console.warn('Canvas Video Picture-in-Picture failed:', err);
    }
  }

  return false;
}

/**
 * Fallback Canvas + Video Picture-in-Picture
 */
async function startCanvasVideoPiP(type: 'timer' | 'breathing'): Promise<boolean> {
  if (!videoCanvas) {
    videoCanvas = document.createElement('canvas');
    videoCanvas.width = 340;
    videoCanvas.height = 180;
  }
  if (!videoPipElement) {
    videoPipElement = document.createElement('video');
    videoPipElement.muted = true;
    videoPipElement.autoplay = true;
    videoPipElement.playsInline = true;
    videoPipElement.style.position = 'fixed';
    videoPipElement.style.opacity = '0';
    videoPipElement.style.pointerEvents = 'none';
    videoPipElement.style.zIndex = '-9999';
    document.body.appendChild(videoPipElement);
  }

  const ctx = videoCanvas.getContext('2d');
  if (!ctx) return false;

  const stream = (videoCanvas as any).captureStream ? (videoCanvas as any).captureStream(10) : null;
  if (!stream) return false;

  videoPipElement.srcObject = stream;
  await videoPipElement.play();

  drawFrame(ctx, type);

  const loop = () => {
    if (document.pictureInPictureElement === videoPipElement) {
      drawFrame(ctx, type);
      animFrameId = requestAnimationFrame(loop);
    }
  };

  await videoPipElement.requestPictureInPicture();
  animFrameId = requestAnimationFrame(loop);

  videoPipElement.addEventListener(
    'leavepictureinpicture',
    () => {
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
    },
    { once: true }
  );

  return true;
}

function drawFrame(ctx: CanvasRenderingContext2D, type: 'timer' | 'breathing') {
  // Solid background - ZERO GRADIENTS
  ctx.fillStyle = '#14171a';
  ctx.fillRect(0, 0, 340, 180);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (type === 'timer') {
    const t = getTimerState();
    const elapsed = getElapsedTimerSeconds();
    const remaining = calculateRemaining(t.targetDurationSec, elapsed);
    const clockText = t.timerMode === 'stopwatch' ? formatClock(elapsed) : formatClock(remaining);

    // Title / Stage
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText(t.stage === 'work' ? 'FOCUS TIMER' : 'BREAK', 170, 38);

    // Clock digits
    ctx.fillStyle = t.stage === 'work' ? '#10b981' : '#059669';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.fillText(clockText, 170, 88);

    // Status
    ctx.fillStyle = '#64748b';
    ctx.font = '500 12px system-ui, sans-serif';
    ctx.fillText(t.isPaused ? 'Paused' : t.stage === 'work' ? 'Deep Work' : 'Rest Break', 170, 134);
  } else {
    const b = getBreathingState();
    const phase = BREATHING_PHASES[b.phaseIndex] ?? BREATHING_PHASES[0];

    // Solid Circle - ZERO GRADIENTS
    ctx.fillStyle = '#0f766e';
    ctx.beginPath();
    const radius = b.isActive
      ? b.phaseIndex === 0
        ? 34 + (4 - b.secondsRemaining) * 4
        : b.phaseIndex === 2
        ? 50 - (4 - b.secondsRemaining) * 4
        : b.phaseIndex === 1
        ? 50
        : 34
      : 36;
    ctx.arc(170, 78, Math.max(20, radius), 0, Math.PI * 2);
    ctx.fill();

    // Phase text inside
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillText(b.isActive ? phase.label : 'Ready', 170, 72);

    // Count
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillText(b.isActive ? `${b.secondsRemaining}s` : '4s', 170, 94);

    // Bottom cycles text
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 12px system-ui, sans-serif';
    ctx.fillText(
      b.completedCycles > 0 ? `${b.completedCycles} cycles completed` : 'Box Breathing',
      170,
      150
    );
  }
}
