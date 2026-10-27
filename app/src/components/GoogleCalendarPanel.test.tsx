// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GoogleCalendarError } from '../googleCalendar';
import GoogleCalendarPanel, { GoogleCalendarView, stateFromError, stateFromStatus, type PanelState } from './GoogleCalendarPanel';

const html = (state: PanelState, extra: Record<string, unknown> = {}) => renderToStaticMarkup(<GoogleCalendarView state={state} {...extra} />);

describe('GoogleCalendarPanel states', () => {
  it('maps server status to a state', () => {
    expect(stateFromStatus({ available: false, connected: false, connectedAt: null, problem: null })).toEqual({ kind: 'unavailable' });
    expect(stateFromStatus({ available: true, connected: false, connectedAt: null, problem: null })).toEqual({ kind: 'disconnected' });
    expect(stateFromStatus({ available: true, connected: true, connectedAt: '2026-11-03T01:00:00Z', problem: null })).toEqual({ kind: 'connected', connectedAt: '2026-11-03T01:00:00Z' });
  });
  it('maps errors', () => {
    expect(stateFromError(new GoogleCalendarError('reconnect', 'x'))).toEqual({ kind: 'reconnect' });
    expect(stateFromError(new GoogleCalendarError('network', 'Could not reach the sync server.'))).toEqual({ kind: 'error', message: 'Could not reach the sync server.' });
    expect(stateFromError(new Error('secret detail'))).toEqual({ kind: 'error', message: 'Something went wrong.' });
  });
  it('disconnected shows scope, limits and a read-only connect button, and no disconnect', () => {
    const h = html({ kind: 'disconnected' });
    expect(h).toContain('Connect Google (read-only)');
    expect(h).toContain('primary Google calendar');expect(h).toContain('Event display is not wired');
    expect(h).toContain('about every 7 days');
    expect(h).toContain('Primary calendar only');
    expect(h).not.toContain('Disconnect Google');
  });
  it('connected shows disconnect only', () => {
    const h = html({ kind: 'connected', connectedAt: '2026-11-03T01:00:00Z' });
    expect(h).toContain('Disconnect Google');
    expect(h).not.toContain('Connect Google');
  });
  it('reconnect and error states offer the right action', () => {
    expect(html({ kind: 'reconnect' })).toContain('Reconnect Google');
    expect(html({ kind: 'error', message: 'boom' })).toContain('Try again');
  });
  it('unavailable and signed-out show no action buttons', () => {
    for (const k of ['unavailable', 'signed_out', 'sample'] as const) expect(html({ kind: k })).not.toContain('<button');
  });
  it('message text is escaped', () => {
    expect(html({ kind: 'error', message: '<img src=x onerror=alert(1)>' })).not.toContain('<img');
  });
  it('signed-out container renders without touching the network', () => {
    const h = renderToStaticMarkup(<GoogleCalendarPanel settings={null} />);
    expect(h).toContain('Sign in to your sync server first');
  });
});
