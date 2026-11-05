import './task-detail-flow.css';
import { useEffect, useRef, useState } from 'react';
import {
  X,
  Check,
  StickyNote,
  Pin,
  Calendar,
  CheckSquare,
  FileText,
  Tag,
  ShieldAlert,
  Pencil,
  Folder,
  Flag,
  Target,
  Repeat,
  ChevronLeft,
  Sparkles,
  Maximize2,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import CompletionButton from './CompletionButton';
import NoteEditor from './NoteEditor';
import Attachments from './Attachments';
import SubtaskAdd from './SubtaskAdd';
import TaskTitle from './TaskTitle';
import TaskTags from './TaskTags';
import TaskBlockers from './TaskBlockers';
import TaskDelete from './TaskDelete';
import TaskPriority from './TaskPriority';
import TaskPin from './TaskPin';
import TaskLinkField from './TaskLinkField';
import TaskDateField from './TaskDateField';
import TaskRecurrence from './TaskRecurrence';
import TaskSkip from './TaskSkip';
import TaskFocus from './TaskFocus';
import { runningSession, sessionSeconds, focusTotals, formatClock, formatDuration } from '../focus';
import { db, INBOX_ID } from '../db';
import { togglePin, updateTask, addTask } from '../repo';
import { todayStr, friendlyDate } from '../dates';
import { projectTree } from '../projects';
import { describeRecurrence, blockersOf, normalizeTask } from '../logic';
import { useAiSettings, loadAiSettings } from '../ai/aiSettings';
import { requestAdvice, reviewRequest } from '../ai/provider';
import { parseAiResponse } from '../ai/proposalParser';

const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 320;

export default function TaskDetail(props: {
  taskId: string;
  onClose: () => void;
  onOpenNote: (noteId: string) => void;
  onOpenFocusWorkspace?: (taskId: string) => void;
}) {
  const aiSettings = useAiSettings();
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  // View mode by default; edit mode toggled via Edit/Done button
  const [isEditing, setIsEditing] = useState(false);

  // AI Subtasks helper state
  const [aiSubtaskOpen, setAiSubtaskOpen] = useState(false);
  const [aiSubtaskLoading, setAiSubtaskLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [selectedAiSubs, setSelectedAiSubs] = useState<Record<number, boolean>>({});
  const [aiSubtaskNotice, setAiSubtaskNotice] = useState('');

  // Resizable panel width with persistence
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('lifedash-task-detail-width');
      if (saved) {
        const n = Number(saved);
        if (n >= MIN_WIDTH && n <= 1000) return n;
      }
    } catch {}
    return DEFAULT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const panelWidthRef = useRef(panelWidth);
  panelWidthRef.current = panelWidth;

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement;
    return () => {
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, []);

  const task = useLiveQuery(() => db.tasks.get(props.taskId), [props.taskId]);
  const projects = useLiveQuery(() => db.projects.orderBy('order').toArray(), []);
  const goals = useLiveQuery(() => db.goals.orderBy('order').toArray(), []);
  const subtasks = useLiveQuery(
    () => db.tasks.where('parentId').equals(props.taskId).filter((t) => t.status !== 'archived').toArray(),
    [props.taskId],
  );
  const allTasks = useLiveQuery(() => db.tasks.toArray(), []);
  const focusSessions = useLiveQuery(() => db.focusSessions.toArray(), []);
  const [focusNow, setFocusNow] = useState(() => Date.now());

  const running = focusSessions ? runningSession(focusSessions) : null;
  const runningHere = running?.taskId === props.taskId;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setFocusNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running?.id]);

  const sourceNote = useLiveQuery(
    () => (task?.noteId ? db.notes.get(task.noteId) : undefined),
    [task?.noteId],
  );

  // Focus title input when entering edit mode
  useEffect(() => {
    if (isEditing && task) {
      panel.current?.querySelector<HTMLInputElement>('.detail-title')?.focus();
    }
  }, [isEditing, task?.id]);

  // Esc closes the panel - guarded against overlays
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      if (e.target instanceof HTMLElement && e.target.closest('.palette-overlay, [role=dialog], dialog[open]')) return;
      props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerateSubtasks = async () => {
    if (!task) return;
    setAiSubtaskOpen(true);
    setAiSubtaskLoading(true);
    setAiSubtaskNotice('');
    try {
      const s = loadAiSettings();
      if (s.baseUrl && s.model) {
        const prompt = `Break down "${task.title}"${task.note ? ` (${task.note.slice(0, 300)})` : ''} into 3 to 5 clear, concrete, actionable subtasks. Format as: \`\`\`json\n{ "action": "subtasks", "items": ["step 1", "step 2"] }\n\`\`\``;
        const reviewed = reviewRequest({ baseUrl: s.baseUrl, model: s.model, apiKey: s.apiKey }, prompt, '');
        const raw = await requestAdvice({ baseUrl: s.baseUrl, model: s.model, apiKey: s.apiKey }, reviewed, true);
        const parsed = parseAiResponse(raw);
        const subProp = parsed.proposals.find((p) => p.action === 'subtasks');
        if (subProp && subProp.items.length > 0) {
          setAiSuggestions(subProp.items);
          const map: Record<number, boolean> = {};
          subProp.items.forEach((_, idx) => (map[idx] = true));
          setSelectedAiSubs(map);
          return;
        }
      }
      const fallbacks = [
        `Clarify requirements for ${task.title.slice(0, 30)}`,
        `Draft core deliverable`,
        `Review and verify wrap-up`,
      ];
      setAiSuggestions(fallbacks);
      setSelectedAiSubs({ 0: true, 1: true, 2: true });
    } catch {
      const fallbacks = [
        `Outline steps for ${task.title.slice(0, 30)}`,
        `Execute primary work`,
        `Final review & completion`,
      ];
      setAiSuggestions(fallbacks);
      setSelectedAiSubs({ 0: true, 1: true, 2: true });
    } finally {
      setAiSubtaskLoading(false);
    }
  };

  const handleApplyAiSubtasks = async () => {
    if (!task) return;
    let count = 0;
    for (let i = 0; i < aiSuggestions.length; i++) {
      if (selectedAiSubs[i]) {
        await addTask({
          title: aiSuggestions[i],
          projectId: task.projectId || INBOX_ID,
          parentId: task.id,
          dueDate: task.dueDate,
        });
        count++;
      }
    }
    setAiSubtaskNotice(`Added ${count} subtask${count === 1 ? '' : 's'}.`);
    setAiSuggestions([]);
    setAiSubtaskOpen(false);
  };

  function onResizerPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = panelWidthRef.current;

    function onPointerMove(moveEvent: PointerEvent) {
      const deltaX = startX - moveEvent.clientX;
      const maxW = Math.min(900, Math.floor(window.innerWidth * 0.8));
      const nextW = Math.max(MIN_WIDTH, Math.min(maxW, startWidth + deltaX));
      setPanelWidth(nextW);
    }

    function onPointerUp() {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      setIsResizing(false);
      try {
        localStorage.setItem('lifedash-task-detail-width', String(panelWidthRef.current));
      } catch {}
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  function onResizerDoubleClick() {
    setPanelWidth(DEFAULT_WIDTH);
    try {
      localStorage.setItem('lifedash-task-detail-width', String(DEFAULT_WIDTH));
    } catch {}
  }

  function onResizerKeyDown(e: React.KeyboardEvent) {
    const maxW = Math.min(900, Math.floor(window.innerWidth * 0.8));
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const nextW = Math.min(maxW, panelWidth + 24);
      setPanelWidth(nextW);
      try { localStorage.setItem('lifedash-task-detail-width', String(nextW)); } catch {}
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextW = Math.max(MIN_WIDTH, panelWidth - 24);
      setPanelWidth(nextW);
      try { localStorage.setItem('lifedash-task-detail-width', String(nextW)); } catch {}
    } else if (e.key === 'Home') {
      e.preventDefault();
      setPanelWidth(MIN_WIDTH);
      try { localStorage.setItem('lifedash-task-detail-width', String(MIN_WIDTH)); } catch {}
    } else if (e.key === 'End') {
      e.preventDefault();
      setPanelWidth(maxW);
      try { localStorage.setItem('lifedash-task-detail-width', String(maxW)); } catch {}
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onResizerDoubleClick();
    }
  }

  if (!task || !projects) return null;

  const isDone = task.status === 'done';
  const today = todayStr();
  const isOverdue = !isDone && Boolean(task.dueDate && task.dueDate < today);
  const isDueToday = !isDone && task.dueDate === today;

  let statusClass = 'status-inbox';
  let statusLabel = 'Inbox';

  if (isDone) {
    statusClass = 'status-done';
    statusLabel = 'Completed';
  } else if (isOverdue) {
    statusClass = 'status-overdue';
    statusLabel = 'Overdue';
  } else if (isDueToday) {
    statusClass = 'status-today';
    statusLabel = 'Today';
  } else if (task.dueDate) {
    statusClass = 'status-upcoming';
    statusLabel = friendlyDate(task.dueDate, today);
  }

  const totalSubs = subtasks?.length ?? 0;
  const doneSubs = subtasks?.filter((s) => s.status === 'done').length ?? 0;
  const progressPercent = totalSubs > 0 ? Math.round((doneSubs / totalSubs) * 100) : 0;

  const project = projects.find((p) => p.id === task.projectId);
  const projectName = project ? project.name : 'Inbox';
  const goal = (goals ?? []).find((g) => g.id === task.goalId);
  const goalName = goal ? goal.title : null;
  const blockers = blockersOf((allTasks ?? []).map(normalizeTask), normalizeTask(task));

  return (
    <aside
      ref={panel}
      className={`detail ${isResizing ? 'is-resizing' : ''}`}
      style={{ '--detail-w': `${panelWidth}px` } as React.CSSProperties}
      aria-label="Task details"
    >
      {/* Draggable Resize Handle */}
      <div
        className="detail-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize task detail panel"
        aria-valuenow={panelWidth}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={Math.min(900, Math.floor(typeof window !== 'undefined' ? window.innerWidth * 0.8 : 800))}
        tabIndex={0}
        onPointerDown={onResizerPointerDown}
        onDoubleClick={onResizerDoubleClick}
        onKeyDown={onResizerKeyDown}
      />

      {/* Sticky Header with Completion, Status Pill, Edit/Done Toggle, Pin, and Close */}
      <div className="detail-head">
        <button
          type="button"
          className="detail-back-btn"
          aria-label="Back to tasks"
          onClick={props.onClose}
        >
          <ChevronLeft size={18} strokeWidth={2.2} aria-hidden="true" />
          <span>Back</span>
        </button>

        <div className="detail-head-left">
          <CompletionButton
            task={task}
            showFailure
            className={`checkbox detail-checkbox ${isDone ? 'checked' : ''}`}
            label={`${isDone ? 'Mark incomplete' : 'Complete'} ${task.title}`}
          >
            {isDone ? <Check size={13} strokeWidth={2.5} aria-hidden="true" /> : null}
          </CompletionButton>
          <span className={`detail-status-pill ${statusClass}`}>{statusLabel}</span>
        </div>

        <div className="detail-head-actions">
          {!isEditing ? (
            <button
              type="button"
              className="edit-toggle-btn"
              aria-label="Edit task details"
              title="Edit task"
              onClick={() => setIsEditing(true)}
            >
              <Pencil size={13} strokeWidth={2} aria-hidden="true" />
              <span>Edit</span>
            </button>
          ) : (
            <button
              type="button"
              className="edit-toggle-btn active"
              aria-label="Done editing"
              title="Done editing"
              onClick={() => setIsEditing(false)}
            >
              <Check size={13} strokeWidth={2.5} aria-hidden="true" />
              <span>Done</span>
            </button>
          )}

          <button
            type="button"
            className={`detail-action-btn ${task.pinned ? 'active' : ''}`}
            aria-label={task.pinned ? 'Unpin task from top' : 'Pin task to top'}
            title={task.pinned ? 'Unpin task from top' : 'Pin task to top'}
            onClick={() => void togglePin(task)}
          >
            <Pin size={16} strokeWidth={2} />
          </button>
          <button
            className="close"
            aria-label="Close task details"
            title="Close (Esc)"
            onClick={props.onClose}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Title */}
      <div className={`detail-title-wrapper ${isDone ? 'task-done' : ''}`}>
        {!isEditing ? (
          <h2
            className="detail-view-title"
            title="Click to edit task title"
            onClick={() => setIsEditing(true)}
          >
            {task.title || 'Untitled task'}
          </h2>
        ) : (
          <TaskTitle id={task.id} title={task.title} />
        )}
      </div>

      {/* Properties Section */}
      <div className="detail-card detail-properties">
        <div className="detail-card-head">
          <Calendar size={13} strokeWidth={2} aria-hidden="true" />
          <h3>Properties</h3>
        </div>

        {!isEditing ? (
          /* View Mode Readout */
          <div className="view-props-list">
            <div className="view-prop-row">
              <span className="view-prop-label">
                <Calendar size={13} aria-hidden="true" /> Due Date
              </span>
              <span className={`view-prop-val ${isOverdue ? 'overdue' : isDueToday ? 'today' : !task.dueDate ? 'text-muted' : ''}`}>
                {task.dueDate ? friendlyDate(task.dueDate, today) : 'No due date'}
                {task.dueTime ? ` (${task.dueTime})` : ''}
              </span>
            </div>

            <div className="view-prop-row">
              <span className="view-prop-label">
                <Folder size={13} aria-hidden="true" /> Project
              </span>
              <span className="view-prop-val">{projectName}</span>
            </div>

            <div className="view-prop-row">
              <span className="view-prop-label">
                <Flag size={13} aria-hidden="true" /> Priority
              </span>
              <span className={`view-prop-val prio-badge prio-${task.priority}`}>
                {task.priority === 1 ? 'P1 - High' : task.priority === 2 ? 'P2 - Medium' : task.priority === 3 ? 'P3 - Low' : 'None'}
              </span>
            </div>

            {goalName && (
              <div className="view-prop-row">
                <span className="view-prop-label">
                  <Target size={13} aria-hidden="true" /> Goal
                </span>
                <span className="view-prop-val">{goalName}</span>
              </div>
            )}

            {task.recurrence && (
              <div className="view-prop-row">
                <span className="view-prop-label">
                  <Repeat size={13} aria-hidden="true" /> Repeats
                </span>
                <span className="view-prop-val">{describeRecurrence(task.recurrence)}</span>
              </div>
            )}

            <TaskFocus
              id={task.id}
              runningHere={Boolean(runningHere)}
              running={Boolean(running)}
              clock={runningHere && running && <span className="focus-clock num">{formatClock(sessionSeconds(running, focusNow))}</span>}
            >
              {focusSessions && focusTotals(focusSessions, todayStr(), focusNow).perTask.get(task.id) ? (
                <span className="focus-total num">
                  {formatDuration(focusTotals(focusSessions, todayStr(), focusNow).perTask.get(task.id) ?? 0)} total
                </span>
              ) : null}
              {props.onOpenFocusWorkspace && runningHere && (
                <button
                  type="button"
                  className="btn-secondary mini"
                  onClick={() => props.onOpenFocusWorkspace!(task.id)}
                  title="Open fullscreen focus workspace"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Maximize2 size={12} aria-hidden="true" />
                  Workspace
                </button>
              )}
            </TaskFocus>
          </div>
        ) : (
          /* Edit Mode Controls */
          <>
            <TaskDateField id={task.id} field="dueDate" value={task.dueDate ?? ''} label="Due date" type="date" />
            {task.dueDate && (
              <TaskDateField id={task.id} field="dueTime" value={task.dueTime ?? ''} label="Deadline time (optional)" type="time" />
            )}

            <TaskLinkField id={task.id} field="projectId" value={task.projectId} label="Project">
              {projectTree(projects).map(({ project: p, depth }) => (
                <option key={p.id} value={p.id}>
                  {' '.repeat(depth)}{depth > 0 ? '– ' : ''}{p.name}
                </option>
              ))}
            </TaskLinkField>

            <TaskPriority id={task.id} priority={task.priority} />

            <TaskLinkField id={task.id} field="goalId" value={task.goalId ?? ''} label="Goal">
              <option value="">No goal</option>
              {(goals ?? []).filter((g) => g.status === 'active').map((g) => (
                <option key={g.id} value={g.id}>{g.title}</option>
              ))}
              {task.goalId && !(goals ?? []).some((g) => g.id === task.goalId && g.status === 'active') && (
                <option value={task.goalId} disabled>
                  {(goals ?? []).find((g) => g.id === task.goalId)?.title ?? 'Linked goal'} (archived)
                </option>
              )}
            </TaskLinkField>

            <TaskRecurrence task={task} />
            {task.recurrence && task.dueDate && task.status !== 'done' && <TaskSkip task={task} />}
            {(task.skippedDates?.length ?? 0) > 0 && (
              <p className="date-sub">Skipped: {(task.skippedDates ?? []).join(', ')}</p>
            )}

            <TaskPin id={task.id} pinned={task.pinned} />

            <TaskFocus
              id={task.id}
              runningHere={Boolean(runningHere)}
              running={Boolean(running)}
              clock={runningHere && running && <span className="focus-clock num">{formatClock(sessionSeconds(running, focusNow))}</span>}
            >
              {focusSessions && focusTotals(focusSessions, todayStr(), focusNow).perTask.get(task.id) ? (
                <span className="focus-total num">
                  {formatDuration(focusTotals(focusSessions, todayStr(), focusNow).perTask.get(task.id) ?? 0)} total
                </span>
              ) : null}
              {props.onOpenFocusWorkspace && runningHere && (
                <button
                  type="button"
                  className="btn-secondary mini"
                  onClick={() => props.onOpenFocusWorkspace!(task.id)}
                  title="Open fullscreen focus workspace"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Maximize2 size={12} aria-hidden="true" />
                  Workspace
                </button>
              )}
            </TaskFocus>
          </>
        )}
      </div>

      {/* Subtasks Section */}
      <div className="detail-card detail-subtasks">
        <div className="detail-card-head">
          <div className="subtask-head-title">
            <CheckSquare size={13} strokeWidth={2} aria-hidden="true" />
            <h3>Subtasks</h3>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {aiSettings.enabled && (
              <button
                type="button"
                className="subtask-ai-trigger mini"
                onClick={() => void handleGenerateSubtasks()}
                title="Suggest subtasks with AI"
                aria-label="Suggest subtasks with AI"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '2px 7px', height: 24 }}
              >
                <Sparkles size={11} aria-hidden="true" />
                <span>Suggest</span>
              </button>
            )}
            {totalSubs > 0 && (
              <span className="subtask-count-pill">{doneSubs} of {totalSubs}</span>
            )}
          </div>
        </div>

        {aiSettings.enabled && aiSubtaskOpen && (
          <div className="ai-subtask-box" style={{ background: 'var(--surface-2, #f8fafc)', border: '1px solid var(--border, #e2e8f0)', borderRadius: 6, padding: 10, margin: '8px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <strong style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Sparkles size={12} color="var(--accent, #0f766e)" /> AI Suggestions
              </strong>
              <button type="button" className="mini" onClick={() => setAiSubtaskOpen(false)} style={{ height: 22, fontSize: 11 }}>Cancel</button>
            </div>
            {aiSubtaskLoading ? (
              <p style={{ fontSize: 12, margin: '4px 0', color: 'var(--muted, #64748b)' }}>Generating actionable subtasks…</p>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '6px 0 10px' }}>
                  {aiSuggestions.map((s, idx) => (
                    <label key={idx} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selectedAiSubs[idx] ?? false}
                        onChange={(e) => setSelectedAiSubs((p) => ({ ...p, [idx]: e.target.checked }))}
                      />
                      <span>{s}</span>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn-primary mini"
                  disabled={!Object.values(selectedAiSubs).some(Boolean)}
                  onClick={() => void handleApplyAiSubtasks()}
                  style={{ height: 26, fontSize: 11, padding: '0 10px' }}
                >
                  Add selected subtasks
                </button>
              </>
            )}
          </div>
        )}
        {aiSubtaskNotice && (
          <p style={{ fontSize: 12, color: 'var(--accent, #0f766e)', margin: '4px 0 6px' }}>✓ {aiSubtaskNotice}</p>
        )}

        {totalSubs > 0 && (
          <div
            className="subtask-progress-bar"
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Subtask progress"
          >
            <div className="subtask-progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
        )}

        <div className="subs-list">
          {(subtasks ?? []).map((s) => (
            <div key={s.id} className={`sub-row ${s.status === 'done' ? 'done' : ''}`}>
              <CompletionButton
                task={s}
                showFailure
                className={`checkbox ${s.status === 'done' ? 'checked' : ''}`}
                label={`${s.status === 'done' ? 'Mark incomplete' : 'Complete'} ${s.title}`}
              >
                {s.status === 'done' ? <Check size={12} strokeWidth={2.5} aria-hidden="true" /> : null}
              </CompletionButton>
              <span>{s.title}</span>
            </div>
          ))}
          {totalSubs === 0 && !isEditing && (
            <p className="detail-view-note-empty" onClick={() => setIsEditing(true)}>
              No subtasks. Click to add subtasks…
            </p>
          )}
        </div>
        {isEditing && <SubtaskAdd task={task} />}
      </div>

      {/* Execution Context Section: Blockers & Tags */}
      {(!isEditing && (blockers.length > 0 || (task.tags?.length ?? 0) > 0)) || isEditing ? (
        <div className="detail-card detail-context">
          {(isEditing || blockers.length > 0) && (
            <>
              <div className="detail-card-head">
                <ShieldAlert size={13} strokeWidth={2} aria-hidden="true" />
                <h3>Blocked by</h3>
              </div>
              {isEditing ? (
                <TaskBlockers task={task} tasks={allTasks ?? []} />
              ) : (
                <div className="subs-list">
                  {blockers.map((b) => (
                    <div key={b.id} className={`sub-row ${b.status === 'done' ? 'done' : ''}`}>
                      <span className={`dep-dot ${b.status}`} />
                      <span style={{ flex: 1 }}>{b.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {(isEditing || (task.tags?.length ?? 0) > 0) && (
            <>
              <div className="detail-card-head" style={{ marginTop: isEditing || blockers.length > 0 ? '6px' : '0' }}>
                <Tag size={13} strokeWidth={2} aria-hidden="true" />
                <h3>Tags</h3>
              </div>
              {isEditing ? (
                <TaskTags taskId={task.id} tags={task.tags ?? []} />
              ) : (
                <div className="chips">
                  {(task.tags ?? []).map((tag) => (
                    <span key={tag} className="chip">#{tag}</span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ) : null}

      {/* Notes Section */}
      <div className="detail-card detail-notes-card">
        <div className="detail-card-head">
          <FileText size={13} strokeWidth={2} aria-hidden="true" />
          <h3>Notes</h3>
          {task.noteId && sourceNote && (
            <button
              type="button"
              className="note-source-pill"
              onClick={() => props.onOpenNote(task.noteId!)}
            >
              <StickyNote size={12} strokeWidth={2} aria-hidden="true" />
              From note: {sourceNote.title || 'Untitled'}
            </button>
          )}
        </div>

        {!isEditing ? (
          task.note?.trim() ? (
            <div
              className="detail-view-note-content"
              title="Click to edit notes"
              onClick={() => setIsEditing(true)}
            >
              {task.note}
            </div>
          ) : (
            <p
              className="detail-view-note-empty"
              onClick={() => setIsEditing(true)}
            >
              No notes yet. Click to add notes…
            </p>
          )
        ) : (
          <NoteEditor
            collection="tasks"
            key={task.id}
            docKey={task.id}
            note={task.note}
            noteDoc={task.noteDoc}
            onSave={(doc, text) => updateTask(task.id, { noteDoc: doc, note: text })}
          />
        )}
      </div>

      {/* Attachments Section */}
      <div className="detail-card detail-attachments">
        <Attachments taskId={task.id} />
      </div>

      {/* Danger Zone: Delete Task (available in Edit Mode) */}
      {isEditing && (
        <div className="detail-card detail-danger-card">
          <TaskDelete task={task} onClose={props.onClose} />
        </div>
      )}
    </aside>
  );
}
