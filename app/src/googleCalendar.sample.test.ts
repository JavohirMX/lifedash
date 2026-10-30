// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./dev/sampleMode', () => ({ SAMPLE_MODE: true, DATABASE_NAME: 'lifedash-sample' }));

import { googleConnectUrl, googleDisconnect, googleEvents, googleEventsForLocalDays, googleStatus } from './googleCalendar';

const S = { url: 'https://sync.example', username: 'u', token: 'REAL-TOKEN' };

afterEach(() => vi.unstubAllGlobals());

describe('sample sandbox isolation', () => {
  it('never calls fetch for any operation', async () => {
    const f = vi.fn(async () => ({ status: 200, ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', f);
    expect(await googleStatus(S)).toEqual({ available: false, connected: false, connectedAt: null, problem: null });
    await expect(googleConnectUrl(S)).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(googleDisconnect(S)).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(googleEvents(S, '2026-11-01', '2026-11-02')).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(googleEventsForLocalDays(S, '2026-11-01', '2026-11-02')).rejects.toMatchObject({ kind: 'unavailable' });
    expect(f).not.toHaveBeenCalled();
  });
});
