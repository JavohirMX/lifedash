// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('../dev/sampleMode', () => ({ SAMPLE_MODE: true, DATABASE_NAME: 'lifedash-sample' }));
import { renderToStaticMarkup } from 'react-dom/server';
import GoogleCalendarPanel from './GoogleCalendarPanel';

describe('panel in sample sandbox', () => {
  it('shows the sandbox note, no buttons, even with real-looking settings, and never fetches', () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const h = renderToStaticMarkup(<GoogleCalendarPanel settings={{ url: 'https://sync.example', username: 'u', token: 'REAL' }} />);
    expect(h).toContain('sample-data sandbox');
    expect(h).not.toContain('<button');
    expect(f).not.toHaveBeenCalled();
  });
});
