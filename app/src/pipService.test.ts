// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isNativePiPSupported,
  isNativePiPActive,
  closeNativePiP,
  requestNativePiP,
  copyDocumentStyles,
  subscribeDocPip,
  getActiveDocPipWindow,
} from './pipService';

describe('pipService in Node and simulated browser', () => {
  beforeEach(() => {
    closeNativePiP();
  });

  it('checks if native PiP is supported or active in Node environment', () => {
    expect(typeof isNativePiPSupported()).toBe('boolean');
    expect(isNativePiPActive()).toBe(false);
  });

  it('handles close gracefully when no PiP is active', () => {
    expect(() => closeNativePiP()).not.toThrow();
  });

  it('handles requestNativePiP safely when window is undefined', async () => {
    const res = await requestNativePiP('timer');
    expect(res).toBe(false);
  });

  it('copies styles and theme attributes to target document mock', () => {
    const sourceStyles: any[] = [
      { cloneNode: () => ({ textContent: 'body { background: var(--ground); }' }) },
    ];
    const sourceDataset: Record<string, string> = {
      theme: 'dark',
      style: 'terminal',
    };

    const targetHeadAppended: any[] = [];
    const targetDoc: any = {
      title: '',
      head: {
        innerHTML: '',
        appendChild: (node: any) => targetHeadAppended.push(node),
      },
      documentElement: {
        dataset: {},
        style: { cssText: '' },
      },
      body: {
        style: {},
      },
    };

    // Provide temporary global document shim for copyDocumentStyles
    const originalDoc = (globalThis as any).document;
    (globalThis as any).document = {
      title: 'Lifedash Test',
      querySelectorAll: (sel: string) => (sel.includes('link') ? sourceStyles : []),
      documentElement: {
        dataset: sourceDataset,
        style: { cssText: '--font: monospace;' },
      },
    };

    try {
      copyDocumentStyles(targetDoc);

      expect(targetDoc.title).toBe('Lifedash Test · PiP');
      expect(targetDoc.documentElement.dataset.theme).toBe('dark');
      expect(targetDoc.documentElement.dataset.style).toBe('terminal');
      expect(targetDoc.documentElement.style.cssText).toBe('--font: monospace;');
      expect(targetHeadAppended.length).toBe(1);
      expect(targetDoc.body.style.margin).toBe('0');
      expect(targetDoc.body.style.overflow).toBe('hidden');
    } finally {
      (globalThis as any).document = originalDoc;
    }
  });

  it('opens and manages Document Picture-in-Picture window when API is simulated', async () => {
    const mockPipWindow: any = {
      closed: false,
      document: {
        title: '',
        head: { innerHTML: '', appendChild: vi.fn() },
        documentElement: { dataset: {}, style: { cssText: '' } },
        body: { style: {} },
      },
      focus: vi.fn(),
      close: vi.fn(function (this: any) {
        this.closed = true;
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    const originalWin = (globalThis as any).window;
    const originalDoc = (globalThis as any).document;

    (globalThis as any).document = {
      title: 'Lifedash',
      querySelectorAll: () => [],
      documentElement: { dataset: {}, style: { cssText: '' } },
    };

    (globalThis as any).window = {
      document: (globalThis as any).document,
      documentPictureInPicture: {
        requestWindow: vi.fn().mockResolvedValue(mockPipWindow),
      },
    };

    let observedWin: any = null;
    const unsub = subscribeDocPip((win) => {
      observedWin = win;
    });

    try {
      const success = await requestNativePiP('timer');
      expect(success).toBe(true);
      expect(getActiveDocPipWindow()).toBe(mockPipWindow);
      expect(observedWin).toBe(mockPipWindow);

      closeNativePiP();
      expect(mockPipWindow.close).toHaveBeenCalled();
      expect(getActiveDocPipWindow()).toBeNull();
    } finally {
      unsub();
      (globalThis as any).window = originalWin;
      (globalThis as any).document = originalDoc;
    }
  });
});
