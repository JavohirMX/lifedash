import React from 'react';
import {
  Timer,
  Wind,
  Sparkles,
  Zap,
  Monitor,
  Database,
  Palette,
} from 'lucide-react';
import { PageHeader } from '../components/Page';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { formatClock } from '../focus';
import { useActiveTools } from '../activeTools';
import type { Selection } from '../components/Sidebar';
import './tools.css';

export interface ToolsViewProps {
  onOpenTimer: () => void;
  onOpenBreathing: () => void;
  onAI?: () => void;
  onAutomation: () => void;
  onAppearance: () => void;
  onDataBackup?: () => void;
  aiEnabled?: boolean;
  tvEnabled?: boolean;
  onSelectView?: (s: Selection) => void;
}

export default function ToolsView(props: ToolsViewProps) {
  const { timer, elapsedSeconds } = useActiveTools();

  const runningTask = useLiveQuery(
    () => (timer.taskId ? db.tasks.get(timer.taskId) : undefined),
    [timer.taskId]
  );

  return (
    <div className="page-wrap">
      <PageHeader
        eyebrow="Utilities & Workspaces"
        title="Tools"
        description="Focused tools designed to help you plan, focus, calm down, and automate your workflow."
      />

      <div className="tools-grid">
        {/* 1. Focus & Pomodoro Tool */}
        <div className="tool-card">
          <div className="tool-card-head">
            <div className="tool-card-icon-wrap">
              <Timer size={20} strokeWidth={1.8} />
            </div>
            <span className="tool-card-tag">Productivity</span>
          </div>
          <h2 className="tool-card-title">Focus & Pomodoro Timer</h2>
          <div className={`tool-card-status ${timer.isRunning ? 'active' : ''}`}>
            <span className="tool-status-dot" />
            <span>
              {timer.isRunning
                ? `Running (${formatClock(elapsedSeconds)}): ${runningTask?.title ?? 'Focus session'}`
                : 'Ready for a focus sprint'}
            </span>
          </div>
          <p className="tool-card-desc">
            Customizable 25m/50m pomodoro sprints, 5m/15m breaks, and count-up stopwatch with gentle singing bowl chimes, scratchpad, and Picture-in-Picture.
          </p>
          <div className="tool-card-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={props.onOpenTimer}
            >
              {timer.isRunning ? 'Open Live Timer' : 'Open Focus Timer'}
            </button>
          </div>
        </div>

        {/* 2. Mindful Breathing Tool */}
        <div className="tool-card">
          <div className="tool-card-head">
            <div className="tool-card-icon-wrap">
              <Wind size={20} strokeWidth={1.8} />
            </div>
            <span className="tool-card-tag">Mindfulness</span>
          </div>
          <h2 className="tool-card-title">Breathing Reset</h2>
          <div className="tool-card-status">
            <span className="tool-status-dot" />
            <span>1-minute calm exercise</span>
          </div>
          <p className="tool-card-desc">
            Guided 4-4-4-4 box breathing exercise with visual cues and harmonic tones to reduce stress, lower heart rate, and clear mental fatigue.
          </p>
          <div className="tool-card-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={props.onOpenBreathing}
            >
              Open Breathing Tool
            </button>
          </div>
        </div>

        {/* 3. Plan with AI */}
        <div className="tool-card">
          <div className="tool-card-head">
            <div className="tool-card-icon-wrap">
              <Sparkles size={20} strokeWidth={1.8} />
            </div>
            <span className="tool-card-tag">AI Planning</span>
          </div>
          <h2 className="tool-card-title">Plan with AI</h2>
          <div className={`tool-card-status ${props.aiEnabled ? 'active' : ''}`}>
            <span className="tool-status-dot" />
            <span>{props.aiEnabled ? 'AI Assistant Ready' : 'AI Offline / Disabled'}</span>
          </div>
          <p className="tool-card-desc">
            Local or cloud-powered assistant that inspects your upcoming commitments, prioritizes backlog items, and builds focused daily plans.
          </p>
          <div className="tool-card-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                if (props.onSelectView) props.onSelectView({ kind: 'ai-planner' });
                else props.onAI?.();
              }}
              disabled={!props.aiEnabled && !props.onSelectView}
            >
              Open AI Planner
            </button>
          </div>
        </div>

        {/* 4. Automation */}
        <div className="tool-card">
          <div className="tool-card-head">
            <div className="tool-card-icon-wrap">
              <Zap size={20} strokeWidth={1.8} />
            </div>
            <span className="tool-card-tag">Automation</span>
          </div>
          <h2 className="tool-card-title">Rules & Automation</h2>
          <div className="tool-card-status active">
            <span className="tool-status-dot" />
            <span>Active background rules</span>
          </div>
          <p className="tool-card-desc">
            Set up automatic midnight task rollovers, recurring schedules, weekly reflection prompts, and tag-based prioritization rules.
          </p>
          <div className="tool-card-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                if (props.onSelectView) props.onSelectView({ kind: 'automation' });
                else props.onAutomation();
              }}
            >
              Manage Rules
            </button>
          </div>
        </div>

        {/* 5. TV Dashboard */}
        <div className="tool-card">
          <div className="tool-card-head">
            <div className="tool-card-icon-wrap">
              <Monitor size={20} strokeWidth={1.8} />
            </div>
            <span className="tool-card-tag">Display</span>
          </div>
          <h2 className="tool-card-title">TV & Ambient Kiosk</h2>
          <div className="tool-card-status">
            <span className="tool-status-dot" />
            <span>Full-screen ambient dashboard</span>
          </div>
          <p className="tool-card-desc">
            Dedicated full-screen ambient view for secondary desktop monitors, wall TVs, or kitchen tablets displaying current commitments and daily progress.
          </p>
          <div className="tool-card-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => { window.location.hash = '/tv'; }}
            >
              Launch TV View
            </button>
          </div>
        </div>

        {/* 6. Data & Portability */}
        <div className="tool-card">
          <div className="tool-card-head">
            <div className="tool-card-icon-wrap">
              <Database size={20} strokeWidth={1.8} />
            </div>
            <span className="tool-card-tag">Portability</span>
          </div>
          <h2 className="tool-card-title">Data Backup & Export</h2>
          <div className="tool-card-status">
            <span className="tool-status-dot" />
            <span>100% offline & portable</span>
          </div>
          <p className="tool-card-desc">
            Export your entire workspace as raw JSON, Obsidian-compatible Markdown notes, or ICS calendar feeds. Create and restore snapshot archives anytime.
          </p>
          <div className="tool-card-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => props.onDataBackup?.()}
            >
              Open Backup & Export
            </button>
          </div>
        </div>

        {/* 7. Appearance */}
        <div className="tool-card">
          <div className="tool-card-head">
            <div className="tool-card-icon-wrap">
              <Palette size={20} strokeWidth={1.8} />
            </div>
            <span className="tool-card-tag">Design</span>
          </div>
          <h2 className="tool-card-title">Visual Styles & Themes</h2>
          <div className="tool-card-status">
            <span className="tool-status-dot" />
            <span>16 crafted themes</span>
          </div>
          <p className="tool-card-desc">
            Customize typography, corner radius, light/dark modes, and color palettes across Paper, Terminal, Luxury, High Contrast, and Retro styles.
          </p>
          <div className="tool-card-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={props.onAppearance}
            >
              Customize Style
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
