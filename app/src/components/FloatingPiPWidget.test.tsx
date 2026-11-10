// @vitest-environment node
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import FloatingPiPWidget, { PiPCardContent } from './FloatingPiPWidget';
import {
  startTimer,
  pinTimerPiP,
  unpinTimerPiP,
  startBreathing,
  pinBreathingPiP,
  unpinBreathingPiP,
  stopTimer,
  stopBreathing,
} from '../activeTools';
import { closeNativePiP } from '../pipService';

describe('FloatingPiPWidget and PiPCardContent', () => {
  beforeEach(() => {
    unpinTimerPiP();
    unpinBreathingPiP();
    void stopTimer();
    stopBreathing();
    closeNativePiP();
  });

  it('renders nothing when no tools are running or pinned in default selection', () => {
    const html = renderToStaticMarkup(
      <FloatingPiPWidget
        currentSelection={{ kind: 'home' }}
        onNavigate={vi.fn()}
      />
    );
    expect(html).toBe('');
  });

  it('does NOT automatically start or show PiP when user starts the timer', async () => {
    await startTimer(null, 1500, 'work');

    // User navigates away to another page (e.g. home) - PiP should NOT pop up!
    const html = renderToStaticMarkup(
      <FloatingPiPWidget
        currentSelection={{ kind: 'home' }}
        onNavigate={vi.fn()}
      />
    );
    expect(html).toBe('');
  });

  it('does NOT automatically start or show PiP when user starts breathing exercise', () => {
    startBreathing();

    // User navigates away to another page (e.g. home) - PiP should NOT pop up!
    const html = renderToStaticMarkup(
      <FloatingPiPWidget
        currentSelection={{ kind: 'home' }}
        onNavigate={vi.fn()}
      />
    );
    expect(html).toBe('');
  });

  it('ONLY renders PiP widget when user explicitly clicked PiP Mode (pinTimerPiP)', () => {
    pinTimerPiP();

    const html = renderToStaticMarkup(
      <FloatingPiPWidget
        currentSelection={{ kind: 'home' }}
        onNavigate={vi.fn()}
      />
    );
    expect(html).toContain('pip-floating-widget');
    expect(html).toContain('Focus Timer');
  });

  it('ONLY renders PiP widget when user explicitly clicked PiP Mode (pinBreathingPiP)', () => {
    pinBreathingPiP();

    const html = renderToStaticMarkup(
      <FloatingPiPWidget
        currentSelection={{ kind: 'home' }}
        onNavigate={vi.fn()}
      />
    );
    expect(html).toContain('pip-floating-widget');
    expect(html).toContain('Box Breathing');
  });

  it('renders PiPCardContent for timer with unified design and buttons on one line', () => {
    const html = renderToStaticMarkup(
      <PiPCardContent
        type="timer"
        isDocumentPiP={false}
        onNavigate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // Checks header
    expect(html).toContain('Focus Timer');
    expect(html).toContain('pip-header');
    expect(html).toContain('pip-body');

    // Checks controls row
    expect(html).toContain('pip-controls-row');
    expect(html).toContain('btn-primary pip-btn');
    expect(html).toContain('btn-secondary pip-btn');
    expect(html).toContain('pip-btn-danger');

    // Verifies button texts
    expect(html).toContain('Resume');
    expect(html).toContain('Restart');
    expect(html).toContain('Stop');

    // Confirms NO gradients are used in markup or inline styles
    expect(html).not.toContain('gradient');
  });

  it('renders PiPCardContent for breathing with unified design', () => {
    const html = renderToStaticMarkup(
      <PiPCardContent
        type="breathing"
        isDocumentPiP={false}
        onNavigate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(html).toContain('Box Breathing');
    expect(html).toContain('Breathe In');
    expect(html).toContain('pip-controls-row');
    expect(html).toContain('btn-primary pip-btn');
    expect(html).toContain('Finish');
    expect(html).not.toContain('gradient');
  });

  it('renders PiPCardContent in Document PiP window mode with header actions', () => {
    const html = renderToStaticMarkup(
      <div className="pip-window-frame">
        <PiPCardContent
          type="timer"
          isDocumentPiP={true}
          onNavigate={vi.fn()}
          onClose={vi.fn()}
        />
      </div>
    );

    expect(html).toContain('pip-window-frame');
    expect(html).toContain('pip-clock-text');
    expect(html).toContain('Close PiP');
    expect(html).toContain('Expand to full timer page');
  });
});
