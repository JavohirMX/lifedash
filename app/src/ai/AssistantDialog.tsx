import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Sparkles, Check, Calendar, ListPlus, CheckSquare } from 'lucide-react';
import { radioKeyIndex } from '../radioKeys';
import type { Task } from '../types';
import { db, INBOX_ID } from '../db';
import { addTask, updateTask } from '../repo';
import { requestAdvice, reviewRequest, type ReviewedRequest } from './provider';
import { localPlan } from './localPlanner';
import {
  useAiSettings,
  AI_PRESETS,
} from './aiSettings';
import { parseAiResponse, type SubtaskProposal, type ScheduleProposal, type CreateTasksProposal } from './proposalParser';
import { MarkdownView } from './MarkdownView';
import './assistant.css';

const PROMPT_PRESETS = [
  { label: '🎯 Prioritize tasks', text: 'Help me choose a realistic order for these tasks. Explain tradeoffs and suggest which to do first.' },
  { label: '⏱️ Plan day schedule', text: 'Propose a realistic hourly time-block schedule for today from 9:00 to 18:00 with breaks.' },
  { label: '🔍 Find bottlenecks', text: 'Identify potential bottlenecks, missing steps, and dependencies across these items.' },
  { label: '📝 Suggest subtasks', text: 'Break down each selected task into 3-5 concrete, actionable subtasks.' },
];

export default function AssistantDialog({ tasks, onClose }: { tasks: Task[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const abort = useRef<AbortController>();

  const settings = useAiSettings();
  const [mode, setMode] = useState<'local' | 'provider'>('local');
  const [prompt, setPrompt] = useState('Help me choose a realistic order for these tasks. Explain tradeoffs and do not change anything.');
  const [selected, setSelected] = useState<string[]>([]);
  const [includeGoals, setIncludeGoals] = useState(false);
  const [includeHabits, setIncludeHabits] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);

  const [reviewed, setReviewed] = useState<ReviewedRequest | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');

  // Proposals & Execution state
  const [selectedSubtasks, setSelectedSubtasks] = useState<Record<string, boolean>>({});
  const [selectedSchedule, setSelectedSchedule] = useState<Record<string, boolean>>({});
  const [selectedNewTasks, setSelectedNewTasks] = useState<Record<string, boolean>>({});
  const [appliedNotice, setAppliedNotice] = useState<string>('');
  const [targetParentTask, setTargetParentTask] = useState<string>('');

  // Live query context
  const goals = useLiveQuery(() => db.goals.filter((g) => g.status === 'active').toArray(), []);
  const habits = useLiveQuery(() => db.habits.filter((h) => !h.archived).toArray(), []);
  const notes = useLiveQuery(() => db.notes.filter((n) => n.pinned).toArray(), []);

  // Build context payload
  const activeTasks = tasks.filter((t) => t.status === 'active');
  const selectedTaskList = tasks.filter((t) => selected.includes(t.id));

  const contextObj: Record<string, unknown> = {
    tasks: selectedTaskList.map((t) => ({
      id: t.id,
      title: t.title,
      dueDate: t.dueDate,
      dueTime: t.dueTime,
      priority: t.priority,
      status: t.status,
    })),
  };

  if (includeGoals && goals && goals.length > 0) {
    contextObj.goals = goals.slice(0, 10).map((g) => ({ id: g.id, title: g.title, targetDate: g.targetDate }));
  }
  if (includeHabits && habits && habits.length > 0) {
    contextObj.habits = habits.slice(0, 10).map((h) => ({ id: h.id, name: h.name, weekdays: h.weekdays }));
  }
  if (includeNotes && notes && notes.length > 0) {
    contextObj.pinnedNotes = notes.slice(0, 5).map((n) => ({ title: n.title, excerpt: n.note.slice(0, 200) }));
  }

  const taskContext = JSON.stringify(contextObj, null, 2);

  useEffect(() => {
    dialog.current?.showModal();
    return () => abort.current?.abort();
  }, []);

  useEffect(() => {
    setReviewed(null);
    setApproved(false);
    setAnswer('');
    setError('');
    setAppliedNotice('');
  }, [mode, settings.baseUrl, settings.model, settings.apiKey, prompt, taskContext]);

  function selectAllActiveTasks() {
    setSelected(activeTasks.map((t) => t.id));
  }

  function selectDueTodayTasks() {
    const today = new Date().toISOString().slice(0, 10);
    setSelected(activeTasks.filter((t) => t.dueDate === today).map((t) => t.id));
  }

  function selectOverdueTasks() {
    const today = new Date().toISOString().slice(0, 10);
    setSelected(activeTasks.filter((t) => t.dueDate && t.dueDate < today).map((t) => t.id));
  }

  function review() {
    try {
      setReviewed(
        reviewRequest(
          { baseUrl: settings.baseUrl, model: settings.model, apiKey: settings.apiKey },
          prompt,
          taskContext,
        ),
      );
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function runLocal() {
    if (busy) return;
    setBusy(true);
    setError('');
    setAnswer('');
    setAppliedNotice('');
    try {
      if (taskContext.length > 24000) throw new Error('Choose less context (up to 24,000 characters).');
      const filteredTasks = tasks.filter((t) => selected.includes(t.id));
      setAnswer(localPlan(prompt, filteredTasks));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Local summary failed.');
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!reviewed || !approved || busy) return;
    const request = reviewed;
    setBusy(true);
    setError('');
    setAnswer('');
    setApproved(false);
    setAppliedNotice('');

    const controller = new AbortController();
    abort.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 60000);

    try {
      const res = await requestAdvice(
        { baseUrl: settings.baseUrl, model: settings.model, apiKey: settings.apiKey },
        request,
        true,
        {
          signal: controller.signal,
          stream: settings.stream,
          onChunk: (_chunk, accumulated) => {
            setAnswer(accumulated);
          },
        },
      );
      setAnswer(res);
      // Initialize proposals checkbox state
      const parsed = parseAiResponse(res);
      for (const p of parsed.proposals) {
        if (p.action === 'subtasks') {
          const m: Record<string, boolean> = {};
          p.items.forEach((_, idx) => (m[idx] = true));
          setSelectedSubtasks(m);
          if (p.parentTaskId) setTargetParentTask(p.parentTaskId);
          else if (selected.length > 0) setTargetParentTask(selected[0]);
        } else if (p.action === 'schedule') {
          const m: Record<string, boolean> = {};
          p.items.forEach((_, idx) => (m[idx] = true));
          setSelectedSchedule(m);
        } else if (p.action === 'create_tasks') {
          const m: Record<string, boolean> = {};
          p.items.forEach((_, idx) => (m[idx] = true));
          setSelectedNewTasks(m);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed. Check CORS and provider settings.');
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  // Action Apply Handlers
  async function applySubtasks(proposal: SubtaskProposal) {
    const parentId = targetParentTask || proposal.parentTaskId || (selected.length > 0 ? selected[0] : null);
    if (!parentId) {
      setError('Select a parent task to attach these subtasks to.');
      return;
    }
    const parent = tasks.find((t) => t.id === parentId);
    let count = 0;
    for (let i = 0; i < proposal.items.length; i++) {
      if (selectedSubtasks[i]) {
        await addTask({
          title: proposal.items[i],
          projectId: parent?.projectId || INBOX_ID,
          parentId,
          dueDate: parent?.dueDate,
        });
        count++;
      }
    }
    setAppliedNotice(`Added ${count} subtask${count === 1 ? '' : 's'} to "${parent?.title ?? 'selected task'}".`);
  }

  async function applySchedule(proposal: ScheduleProposal) {
    let count = 0;
    for (let i = 0; i < proposal.items.length; i++) {
      if (selectedSchedule[i]) {
        const item = proposal.items[i];
        await updateTask(item.taskId, {
          plannedDate: item.date,
          plannedTime: item.time,
          ...(item.durationMinutes ? { durationMinutes: item.durationMinutes } : {}),
        });
        count++;
      }
    }
    setAppliedNotice(`Scheduled ${count} task${count === 1 ? '' : 's'} on timeline.`);
  }

  async function applyNewTasks(proposal: CreateTasksProposal) {
    let count = 0;
    for (let i = 0; i < proposal.items.length; i++) {
      if (selectedNewTasks[i]) {
        const item = proposal.items[i];
        await addTask({
          title: item.title,
          priority: item.priority ?? 0,
          dueDate: item.dueDate,
          dueTime: item.dueTime,
          tags: item.tags,
          note: item.note,
          projectId: INBOX_ID,
        });
        count++;
      }
    }
    setAppliedNotice(`Created ${count} new task${count === 1 ? '' : 's'} in Inbox.`);
  }

  const parsed = parseAiResponse(answer);

  return (
    <dialog ref={dialog} className="ai-dialog" aria-labelledby="ai-title" onCancel={onClose} onClose={onClose}>
      <header>
        <div>
          <p className="ai-eyebrow">OPTIONAL · SECOND OPINION</p>
          <h2 id="ai-title">Plan with AI</h2>
        </div>
        <button aria-label="Close AI planner" onClick={onClose}>
          Close
        </button>
      </header>
      <p>Get a second opinion, not an autopilot. Suggestions never change your tasks without your review.</p>

      <div className="mode-seg" role="radiogroup" aria-label="Planner source">
        {(
          [
            ['local', 'On-device'],
            ['provider', 'Model provider'],
          ] as const
        ).map(([id, label], index) => (
          <button
            key={id}
            role="radio"
            aria-checked={mode === id}
            tabIndex={mode === id ? 0 : -1}
            onKeyDown={(e) => {
              const next = radioKeyIndex(e.key, index, 2);
              if (next === null) return;
              e.preventDefault();
              setMode(next === 0 ? 'local' : 'provider');
              e.currentTarget
                .closest('[role=radiogroup]')
                ?.querySelectorAll<HTMLButtonElement>('[role=radio]')
                [next]?.focus();
            }}
            className={mode === id ? 'active' : ''}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'local' ? (
        <p className="ai-hint">
          Rule-based task ranking on this device: orders the tasks you select by due date and priority. No AI model or network
          request; free text isn't supported.
        </p>
      ) : (
        <p className="ai-hint">
          Connects to <strong>{settings.model || 'your model'}</strong> ({AI_PRESETS.find((p) => p.id === settings.preset)?.name ?? 'Custom'}). Provider and model settings can be configured in Settings.
        </p>
      )}

      <fieldset disabled={busy}>
        <h3>{mode === 'local' ? 'Choose tasks to summarize' : 'Choose what to share'}</h3>
        <p className="ai-hint">
          {mode === 'local'
            ? 'Only titles, due dates, priority and status are used, on this device only.'
            : 'Select context to include. Private notes, attachments and sync credentials remain strictly private unless explicitly selected.'}
        </p>

        <div className="ai-context-selectors">
          <button type="button" className="ai-context-btn" onClick={selectAllActiveTasks}>
            All active ({activeTasks.length})
          </button>
          <button type="button" className="ai-context-btn" onClick={selectDueTodayTasks}>
            Due today
          </button>
          <button type="button" className="ai-context-btn" onClick={selectOverdueTasks}>
            Overdue
          </button>
          <button type="button" className="ai-context-btn" onClick={() => setSelected([])}>
            Clear
          </button>
          {mode === 'provider' && (
            <>
              <button
                type="button"
                className={`ai-context-btn ${includeGoals ? 'active' : ''}`}
                onClick={() => setIncludeGoals((p) => !p)}
              >
                {includeGoals ? '✓ Goals included' : '+ Include Goals'}
              </button>
              <button
                type="button"
                className={`ai-context-btn ${includeHabits ? 'active' : ''}`}
                onClick={() => setIncludeHabits((p) => !p)}
              >
                {includeHabits ? '✓ Habits included' : '+ Include Habits'}
              </button>
              <button
                type="button"
                className={`ai-context-btn ${includeNotes ? 'active' : ''}`}
                onClick={() => setIncludeNotes((p) => !p)}
              >
                {includeNotes ? '✓ Pinned notes' : '+ Include Pinned notes'}
              </button>
            </>
          )}
        </div>

        <div className="ai-task-picker">
          {activeTasks.map((t) => (
            <label key={t.id}>
              <input
                type="checkbox"
                checked={selected.includes(t.id)}
                onChange={(e) =>
                  setSelected((ids) => (e.target.checked ? [...ids, t.id] : ids.filter((id) => id !== t.id)))
                }
              />
              <span>{t.title}</span>
            </label>
          ))}
          {!activeTasks.length && <p>No active tasks. You can still ask a planning question.</p>}
        </div>

        {mode === 'provider' && (
          <>
            <div className="ai-prompt-presets">
              {PROMPT_PRESETS.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="ai-prompt-pill"
                  onClick={() => setPrompt(preset.text)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <label>
              Your request
              <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            </label>
            <button className="btn-primary" onClick={review}>
              Review request
            </button>
          </>
        )}

        {mode === 'local' && (
          <>
            <p className="ai-hint">
              Ranking: overdue first, then due today (timed before untimed), then high-priority undated, then upcoming by
              date, then everything else.
            </p>
            <button className="btn-primary" onClick={runLocal}>
              Summarize selected tasks on this device
            </button>
          </>
        )}
      </fieldset>

      {reviewed && mode === 'provider' && (
        <section className="ai-review">
          <h3>Review before sending</h3>
          <p>
            Destination: <code>{reviewed.endpoint}</code>
            <br />
            Model: <code>{reviewed.model}</code>
          </p>
          <pre>
            {reviewed.prompt}
            {'\n\n'}
            {reviewed.context}
          </pre>
          <label className="ai-consent">
            <input
              type="checkbox"
              checked={approved}
              disabled={busy}
              onChange={(e) => setApproved(e.target.checked)}
            />
            <span>
              I approve sending this exact request and data to this provider. Cloud models may charge my account and
              follow their own data policies.
            </span>
          </label>
          <button className="btn-primary" disabled={!approved || busy} onClick={() => void send()}>
            {busy ? 'Waiting for model...' : 'Send this request'}
          </button>
        </section>
      )}

      {busy && mode === 'provider' && (
        <button onClick={() => abort.current?.abort()}>Stop waiting</button>
      )}

      {error && (
        <p role="alert" className="ai-error">
          {error}
        </p>
      )}

      {appliedNotice && (
        <p role="status" className="ai-proposal-success">
          ✓ {appliedNotice}
        </p>
      )}

      {answer && (
        <section aria-live="polite" className="ai-answer">
          <h3>Suggested plan</h3>
          <p>Review this yourself. Nothing is changed without your approval.</p>

          <MarkdownView content={parsed.cleanText || answer} />

          {/* Action Proposal: Subtasks */}
          {parsed.proposals
            .filter((p): p is SubtaskProposal => p.action === 'subtasks')
            .map((sub, idx) => (
              <div key={`sub-${idx}`} className="ai-proposal-card">
                <h4>
                  <CheckSquare size={16} /> Suggested Subtasks
                </h4>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 12 }}>
                    Attach to task:
                    <select
                      value={targetParentTask || sub.parentTaskId || (selected[0] ?? '')}
                      onChange={(e) => setTargetParentTask(e.target.value)}
                    >
                      {tasks
                        .filter((t) => t.status === 'active')
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <div className="ai-proposal-items">
                  {sub.items.map((item, itemIdx) => (
                    <label key={itemIdx} className="ai-proposal-item">
                      <input
                        type="checkbox"
                        checked={selectedSubtasks[itemIdx] ?? true}
                        onChange={(e) =>
                          setSelectedSubtasks((prev) => ({ ...prev, [itemIdx]: e.target.checked }))
                        }
                      />
                      <span>{item}</span>
                    </label>
                  ))}
                </div>
                <div className="ai-proposal-actions">
                  <button className="btn-primary" onClick={() => void applySubtasks(sub)}>
                    Add selected subtasks
                  </button>
                </div>
              </div>
            ))}

          {/* Action Proposal: Schedule */}
          {parsed.proposals
            .filter((p): p is ScheduleProposal => p.action === 'schedule')
            .map((sch, idx) => (
              <div key={`sch-${idx}`} className="ai-proposal-card">
                <h4>
                  <Calendar size={16} /> Suggested Day Schedule
                </h4>
                <div className="ai-proposal-items">
                  {sch.items.map((item, itemIdx) => {
                    const taskObj = tasks.find((t) => t.id === item.taskId);
                    const title = item.title || taskObj?.title || item.taskId;
                    return (
                      <label key={itemIdx} className="ai-proposal-item">
                        <input
                          type="checkbox"
                          checked={selectedSchedule[itemIdx] ?? true}
                          onChange={(e) =>
                            setSelectedSchedule((prev) => ({ ...prev, [itemIdx]: e.target.checked }))
                          }
                        />
                        <span>
                          <strong>{item.time}</strong> — {title} ({item.durationMinutes ?? 45}m)
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="ai-proposal-actions">
                  <button className="btn-primary" onClick={() => void applySchedule(sch)}>
                    Apply Schedule to Timeline
                  </button>
                </div>
              </div>
            ))}

          {/* Action Proposal: Create New Tasks */}
          {parsed.proposals
            .filter((p): p is CreateTasksProposal => p.action === 'create_tasks')
            .map((ct, idx) => (
              <div key={`ct-${idx}`} className="ai-proposal-card">
                <h4>
                  <ListPlus size={16} /> Suggested New Tasks
                </h4>
                <div className="ai-proposal-items">
                  {ct.items.map((item, itemIdx) => (
                    <label key={itemIdx} className="ai-proposal-item">
                      <input
                        type="checkbox"
                        checked={selectedNewTasks[itemIdx] ?? true}
                        onChange={(e) =>
                          setSelectedNewTasks((prev) => ({ ...prev, [itemIdx]: e.target.checked }))
                        }
                      />
                      <span>
                        <strong>{item.title}</strong>
                        {item.priority ? ` (P${item.priority})` : ''}
                        {item.dueDate ? ` [Due ${item.dueDate}]` : ''}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="ai-proposal-actions">
                  <button className="btn-primary" onClick={() => void applyNewTasks(ct)}>
                    Create Selected Tasks
                  </button>
                </div>
              </div>
            ))}
        </section>
      )}

      <p className="ai-hint">
        {mode === 'local'
          ? 'Nothing is sent anywhere: the summary runs entirely in this browser tab. Advice is plain text; nothing is changed.'
          : 'No background calls, automatic retries or unsaved credentials. Stopping a request may not stop provider billing. Interactive proposals require your explicit approval.'}
      </p>
    </dialog>
  );
}
