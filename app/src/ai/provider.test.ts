import { describe, it, expect, vi } from 'vitest';
import { endpointFor, reviewRequest, requestAdvice } from './provider';
const config = { baseUrl: 'http://localhost:11434/v1', model: 'local-model', apiKey: 'test-only' };
describe('model safety boundary', () => {
  it('allows local Ollama/LM Studio and HTTPS providers', () => {
    expect(endpointFor(config.baseUrl)).toBe('http://localhost:11434/v1/chat/completions');
    expect(endpointFor('http://127.0.0.1:1234/v1/')).toBe('http://127.0.0.1:1234/v1/chat/completions');
    expect(endpointFor('https://provider.example/v1')).toBe('https://provider.example/v1/chat/completions');
  });
  it.each(['http://provider.example/v1', 'https://key:secret@provider.example/v1', 'https://provider.example/v1?key=secret', 'https://provider.example/v1#key', 'file:///tmp/model'])('rejects unsafe URL %s', (url) => expect(() => endpointFor(url)).toThrow());
  it('bounds input', () => {
    expect(() => reviewRequest(config, '', '')).toThrow();
    expect(() => reviewRequest(config, 'plan', 'x'.repeat(24001))).toThrow();
  });
  it('never fetches without approval', async () => {
    const fetcher = vi.fn();
    await expect(requestAdvice(config, reviewRequest(config, 'plan', ''), false, { fetcher })).rejects.toThrow('approve');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects changed endpoint or model', async () => {
    const fetcher = vi.fn();
    await expect(requestAdvice({ ...config, model: 'changed' }, reviewRequest(config, 'plan', ''), true, { fetcher })).rejects.toThrow('changed');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('sends only reviewed input with no cookies, redirects or tool actions', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'Try task A.' } }] }) });
    expect(await requestAdvice(config, reviewRequest(config, 'plan', 'task A'), true, { fetcher })).toBe('Try task A.');
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(endpointFor(config.baseUrl));
    expect(init.credentials).toBe('omit'); expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body).tools).toBeUndefined();
    expect(JSON.parse(init.body).messages[1].content).toBe(JSON.stringify({ request: 'plan', taskContext: 'task A' }));
  });
  it('does not retry failures or reveal response bodies', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(requestAdvice(config, reviewRequest(config, 'plan', ''), true, { fetcher })).rejects.toThrow('HTTP 401');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects non-text output', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [] }) });
    await expect(requestAdvice(config, reviewRequest(config, 'plan', ''), true, { fetcher })).rejects.toThrow('no text');
  });
});
