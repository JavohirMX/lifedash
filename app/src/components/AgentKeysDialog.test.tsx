// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentApiError } from '../agentApi';
import { AgentKeysView, stateFromError, type PanelState } from './AgentKeysDialog';

const key = { id: '1', name: 'Claude', scope: 'read-write' as const, created_at: '2026-10-29T00:00:00Z', last_used_at: null, revoked_at: null };
const ready = (extra: Record<string, unknown> = {}): PanelState => ({
  kind: 'ready', keys: [key], busy: false, createError: null, created: null, confirmingRevoke: null, copied: false, ...extra,
});
const html = (state: PanelState) => renderToStaticMarkup(<AgentKeysView state={state} onClose={() => {}} />);

describe('AgentKeysDialog states', () => {
  it('maps errors', () => {
    expect(stateFromError(new AgentApiError('not_connected', 'x'))).toEqual({ kind: 'not_connected' });
    expect(stateFromError(new AgentApiError('network', 'Could not reach the sync server.'))).toEqual({ kind: 'error', message: 'Could not reach the sync server.' });
    expect(stateFromError(new Error('secret detail'))).toEqual({ kind: 'error', message: 'Something went wrong.' });
  });
  it('not_connected explains the Sync prerequisite', () => {
    expect(html({ kind: 'not_connected' })).toContain('Connect Sync first');
  });
  it('ready lists keys with scope and two-tap revoke', () => {
    const h = html(ready());
    expect(h).toContain('Claude');
    expect(h).toContain('Read &amp; change');
    expect(h).toContain('Revoke');
    expect(h).not.toContain('Confirm revoke');
    expect(html(ready({ confirmingRevoke: '1' }))).toContain('Confirm revoke');
  });
  it('created state shows the token once with copy guidance', () => {
    const created = { ...key, token: 'ldk_secret' };
    const h = html(ready({ created }));
    expect(h).toContain('ldk_secret');
    expect(h).toContain('shown once');
    expect(h).not.toContain('Confirm revoke');
  });
  it('empty state explains what a key does, including soft delete', () => {
    const h = html(ready({ keys: [] }));
    expect(h).toContain('No keys yet');
    expect(h).toContain('soft deletes');
  });
});
