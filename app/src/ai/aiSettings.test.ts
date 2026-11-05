import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadAiSettings,
  saveAiSettings,
  defaultAiSettings,
  isAiEnabled,
  AI_PRESETS,
  setSessionApiKey,
  getSessionApiKey,
} from './aiSettings';

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

describe('aiSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    setSessionApiKey('');
  });

  it('provides sensible defaults with Ollama preset', () => {
    const defaults = defaultAiSettings();
    expect(defaults.preset).toBe('ollama');
    expect(defaults.baseUrl).toBe('http://localhost:11434/v1');
    expect(defaults.model).toBe('llama3.2');
    expect(defaults.saveApiKey).toBe(false);
    expect(defaults.apiKey).toBe('');
    expect(defaults.stream).toBe(true);
  });

  it('loads defaults when localStorage is empty', () => {
    const settings = loadAiSettings();
    expect(settings.baseUrl).toBe('http://localhost:11434/v1');
    expect(settings.model).toBe('llama3.2');
  });

  it('persists baseUrl and model changes without saving apiKey when saveApiKey is false', () => {
    saveAiSettings({
      baseUrl: 'http://localhost:1234/v1',
      model: 'mistral',
      saveApiKey: false,
      apiKey: 'secret-key-123',
    });

    const stored = JSON.parse(localStorage.getItem('lifedash_ai_settings_v1') ?? '{}');
    expect(stored.baseUrl).toBe('http://localhost:1234/v1');
    expect(stored.model).toBe('mistral');
    expect(stored.apiKey).toBeUndefined();

    // Session memory still holds key for current tab
    expect(getSessionApiKey()).toBe('secret-key-123');
    expect(loadAiSettings().apiKey).toBe('secret-key-123');
  });

  it('persists apiKey when saveApiKey is true', () => {
    saveAiSettings({
      preset: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      saveApiKey: true,
      apiKey: 'sk-persisted-secret',
    });

    const stored = JSON.parse(localStorage.getItem('lifedash_ai_settings_v1') ?? '{}');
    expect(stored.apiKey).toBe('sk-persisted-secret');
    expect(stored.saveApiKey).toBe(true);

    const loaded = loadAiSettings();
    expect(loaded.apiKey).toBe('sk-persisted-secret');
  });

  it('clears persisted key if saveApiKey is toggled off', () => {
    saveAiSettings({
      saveApiKey: true,
      apiKey: 'sk-temp-key',
    });
    expect(JSON.parse(localStorage.getItem('lifedash_ai_settings_v1') ?? '{}').apiKey).toBe('sk-temp-key');

    saveAiSettings({ saveApiKey: false });
    expect(JSON.parse(localStorage.getItem('lifedash_ai_settings_v1') ?? '{}').apiKey).toBeUndefined();
  });

  it('has preset entries for ollama, lmstudio, openrouter, openai, and custom', () => {
    const ids = AI_PRESETS.map((p) => p.id);
    expect(ids).toContain('ollama');
    expect(ids).toContain('lmstudio');
    expect(ids).toContain('openrouter');
    expect(ids).toContain('openai');
    expect(ids).toContain('custom');
  });

  it('defaults to enabled = true and supports toggling off all AI features', () => {
    expect(defaultAiSettings().enabled).toBe(true);
    expect(isAiEnabled()).toBe(true);

    saveAiSettings({ enabled: false });
    expect(isAiEnabled()).toBe(false);
    expect(loadAiSettings().enabled).toBe(false);

    const stored = JSON.parse(localStorage.getItem('lifedash_ai_settings_v1') ?? '{}');
    expect(stored.enabled).toBe(false);

    saveAiSettings({ enabled: true });
    expect(isAiEnabled()).toBe(true);
  });
});
