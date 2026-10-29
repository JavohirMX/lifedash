/**
 * Client for the agent API key management on the sync server
 * (server/app/agent.py). UI-independent: nothing here renders anything.
 *
 * Keys let AI agents read (and, when allowed, change) Lifedash data through
 * the server's /api/agent endpoints. A key is shown once at creation; the
 * server stores only its hash. Deletes through the API are soft deletes.
 */
import type { SyncSettings } from './sync';
import { SAMPLE_MODE } from './dev/sampleMode';

export type AgentKeyScope = 'read' | 'read-write';

export interface AgentKeyInfo {
  id: string;
  name: string;
  scope: AgentKeyScope;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface CreatedAgentKey extends AgentKeyInfo {
  token: string;
}

export class AgentApiError extends Error {
  constructor(
    public kind: 'not_connected' | 'network' | 'bad_response' | 'server',
    message: string,
  ) {
    super(message);
  }
}

const base = (s: SyncSettings) => s.url.replace(/\/$/, '');

async function call<T>(s: SyncSettings, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base(s)}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new AgentApiError('network', 'Could not reach the sync server.');
  }
  if (!res.ok) {
    // Server detail text can carry internals; show the status, not the body.
    throw new AgentApiError('server', `The server refused the request (HTTP ${res.status}).`);
  }
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new AgentApiError('bad_response', 'The server sent an unreadable response.');
  }
}

function requireSettings(s: SyncSettings | null): SyncSettings {
  if (SAMPLE_MODE || !s) throw new AgentApiError('not_connected', 'Connect Sync first to manage agent keys.');
  return s;
}

export async function listAgentKeys(s: SyncSettings | null): Promise<AgentKeyInfo[]> {
  const settings = requireSettings(s);
  const data = await call<{ tokens: AgentKeyInfo[] }>(settings, 'GET', '/api/agent-tokens');
  return data.tokens.filter((t) => t.revoked_at === null);
}

export async function createAgentKey(s: SyncSettings | null, name: string, scope: AgentKeyScope): Promise<CreatedAgentKey> {
  const settings = requireSettings(s);
  const trimmed = name.trim();
  if (!trimmed) throw new AgentApiError('bad_response', 'Enter a name for the key.');
  return call<CreatedAgentKey>(settings, 'POST', '/api/agent-tokens', { name: trimmed, scope });
}

export async function revokeAgentKey(s: SyncSettings | null, id: string): Promise<void> {
  const settings = requireSettings(s);
  await call<undefined>(settings, 'POST', `/api/agent-tokens/${encodeURIComponent(id)}/revoke`);
}
