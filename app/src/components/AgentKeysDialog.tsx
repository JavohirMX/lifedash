import { useCallback, useEffect, useState } from 'react';
import { X, KeyRound, Copy, Check } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import './AgentKeysDialog.css';
import { loadSyncSettings } from '../sync';
import {
  AgentApiError,
  createAgentKey,
  listAgentKeys,
  revokeAgentKey,
  type AgentKeyInfo,
  type AgentKeyScope,
  type CreatedAgentKey,
} from '../agentApi';

export type PanelState =
  | { kind: 'loading' }
  | { kind: 'not_connected' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      keys: AgentKeyInfo[];
      busy: boolean;
      createError: string | null;
      created: CreatedAgentKey | null;
      confirmingRevoke: string | null;
      copied: boolean;
    };

export function stateFromError(e: unknown): PanelState {
  if (e instanceof AgentApiError && e.kind === 'not_connected') return { kind: 'not_connected' };
  const message = e instanceof AgentApiError ? e.message : 'Something went wrong.';
  return { kind: 'error', message };
}

export function AgentKeysView(props: {
  state: PanelState;
  onClose: () => void;
  onRetry?: () => void;
  onCreate?: (name: string, scope: AgentKeyScope) => void;
  onRevoke?: (id: string) => void;
  onConfirmRevoke?: (id: string | null) => void;
  onDismissCreated?: () => void;
  onCopy?: (token: string) => void;
}) {
  const { state } = props;
  const [name, setName] = useState('');
  const [scope, setScope] = useState<AgentKeyScope>('read-write');
  return (
    <div className="palette-overlay" onClick={props.onClose}>
      <div className="import-panel settings-panel agent-keys-panel" role="dialog" aria-modal="true" aria-label="Agent API keys" onClick={e => e.stopPropagation()}>
        <div className="import-head"><h2>Agent API keys</h2><button className="icon-btn" aria-label="Close" onClick={props.onClose}><X size={18} /></button></div>
        {state.kind === 'loading' && <p role="status">Loading keys…</p>}
        {state.kind === 'not_connected' && <p className="settings-help">Connect Sync first. Agent keys are managed on your sync server.</p>}
        {state.kind === 'error' && (
          <>
            <p className="form-save-error" role="alert">{state.message}</p>
            {props.onRetry && <button className="settings-row" onClick={props.onRetry}><span><strong>Try again</strong></span></button>}
          </>
        )}
        {state.kind === 'ready' && (
          <>
            {state.created && (
              <div className="settings-group" aria-label="New key">
                <p className="settings-help"><strong>{state.created.name}</strong> is ready. Copy the key now: it is shown once and cannot be retrieved later.</p>
                <p><code className="agent-key-token">{state.created.token}</code></p>
                <button className="settings-row" onClick={() => props.onCopy?.(state.created!.token)}>
                  {state.copied ? <Check size={19} /> : <Copy size={19} />}<span><strong>{state.copied ? 'Copied' : 'Copy key'}</strong></span>
                </button>
                <button className="settings-row" onClick={props.onDismissCreated}><span><strong>Done</strong></span></button>
              </div>
            )}
            {!state.created && (
              <>
                {state.keys.length === 0 && <p className="settings-help">No keys yet. A key lets an AI agent read or change your data through the API. Deletes stay soft deletes.</p>}
                {state.keys.map(k => (
                  <div className="settings-row" key={k.id}>
                    <KeyRound size={19} />
                    <span><strong>{k.name}</strong><small>{k.scope === 'read' ? 'Read only' : 'Read & change'} · created {k.created_at.slice(0, 10)}{k.last_used_at ? ` · last used ${k.last_used_at.slice(0, 10)}` : ' · never used'}</small></span>
                    {state.confirmingRevoke === k.id ? (
                      <button className="btn-secondary agent-key-revoke" disabled={state.busy} onClick={() => props.onRevoke?.(k.id)}>Confirm revoke</button>
                    ) : (
                      <button className="btn-secondary agent-key-revoke" disabled={state.busy} onClick={() => props.onConfirmRevoke?.(k.id)}>Revoke</button>
                    )}
                  </div>
                ))}
                {state.createError && <p className="form-save-error" role="alert">{state.createError}</p>}
                <form onSubmit={e => { e.preventDefault(); if (name.trim()) props.onCreate?.(name, scope); }}>
                  <label className="field">Name
                    <input id="agent-key-name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Claude" maxLength={64} disabled={state.busy} />
                  </label>
                  <label className="field">Access
                    <select aria-label="Key scope" value={scope} onChange={e => setScope(e.target.value as AgentKeyScope)} disabled={state.busy}>
                      <option value="read-write">Read & change</option>
                      <option value="read">Read only</option>
                    </select>
                  </label>
                  <div className="agent-key-actions">
                    <button type="submit" className="btn-primary" disabled={state.busy || !name.trim()}>Create key</button>
                  </div>
                </form>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function AgentKeysDialog(props: { onClose: () => void }) {
  const panel = useDialogFocus<HTMLDivElement>(props.onClose);
  const [state, setState] = useState<PanelState>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const keys = await listAgentKeys(loadSyncSettings());
      setState({ kind: 'ready', keys, busy: false, createError: null, created: null, confirmingRevoke: null, copied: false });
    } catch (e) {
      setState(stateFromError(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = (patch: Partial<Extract<PanelState, { kind: 'ready' }>>) =>
    setState(s => (s.kind === 'ready' ? { ...s, ...patch } : s));

  const onCreate = async (name: string, scope: AgentKeyScope) => {
    update({ busy: true, createError: null });
    try {
      const created = await createAgentKey(loadSyncSettings(), name, scope);
      const keys = await listAgentKeys(loadSyncSettings());
      setState({ kind: 'ready', keys, busy: false, createError: null, created, confirmingRevoke: null, copied: false });
    } catch (e) {
      update({ busy: false, createError: stateFromError(e).kind === 'error' ? (stateFromError(e) as { message: string }).message : 'Something went wrong.' });
    }
  };

  const onRevoke = async (id: string) => {
    update({ busy: true });
    try {
      await revokeAgentKey(loadSyncSettings(), id);
      const keys = await listAgentKeys(loadSyncSettings());
      setState({ kind: 'ready', keys, busy: false, createError: null, created: null, confirmingRevoke: null, copied: false });
    } catch (e) {
      const err = stateFromError(e);
      update({ busy: false, confirmingRevoke: null, createError: err.kind === 'error' ? err.message : 'Something went wrong.' });
    }
  };

  const onCopy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      update({ copied: true });
    } catch {
      update({ createError: 'Copy failed. Select the key and copy it manually.' });
    }
  };

  return (
    <div ref={panel}>
      <AgentKeysView
        state={state}
        onClose={props.onClose}
        onRetry={() => void load()}
        onCreate={(n, s) => void onCreate(n, s)}
        onRevoke={id => void onRevoke(id)}
        onConfirmRevoke={id => update({ confirmingRevoke: id })}
        onDismissCreated={() => update({ created: null, copied: false })}
        onCopy={token => void onCopy(token)}
      />
    </div>
  );
}
