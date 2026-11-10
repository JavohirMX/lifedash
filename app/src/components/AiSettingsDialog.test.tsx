// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AiSettingsDialog from './AiSettingsDialog';
import { defaultAiSettings, saveAiSettings } from '../ai/aiSettings';

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() {
    return store.size;
  },
} as unknown as Storage;

describe('AiSettingsDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    saveAiSettings(defaultAiSettings());
  });

  it('renders settings fields and options', () => {
    const onClose = vi.fn();
    const html = renderToStaticMarkup(<AiSettingsDialog onClose={onClose} />);

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="AI settings"');
    expect(html).toContain('Provider preset');
    expect(html).toContain('Model ID');
    expect(html).toContain('API base URL');
    expect(html).toContain('API key');
    expect(html).toContain('Remember API key on this device');
    expect(html).toContain('Stream responses in real-time');
    expect(html).toContain('Test connection');
    expect(html).toContain('Reset to defaults');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('Enable AI features');
    expect(html).toContain('Planner engine');
    expect(html).toContain('Model provider (Ollama, LM Studio, Cloud APIs)');
    expect(html).toContain('On-device rule-based (No model, 100% offline)');
  });

  it('renders on-device explanation and hides model fields when mode is local', () => {
    saveAiSettings({ ...defaultAiSettings(), mode: 'local' });
    const html = renderToStaticMarkup(<AiSettingsDialog onClose={vi.fn()} />);

    expect(html).toContain('Planner engine');
    expect(html).toContain('Deterministic task ranking by due date and priority directly on this device');
    expect(html).not.toContain('Provider preset');
    expect(html).not.toContain('API base URL');
  });

  it('renders disabled state and notice when enabled is false', () => {
    saveAiSettings({ ...defaultAiSettings(), enabled: false });
    const html = renderToStaticMarkup(<AiSettingsDialog onClose={vi.fn()} />);

    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('ai-disabled-banner');
    expect(html).toContain('AI features are currently turned off');
    expect(html).toContain('ai-settings-body disabled');
  });

  it('renders presets options including Ollama and LM Studio', () => {
    const html = renderToStaticMarkup(<AiSettingsDialog onClose={vi.fn()} />);

    expect(html).toContain('Ollama (Local)');
    expect(html).toContain('LM Studio (Local)');
    expect(html).toContain('OpenRouter (Cloud)');
    expect(html).toContain('OpenAI (Cloud)');
  });

  it('renders back button when onBack prop is provided', () => {
    const onBack = vi.fn();
    const html = renderToStaticMarkup(<AiSettingsDialog onClose={vi.fn()} onBack={onBack} />);

    expect(html).toContain('Back to settings');
  });
});
