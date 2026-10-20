import { useEffect, useRef, useState } from 'react';
import type { Task } from '../types';
import { requestAdvice, reviewRequest, type ReviewedRequest } from './provider';
import './assistant.css';

export default function AssistantDialog({ tasks, onClose }: { tasks: Task[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const abort = useRef<AbortController>();
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434/v1');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [prompt, setPrompt] = useState('Help me choose a realistic order for these tasks. Explain tradeoffs and do not change anything.');
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState<ReviewedRequest | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const taskContext = JSON.stringify(tasks.filter(t => selected.includes(t.id)).map(t => ({ title: t.title, dueDate: t.dueDate, priority: t.priority, status: t.status })), null, 2);
  useEffect(() => { dialog.current?.showModal(); return () => abort.current?.abort(); }, []);
  useEffect(() => { setReviewed(null); setApproved(false); setAnswer(''); setError(''); }, [baseUrl, model, apiKey, prompt, taskContext]);
  async function send() {
    if (!reviewed || !approved || busy) return;
    const request = reviewed;
    setBusy(true); setError(''); setAnswer(''); setApproved(false);
    const controller = new AbortController(); abort.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 60000);
    try { setAnswer(await requestAdvice({ baseUrl, model, apiKey }, request, true, { signal: controller.signal })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Request failed. Check CORS and provider settings.'); }
    finally { clearTimeout(timer); setBusy(false); }
  }
  return <dialog ref={dialog} className="ai-dialog" aria-labelledby="ai-title" onCancel={onClose} onClose={onClose}>
    <header><div><p className="ai-eyebrow">OPTIONAL · YOUR MODELS</p><h2 id="ai-title">Plan with AI</h2></div><button aria-label="Close AI planner" onClick={onClose}>Close</button></header>
    <p>Get a second opinion, not an autopilot. Suggestions never change your tasks.</p>
    <fieldset disabled={busy}>
      <div className="ai-fields"><label>Provider API base URL<input type="url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="http://localhost:11434/v1" /></label><label>Model ID<input value={model} onChange={e => setModel(e.target.value)} placeholder="Your installed or cloud model ID" autoComplete="off" /></label></div>
      <p className="ai-hint">Ollama: localhost:11434/v1. LM Studio: localhost:1234/v1. Cloud: your HTTPS OpenAI-compatible API base URL. Local servers must allow this app's origin (CORS). A localhost endpoint can still route to a cloud model.</p>
      <label>API key (optional, held only while this window is open)<input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} autoComplete="off" /></label>
      <h3>Choose what to share</h3><p className="ai-hint">Nothing is selected by default. Only titles, due dates, priority and status are included. Notes, journal, attachments and sync credentials stay out.</p>
      <div className="ai-task-picker">{tasks.filter(t => t.status === 'active').map(t => <label key={t.id}><input type="checkbox" checked={selected.includes(t.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, t.id] : ids.filter(id => id !== t.id))} /><span>{t.title}</span></label>)}{!tasks.some(t => t.status === 'active') && <p>No active tasks. You can still ask a planning question.</p>}</div>
      <label>Your request<textarea rows={3} value={prompt} onChange={e => setPrompt(e.target.value)} /></label>
      <button className="btn-primary" onClick={() => { try { setReviewed(reviewRequest({ baseUrl, model, apiKey }, prompt, taskContext)); setError(''); } catch(e) { setError((e as Error).message); } }}>Review request</button>
    </fieldset>
    {reviewed && <section className="ai-review"><h3>Review before sending</h3><p>Destination: <code>{reviewed.endpoint}</code><br />Model: <code>{reviewed.model}</code></p><pre>{reviewed.prompt}{'\n\n'}{reviewed.context}</pre><label className="ai-consent"><input type="checkbox" checked={approved} disabled={busy} onChange={e => setApproved(e.target.checked)} /><span>I approve sending this exact request and data to this provider. Cloud models may charge my account and follow their own data policies.</span></label><button className="btn-primary" disabled={!approved || busy} onClick={() => void send()}>{busy ? 'Waiting for model...' : 'Send this request'}</button></section>}
    {busy && <button onClick={() => abort.current?.abort()}>Stop waiting</button>}
    {error && <p role="alert" className="ai-error">{error}</p>}
    {answer && <section aria-live="polite" className="ai-answer"><h3>Suggested plan</h3><p>Review this yourself. Nothing has been changed.</p><pre>{answer}</pre></section>}
    <p className="ai-hint">No background calls, automatic retries or saved API keys. Stopping a request may not stop provider billing. Advice is plain text, not executable instructions.</p>
  </dialog>;
}
