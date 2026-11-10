import { useEffect, useState } from 'react';

export interface AiProviderPreset {
  id: string;
  name: string;
  defaultBaseUrl: string;
  defaultModel: string;
  description: string;
  requiresKey: boolean;
}

export const AI_PRESETS: AiProviderPreset[] = [
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    description: 'Local private models via Ollama. No API key needed.',
    requiresKey: false,
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (Local)',
    defaultBaseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    description: 'Local models served via LM Studio.',
    requiresKey: false,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (Cloud)',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.2-3b-instruct:free',
    description: 'Access hundreds of cloud models through OpenRouter.',
    requiresKey: true,
  },
  {
    id: 'openai',
    name: 'OpenAI (Cloud)',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    description: 'Direct OpenAI models (GPT-4o mini, etc.).',
    requiresKey: true,
  },
  {
    id: 'custom',
    name: 'Custom Provider',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultModel: '',
    description: 'Any OpenAI-compatible /chat/completions endpoint.',
    requiresKey: false,
  },
];

export interface AiSettings {
  enabled: boolean;
  mode: 'provider' | 'local';
  preset: string;
  baseUrl: string;
  model: string;
  saveApiKey: boolean;
  apiKey?: string;
  stream: boolean;
}

const SETTINGS_KEY = 'lifedash_ai_settings_v1';
const AI_CHANGE_EVENT = 'lifedash:ai-change';
let sessionApiKey = '';

export function getSessionApiKey(): string {
  return sessionApiKey;
}

export function setSessionApiKey(key: string): void {
  sessionApiKey = key;
}

export function defaultAiSettings(): AiSettings {
  return {
    enabled: true,
    mode: 'provider',
    preset: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
    saveApiKey: false,
    apiKey: '',
    stream: true,
  };
}

export function isAiEnabled(): boolean {
  return loadAiSettings().enabled;
}

export function loadAiSettings(): AiSettings {
  const defaults = defaultAiSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return { ...defaults, apiKey: sessionApiKey };
    }
    const parsed = JSON.parse(raw);
    const saveApiKey = Boolean(parsed.saveApiKey);
    const apiKey = saveApiKey && typeof parsed.apiKey === 'string' ? parsed.apiKey : sessionApiKey;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : defaults.enabled,
      mode: parsed.mode === 'local' ? 'local' : 'provider',
      preset: typeof parsed.preset === 'string' ? parsed.preset : defaults.preset,
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim() ? parsed.baseUrl : defaults.baseUrl,
      model: typeof parsed.model === 'string' ? parsed.model : defaults.model,
      saveApiKey,
      apiKey,
      stream: typeof parsed.stream === 'boolean' ? parsed.stream : defaults.stream,
    };
  } catch {
    return { ...defaults, apiKey: sessionApiKey };
  }
}

export function onAiSettingsChange(callback: (settings: AiSettings) => void): () => void {
  const handler = () => callback(loadAiSettings());
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener(AI_CHANGE_EVENT, handler);
    return () => window.removeEventListener(AI_CHANGE_EVENT, handler);
  }
  return () => {};
}

export function useAiSettings(): AiSettings {
  const [settings, setSettings] = useState<AiSettings>(() => loadAiSettings());
  useEffect(() => {
    return onAiSettingsChange((next) => setSettings(next));
  }, []);
  return settings;
}

export function saveAiSettings(patch: Partial<AiSettings>): AiSettings {
  const current = loadAiSettings();
  const next: AiSettings = {
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled,
    mode: patch.mode !== undefined ? (patch.mode === 'local' ? 'local' : 'provider') : current.mode,
    preset: patch.preset !== undefined ? patch.preset : current.preset,
    baseUrl: patch.baseUrl !== undefined ? patch.baseUrl.trim() : current.baseUrl,
    model: patch.model !== undefined ? patch.model.trim() : current.model,
    saveApiKey: patch.saveApiKey !== undefined ? Boolean(patch.saveApiKey) : current.saveApiKey,
    stream: patch.stream !== undefined ? Boolean(patch.stream) : current.stream,
    apiKey: patch.apiKey !== undefined ? patch.apiKey : current.apiKey,
  };

  if (next.apiKey !== undefined) {
    sessionApiKey = next.apiKey;
  }

  try {
    const toStore: Record<string, unknown> = {
      enabled: next.enabled,
      mode: next.mode,
      preset: next.preset,
      baseUrl: next.baseUrl,
      model: next.model,
      saveApiKey: next.saveApiKey,
      stream: next.stream,
    };
    if (next.saveApiKey && next.apiKey) {
      toStore.apiKey = next.apiKey;
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(toStore));
  } catch {
    // LocalStorage quota or access denied - fallback to in-memory only
  }

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent(AI_CHANGE_EVENT));
    } catch {
      // ignore
    }
  }

  return next;
}
