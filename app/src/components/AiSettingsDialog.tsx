import './AiSettingsDialog.css';
import { useState } from 'react';
import { ArrowLeft, Eye, EyeOff, Sparkles, X, Check, AlertCircle } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import {
  loadAiSettings,
  saveAiSettings,
  defaultAiSettings,
  AI_PRESETS,
  type AiSettings,
} from '../ai/aiSettings';
import { endpointFor } from '../ai/provider';

export default function AiSettingsDialog(props: { onClose: () => void; onBack?: () => void }) {
  const panel = useDialogFocus<HTMLDivElement>(props.onClose);
  const [settings, setSettings] = useState<AiSettings>(() => loadAiSettings());
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  function updateField<K extends keyof AiSettings>(key: K, value: AiSettings[K]) {
    const next = saveAiSettings({ [key]: value });
    setSettings(next);
    setTestResult(null);
  }

  function handlePresetChange(presetId: string) {
    const preset = AI_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const next = saveAiSettings({
      preset: presetId,
      baseUrl: preset.defaultBaseUrl,
      model: preset.defaultModel || settings.model,
    });
    setSettings(next);
    setTestResult(null);
  }

  function handleReset() {
    const defaults = defaultAiSettings();
    saveAiSettings(defaults);
    setSettings(defaults);
    setTestResult(null);
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const endpoint = endpointFor(settings.baseUrl);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: settings.model || 'test',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        setTestResult({ ok: true, message: 'Connection successful! Provider is responding.' });
      } else if (res.status === 401) {
        setTestResult({ ok: false, message: 'Provider reached, but API key was invalid or missing (HTTP 401).' });
      } else if (res.status === 404) {
        setTestResult({ ok: false, message: `Model "${settings.model}" was not found on this provider (HTTP 404).` });
      } else {
        setTestResult({ ok: true, message: `Provider reached with HTTP ${res.status}. Endpoint is active.` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown network failure';
      setTestResult({
        ok: false,
        message: `Could not reach provider (${msg}). Check URL and CORS settings if using localhost.`,
      });
    } finally {
      setTesting(false);
    }
  }

  const selectedPreset = AI_PRESETS.find((p) => p.id === settings.preset) ?? AI_PRESETS[0];

  return (
    <div className="palette-overlay" onClick={props.onClose}>
      <div
        ref={panel}
        className="import-panel ai-settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="AI settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="import-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {props.onBack && (
              <button className="icon-btn" aria-label="Back to settings" onClick={props.onBack}>
                <ArrowLeft size={18} />
              </button>
            )}
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
              <Sparkles size={18} color="var(--accent, #0f766e)" />
              AI settings
            </h2>
          </div>
          <button className="icon-btn" aria-label="Close AI settings" onClick={props.onClose}>
            <X size={18} />
          </button>
        </div>

        <p className="settings-help">
          Configure local models (Ollama, LM Studio) or cloud providers. AI remains completely optional and local-first; suggestions never change your data without review.
        </p>

        <div className="ai-master-toggle-card">
          <div className="ai-master-toggle-text">
            <strong>Enable AI features</strong>
            <small>Turn off to hide all AI planning tools, suggestions, and buttons across Lifedash.</small>
          </div>
          <button
            type="button"
            className="settings-state"
            data-active={settings.enabled}
            role="switch"
            aria-checked={settings.enabled}
            aria-label="Toggle all AI features"
            onClick={() => updateField('enabled', !settings.enabled)}
            style={{ cursor: 'pointer' }}
          >
            {settings.enabled ? 'On' : 'Off'}
          </button>
        </div>

        {!settings.enabled && (
          <p className="ai-disabled-banner" role="status">
            All AI features are currently turned off. No models will be contacted, and all AI buttons and prompts are hidden.
          </p>
        )}

        <div className={`ai-settings-body ${settings.enabled ? '' : 'disabled'}`}>
          <div className="ai-settings-field">
            <label htmlFor="ai-engine-select">Planner engine</label>
            <select
              id="ai-engine-select"
              value={settings.mode}
              onChange={(e) => updateField('mode', e.target.value as 'provider' | 'local')}
            >
              <option value="provider">Model provider (Ollama, LM Studio, Cloud APIs)</option>
              <option value="local">On-device rule-based (No model, 100% offline)</option>
            </select>
          </div>

          {settings.mode === 'local' ? (
            <>
              <p className="settings-help" style={{ marginTop: -4, marginBottom: 16 }}>
                Deterministic task ranking by due date and priority directly on this device. No model inference, API keys, or network requests are used.
              </p>
              <div className="ai-settings-actions">
                <button type="button" className="mini" onClick={handleReset}>
                  Reset to defaults
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="ai-settings-grid">
          <div className="ai-settings-field">
            <label htmlFor="ai-preset-select">Provider preset</label>
            <select
              id="ai-preset-select"
              value={settings.preset}
              onChange={(e) => handlePresetChange(e.target.value)}
            >
              {AI_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="ai-settings-field">
            <label htmlFor="ai-model-input">Model ID</label>
            <input
              id="ai-model-input"
              type="text"
              value={settings.model}
              onChange={(e) => updateField('model', e.target.value)}
              placeholder="e.g. llama3.2, gpt-4o-mini"
              autoComplete="off"
            />
          </div>
        </div>

        <p className="settings-help" style={{ marginTop: -4, marginBottom: 12 }}>
          {selectedPreset.description}
        </p>

        <div className="ai-settings-field">
          <label htmlFor="ai-url-input">API base URL</label>
          <input
            id="ai-url-input"
            type="url"
            value={settings.baseUrl}
            onChange={(e) => updateField('baseUrl', e.target.value)}
            placeholder="http://localhost:11434/v1"
          />
        </div>

        <div className="ai-settings-field">
          <label htmlFor="ai-key-input">
            API key {settings.saveApiKey ? '(saved on this device)' : '(session only)'}
          </label>
          <div className="password-input-wrap">
            <input
              id="ai-key-input"
              type={showApiKey ? 'text' : 'password'}
              value={settings.apiKey ?? ''}
              onChange={(e) => updateField('apiKey', e.target.value)}
              placeholder={selectedPreset.requiresKey ? 'Required for cloud provider' : 'Optional for local models'}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="password-toggle-btn"
              aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
              title={showApiKey ? 'Hide API key' : 'Show API key'}
              onClick={() => setShowApiKey((p) => !p)}
            >
              {showApiKey ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </div>
        </div>

        <div className="ai-settings-options">
          <label className="ai-settings-checkbox">
            <input
              type="checkbox"
              checked={settings.saveApiKey}
              onChange={(e) => updateField('saveApiKey', e.target.checked)}
            />
            <span>Remember API key on this device (stored in local browser storage)</span>
          </label>
          <label className="ai-settings-checkbox">
            <input
              type="checkbox"
              checked={settings.stream}
              onChange={(e) => updateField('stream', e.target.checked)}
            />
            <span>Stream responses in real-time</span>
          </label>
        </div>

        {testResult && (
          <p
            role="status"
            className={`ai-test-result ${testResult.ok ? 'success' : 'error'}`}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {testResult.ok ? <Check size={16} /> : <AlertCircle size={16} />}
            <span>{testResult.message}</span>
          </p>
        )}

        <div className="ai-settings-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={testing || !settings.baseUrl}
            onClick={() => void testConnection()}
          >
            {testing ? 'Testing connection…' : 'Test connection'}
          </button>
          <button type="button" className="mini" onClick={handleReset}>
            Reset to defaults
          </button>
        </div>
        </>
      )}
        </div>
      </div>
    </div>
  );
}
