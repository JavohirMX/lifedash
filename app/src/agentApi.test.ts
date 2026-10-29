// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentApiError, createAgentKey, listAgentKeys, revokeAgentKey } from './agentApi';
import type { SyncSettings } from './sync';

const settings: SyncSettings = { url: 'https://sync.example/', username: 'u', token: 'sess' };

function mockFetch(status: number, body?: unknown) {
  return vi.fn(async (_url: unknown, _init?: RequestInit) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status }));
}

afterEach(() => vi.unstubAllGlobals());

describe('agentApi', () => {
  it('lists active keys only and strips the trailing slash on the URL', async () => {
    const f = mockFetch(200, { tokens: [
      { id: '1', name: 'a', scope: 'read', created_at: '2026-10-29T00:00:00Z', last_used_at: null, revoked_at: null },
      { id: '2', name: 'b', scope: 'read-write', created_at: '2026-10-29T00:00:00Z', last_used_at: null, revoked_at: '2026-10-29T01:00:00Z' },
    ] });
    vi.stubGlobal('fetch', f);
    const keys = await listAgentKeys(settings);
    expect(keys.map(k => k.id)).toEqual(['1']);
    expect(f.mock.calls[0][0]).toBe('https://sync.example/api/agent-tokens');
    expect(f.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer sess' });
  });

  it('creates a key with trimmed name and scope', async () => {
    const f = mockFetch(201, { id: '1', name: 'Claude', scope: 'read', token: 'ldk_x', created_at: 't', last_used_at: null, revoked_at: null });
    vi.stubGlobal('fetch', f);
    const created = await createAgentKey(settings, '  Claude  ', 'read');
    expect(created.token).toBe('ldk_x');
    expect(JSON.parse(f.mock.calls[0][1]?.body as string)).toEqual({ name: 'Claude', scope: 'read' });
  });

  it('rejects blank names before any request', async () => {
    const f = mockFetch(200, {});
    vi.stubGlobal('fetch', f);
    await expect(createAgentKey(settings, '   ', 'read')).rejects.toBeInstanceOf(AgentApiError);
    expect(f).not.toHaveBeenCalled();
  });

  it('revokes with a POST and accepts 204', async () => {
    const f = mockFetch(204);
    vi.stubGlobal('fetch', f);
    await revokeAgentKey(settings, 'abc');
    expect(f.mock.calls[0][0]).toBe('https://sync.example/api/agent-tokens/abc/revoke');
    expect(f.mock.calls[0][1]?.method).toBe('POST');
  });

  it('maps failures to honest errors without leaking server bodies', async () => {
    vi.stubGlobal('fetch', mockFetch(403, { detail: 'internal trace' }));
    await expect(listAgentKeys(settings)).rejects.toMatchObject({ kind: 'server', message: 'The server refused the request (HTTP 403).' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    await expect(listAgentKeys(settings)).rejects.toMatchObject({ kind: 'network' });
  });

  it('refuses without a sync connection', async () => {
    await expect(listAgentKeys(null)).rejects.toMatchObject({ kind: 'not_connected' });
  });
});
