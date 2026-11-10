import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Sparkles,
  Check,
  Calendar,
  ListPlus,
  CheckSquare,
  Bot,
  Send,
  ShieldCheck,
  AlertCircle,
  Settings,
  RotateCcw,
  Copy,
  Search,
  Clock,
  ArrowRight,
  CheckCircle2,
  StopCircle,
} from 'lucide-react';
import type { Task } from '../types';
import { db, INBOX_ID } from '../db';
import { addTask, updateTask } from '../repo';
import { requestAdvice, reviewRequest, type ReviewedRequest } from '../ai/provider';
import { localPlan } from '../ai/localPlanner';
import { useAiSettings, AI_PRESETS } from '../ai/aiSettings';
import {
  parseAiResponse,
  type SubtaskProposal,
  type ScheduleProposal,
  type CreateTasksProposal,
} from '../ai/proposalParser';
import { MarkdownView } from '../ai/MarkdownView';
import { PageHeader } from '../components/Page';
import type { Selection } from '../components/Sidebar';
import './ai-planner-view.css';

const PROMPT_PRESETS = [
  {
    label: '🎯 Prioritize tasks',
    text: 'Help me choose a realistic order for these tasks. Explain tradeoffs and suggest which to do first.',
  },
  {
    label: '⏱️ Plan day schedule',
    text: 'Propose a realistic hourly time-block schedule for today from 9:00 to 18:00 with breaks.',
  },
  {
    label: '🔍 Find bottlenecks',
    text: 'Identify potential bottlenecks, missing steps, and dependencies across these items.',
  },
  {
    label: '📝 Suggest subtasks',
    text: 'Break down each selected task into 3-5 concrete, actionable subtasks.',
  },
];

export interface AiPlannerViewProps {
  tasks: Task[];
  onNavigate?: (s: Selection) => void;
  onOpenAiSettings?: () => void;
}

export default function AiPlannerView(props: AiPlannerViewProps) {
  const abort = useRef<AbortController>();
  const settings = useAiSettings();
  const mode = settings.mode;

  const [prompt, setPrompt] = useState(
    'Help me choose a realistic order for these tasks. Explain tradeoffs and suggest which to do first.'
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [taskFilter, setTaskFilter] = useState('');
  const [includeGoals, setIncludeGoals] = useState(false);
  const [includeHabits, setIncludeHabits] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);

  const [reviewed, setReviewed] = useState<ReviewedRequest | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Proposals & Execution state
  const [selectedSubtasks, setSelectedSubtasks] = useState<Record<string, boolean>>({});
  const [selectedSchedule, setSelectedSchedule] = useState<Record<string, boolean>>({});
  const [selectedNewTasks, setSelectedNewTasks] = useState<Record<string, boolean>>({});
  const [appliedNotice, setAppliedNotice] = useState<string>('');
  const [targetParentTask, setTargetParentTask] = useState<string>('');

  // Live queries for context
  const goals = useLiveQuery(() => db.goals.filter((g) => g.status === 'active').toArray(), []);
  const habits = useLiveQuery(() => db.habits.filter((h) => !h.archived).toArray(), []);
  const notes = useLiveQuery(() => db.notes.filter((n) => n.pinned).toArray(), []);

  // Filter active tasks
  const activeTasks = useMemo(
    () => props.tasks.filter((t) => t.status === 'active'),
    [props.tasks]
  );
  const selectedTaskList = useMemo(
    () => props.tasks.filter((t) => selected.includes(t.id)),
    [props.tasks, selected]
  );

  const contextObj: Record<string, unknown> = useMemo(() => {
    const obj: Record<string, unknown> = {
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
      obj.goals = goals.slice(0, 10).map((g) => ({ id: g.id, title: g.title, targetDate: g.targetDate }));
    }
    if (includeHabits && habits && habits.length > 0) {
      obj.habits = habits.slice(0, 10).map((h) => ({ id: h.id, name: h.name, weekdays: h.weekdays }));
    }
    if (includeNotes && notes && notes.length > 0) {
      obj.pinnedNotes = notes.slice(0, 5).map((n) => ({ title: n.title, excerpt: n.note.slice(0, 200) }));
    }
    return obj;
  }, [selectedTaskList, includeGoals, goals, includeHabits, habits, includeNotes, notes]);

  const taskContext = useMemo(() => JSON.stringify(contextObj, null, 2), [contextObj]);

  useEffect(() => {
    return () => abort.current?.abort();
  }, []);

  useEffect(() => {
    setReviewed(null);
    setApproved(false);
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
          taskContext
        )
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
      if (taskContext.length > 24000)
        throw new Error('Choose less context (up to 24,000 characters).');
      const filteredTasks = props.tasks.filter((t) => selected.includes(t.id));
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
        }
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
      setError(e instanceof Error ? e.message : 'Request failed. Check provider connection and settings.');
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  function stopGeneration() {
    abort.current?.abort();
    setBusy(false);
  }

  // Action Apply Handlers
  async function applySubtasks(proposal: SubtaskProposal) {
    const parentId =
      targetParentTask ||
      proposal.parentTaskId ||
      (selected.length > 0 ? selected[0] : null);
    if (!parentId) {
      setError('Select a parent task to attach these subtasks to.');
      return;
    }
    const parent = props.tasks.find((t) => t.id === parentId);
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
    setAppliedNotice(
      `Added ${count} subtask${count === 1 ? '' : 's'} to "${parent?.title ?? 'selected task'}".`
    );
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
    setAppliedNotice(`Scheduled ${count} task${count === 1 ? '' : 's'} on the day timeline.`);
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
  const activePreset = AI_PRESETS.find((p) => p.id === settings.preset);

  const displayedTasks = activeTasks.filter(
    (t) =>
      !taskFilter.trim() ||
      t.title.toLowerCase().includes(taskFilter.trim().toLowerCase())
  );

  const copyToClipboard = () => {
    if (!answer) return;
    navigator.clipboard.writeText(answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="ai-planner-view">
      <div className="ai-planner-container">
        <PageHeader
          title="Plan with AI"
          description="AI-powered task prioritization, daily schedule blocking, and actionable breakdowns."
          actions={
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className={`ai-badge ${mode === 'provider' ? 'active' : ''}`}>
                <Bot size={14} />
                <span>
                  {mode === 'local'
                    ? 'Local Engine (Rule-based)'
                    : `${settings.model || 'Model'} (${activePreset?.name || 'Custom'})`}
                </span>
              </span>
              {props.onOpenAiSettings && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={props.onOpenAiSettings}
                  title="Configure AI model and keys"
                >
                  <Settings size={15} style={{ marginRight: '6px' }} />
                  <span>Configure AI</span>
                </button>
              )}
            </div>
          }
        />

        {appliedNotice && (
          <div className="ai-alert ai-alert-success" role="alert">
            <CheckCircle2 size={18} />
            <span>{appliedNotice}</span>
          </div>
        )}

        {error && (
          <div className="ai-alert ai-alert-error" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <div className="ai-planner-grid">
          {/* Left Column: Prompt & Context */}
          <div className="ai-card">
            <div className="ai-card-head">
              <div className="ai-card-title-group">
                <span className="ai-card-icon">
                  <Sparkles size={18} strokeWidth={2} />
                </span>
                <h2 className="ai-card-title">Instructions & Context</h2>
              </div>
            </div>

            {/* Presets */}
            <div className="ai-preset-list">
              {PROMPT_PRESETS.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="ai-preset-btn"
                  onClick={() => setPrompt(p.text)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Prompt textarea */}
            <div className="ai-field">
              <label htmlFor="ai-prompt-input">Prompt / Goal</label>
              <textarea
                id="ai-prompt-input"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="What should the assistant focus on?"
                rows={3}
              />
            </div>

            {/* Context selection */}
            <div className="ai-context-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                  Select Tasks ({selected.length} of {activeTasks.length})
                </label>
              </div>

              <div className="ai-context-pills">
                <button
                  type="button"
                  className="ai-pill-btn"
                  onClick={selectAllActiveTasks}
                >
                  All active
                </button>
                <button
                  type="button"
                  className="ai-pill-btn"
                  onClick={selectDueTodayTasks}
                >
                  Due today
                </button>
                <button
                  type="button"
                  className="ai-pill-btn"
                  onClick={selectOverdueTasks}
                >
                  Overdue
                </button>
                <button
                  type="button"
                  className="ai-pill-btn"
                  onClick={() => setSelected([])}
                >
                  Clear
                </button>

                {mode === 'provider' && (
                  <>
                    <button
                      type="button"
                      className={`ai-pill-btn ${includeGoals ? 'active' : ''}`}
                      onClick={() => setIncludeGoals((p) => !p)}
                    >
                      {includeGoals ? '✓ Goals' : '+ Goals'}
                    </button>
                    <button
                      type="button"
                      className={`ai-pill-btn ${includeHabits ? 'active' : ''}`}
                      onClick={() => setIncludeHabits((p) => !p)}
                    >
                      {includeHabits ? '✓ Habits' : '+ Habits'}
                    </button>
                    <button
                      type="button"
                      className={`ai-pill-btn ${includeNotes ? 'active' : ''}`}
                      onClick={() => setIncludeNotes((p) => !p)}
                    >
                      {includeNotes ? '✓ Notes' : '+ Pinned Notes'}
                    </button>
                  </>
                )}
              </div>

              <input
                type="text"
                className="ai-task-filter"
                placeholder="Search active tasks..."
                value={taskFilter}
                onChange={(e) => setTaskFilter(e.target.value)}
              />

              <div className="ai-task-list">
                {displayedTasks.map((t) => (
                  <label key={t.id} className="ai-task-item">
                    <input
                      type="checkbox"
                      checked={selected.includes(t.id)}
                      onChange={(e) =>
                        setSelected((ids) =>
                          e.target.checked
                            ? [...ids, t.id]
                            : ids.filter((id) => id !== t.id)
                        )
                      }
                    />
                    <span className="ai-task-title">{t.title}</span>
                    {t.dueDate && <span className="ai-task-meta">{t.dueDate}</span>}
                  </label>
                ))}
                {!displayedTasks.length && (
                  <div style={{ padding: '12px', textAlign: 'center', color: 'var(--muted)', fontSize: '0.82rem' }}>
                    No matching active tasks.
                  </div>
                )}
              </div>
            </div>

            {/* Run / Review Controls */}
            {mode === 'local' ? (
              <button
                type="button"
                className="btn-primary"
                onClick={runLocal}
                disabled={busy}
              >
                {busy ? 'Running...' : 'Run Local Planner'}
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {!reviewed ? (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={review}
                    disabled={busy}
                  >
                    Review Request Payload
                  </button>
                ) : (
                  <div className="ai-review-box">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.84rem', fontWeight: 600 }}>
                      <ShieldCheck size={16} color="var(--accent)" />
                      <span>Review Context (~{Math.round((reviewed.prompt.length + reviewed.context.length) / 4)} estimated tokens)</span>
                    </div>
                    <pre className="ai-review-pre">{taskContext}</pre>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={approved}
                        onChange={(e) => setApproved(e.target.checked)}
                      />
                      <span>I approve sending this context to {settings.model || 'model'}</span>
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        className="btn-primary"
                        style={{ flex: 1 }}
                        onClick={send}
                        disabled={!approved || busy}
                      >
                        <Send size={14} style={{ marginRight: '6px' }} />
                        {busy ? 'Streaming response...' : 'Send to AI'}
                      </button>
                      {busy && (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={stopGeneration}
                          title="Cancel request"
                        >
                          <StopCircle size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Column: AI Output & Proposals */}
          <div className="ai-output-wrap">
            <div className="ai-card">
              <div className="ai-card-head">
                <div className="ai-card-title-group">
                  <span className="ai-card-icon">
                    <Bot size={18} strokeWidth={2} />
                  </span>
                  <h2 className="ai-card-title">Recommendations</h2>
                </div>
                {answer && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={copyToClipboard}
                    style={{ fontSize: '0.8rem', padding: '4px 8px' }}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    <span style={{ marginLeft: '4px' }}>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                )}
              </div>

              {busy && !answer && (
                <div className="ai-empty-prompt">
                  <div className="ai-empty-icon">
                    <Clock size={24} />
                  </div>
                  <strong style={{ fontSize: '1rem', color: 'var(--text)' }}>
                    Generating plan...
                  </strong>
                  <span>The assistant is analyzing your tasks and structuring recommendations.</span>
                </div>
              )}

              {!busy && !answer && (
                <div className="ai-empty-prompt">
                  <div className="ai-empty-icon">
                    <Sparkles size={24} />
                  </div>
                  <strong style={{ fontSize: '1rem', color: 'var(--text)' }}>
                    Ready to build your plan
                  </strong>
                  <span>
                    Select the tasks you want to organize from the left panel, choose a goal preset, and run the planner.
                  </span>
                </div>
              )}

              {answer && (
                <div className="ai-response-box">
                  <MarkdownView content={parsed.cleanText || answer} />
                </div>
              )}
            </div>

            {/* Action Proposal: Subtasks */}
            {parsed.proposals
              .filter((p): p is SubtaskProposal => p.action === 'subtasks')
              .map((p, pIdx) => (
                <div className="ai-proposal-card" key={`subtasks-${pIdx}`}>
                  <div className="ai-proposal-head">
                    <div className="ai-proposal-title">
                      <ListPlus size={18} color="var(--accent)" />
                      <span>Suggested Subtasks ({p.items.length})</span>
                    </div>
                  </div>

                  <div className="ai-proposal-items">
                    {p.items.map((item, idx) => (
                      <label key={idx} className="ai-proposal-item">
                        <input
                          type="checkbox"
                          checked={!!selectedSubtasks[idx]}
                          onChange={(e) =>
                            setSelectedSubtasks((m) => ({ ...m, [idx]: e.target.checked }))
                          }
                        />
                        <span>{item}</span>
                      </label>
                    ))}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '200px' }}>
                      <select
                        aria-label="Target parent task"
                        value={targetParentTask || p.parentTaskId || (selected[0] ?? '')}
                        onChange={(e) => setTargetParentTask(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: 'var(--radius)',
                          border: '1px solid var(--border)',
                          background: 'var(--surface-2)',
                          color: 'var(--text)',
                        }}
                      >
                        <option value="">Attach to task...</option>
                        {activeTasks.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => applySubtasks(p)}
                    >
                      Add Subtasks
                    </button>
                  </div>
                </div>
              ))}

            {/* Action Proposal: Schedule */}
            {parsed.proposals
              .filter((p): p is ScheduleProposal => p.action === 'schedule')
              .map((p, pIdx) => (
                <div className="ai-proposal-card" key={`schedule-${pIdx}`}>
                  <div className="ai-proposal-head">
                    <div className="ai-proposal-title">
                      <Calendar size={18} color="var(--accent)" />
                      <span>Proposed Schedule Blocks ({p.items.length})</span>
                    </div>
                  </div>

                  <div className="ai-proposal-items">
                    {p.items.map((item, idx) => (
                      <label key={idx} className="ai-proposal-item">
                        <input
                          type="checkbox"
                          checked={!!selectedSchedule[idx]}
                          onChange={(e) =>
                            setSelectedSchedule((m) => ({ ...m, [idx]: e.target.checked }))
                          }
                        />
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: 600 }}>
                            {item.title || props.tasks.find((t) => t.id === item.taskId)?.title || item.taskId}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                            {item.date} at {item.time} ({item.durationMinutes ?? 30} mins)
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => applySchedule(p)}
                    >
                      Apply Schedule to Timeline
                    </button>
                  </div>
                </div>
              ))}

            {/* Action Proposal: Create Tasks */}
            {parsed.proposals
              .filter((p): p is CreateTasksProposal => p.action === 'create_tasks')
              .map((p, pIdx) => (
                <div className="ai-proposal-card" key={`tasks-${pIdx}`}>
                  <div className="ai-proposal-head">
                    <div className="ai-proposal-title">
                      <CheckSquare size={18} color="var(--accent)" />
                      <span>Proposed New Tasks ({p.items.length})</span>
                    </div>
                  </div>

                  <div className="ai-proposal-items">
                    {p.items.map((item, idx) => (
                      <label key={idx} className="ai-proposal-item">
                        <input
                          type="checkbox"
                          checked={!!selectedNewTasks[idx]}
                          onChange={(e) =>
                            setSelectedNewTasks((m) => ({ ...m, [idx]: e.target.checked }))
                          }
                        />
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: 600 }}>{item.title}</span>
                          {item.dueDate && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                              Due: {item.dueDate} {item.dueTime || ''}
                            </span>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>

                  <div>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => applyNewTasks(p)}
                    >
                      Create Tasks in Inbox
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
