import React, { useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Square,
  Volume2,
  VolumeX,
  PictureInPicture2,
  Wind,
} from 'lucide-react';
import { PageHeader } from '../components/Page';
import { useActiveTools, BREATHING_PHASES } from '../activeTools';
import { isSoundMuted, playBreathingCue, setSoundMuted } from '../sound';
import { requestNativePiP } from '../pipService';
import type { Selection } from '../components/Sidebar';
import './breathing-view.css';

export interface BreathingViewProps {
  onOpenPiP?: () => void;
  onNavigate?: (s: Selection) => void;
  pipActive?: boolean;
}

export default function BreathingView(props: BreathingViewProps) {
  const { breathing, actions } = useActiveTools();
  const [muted, setMutedState] = useState(() => isSoundMuted());

  const currentPhase = BREATHING_PHASES[breathing.phaseIndex] ?? BREATHING_PHASES[0];

  const toggleSound = () => {
    const next = !muted;
    setMutedState(next);
    setSoundMuted(next);
    if (!next) {
      playBreathingCue('inhale');
    }
  };

  const handleStart = () => {
    actions.startBreathing();
  };

  const handlePiP = async () => {
    if (!breathing.isActive) {
      actions.startBreathing();
    }
    actions.pinBreathingPiP();
    try {
      await requestNativePiP('breathing');
    } catch {
      // In-website PiP pinned
    }
    props.onOpenPiP?.();
  };

  return (
    <div className="page-wrap breathing-view-wrap">
      <PageHeader
        eyebrow="Tools · Mindfulness & Recovery"
        title="Mindful Box Breathing"
        description="4-4-4-4 regulated breathing to soothe the nervous system, lower stress, and restore focus."
      />

      <div className="breathing-card-hero">
        <div className="breathing-top-bar">
          <button
            type="button"
            className="icon-btn"
            onClick={toggleSound}
            title={muted ? 'Unmute transition tones' : 'Mute transition tones'}
            aria-label={muted ? 'Unmute transition tones' : 'Mute transition tones'}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>

          <button
            type="button"
            className="btn-secondary breathing-top-pip-btn"
            onClick={handlePiP}
            title="Open Picture-in-Picture mode"
          >
            <PictureInPicture2 size={14} />
            <span>PiP Mode</span>
          </button>
        </div>

        <div className="breathing-circle-wrap">
          <div className="breathing-circle-outer" />
          <div
            className={`breathing-circle-inner ${
              !breathing.isActive
                ? 'idle'
                : breathing.phaseIndex === 0
                ? 'inhale'
                : breathing.phaseIndex === 1
                ? 'hold-in'
                : breathing.phaseIndex === 2
                ? 'exhale'
                : 'hold-out'
            }`}
            style={{ width: 175, height: 175 }}
          >
            <span className="breathing-phase-text">
              {breathing.isActive ? currentPhase.label : 'Ready'}
            </span>
            <span className="breathing-timer-count num">
              {breathing.isActive ? breathing.secondsRemaining : '4s'}
            </span>
          </div>
        </div>

        <p className="breathing-status-copy">
          {!breathing.isActive
            ? 'Find a comfortable upright posture and begin whenever you are ready.'
            : breathing.isPaused
            ? 'Breathing exercise paused.'
            : breathing.completedCycles === 0
            ? 'Cycle 1 · Follow the circle'
            : `${breathing.completedCycles} cycle${breathing.completedCycles === 1 ? '' : 's'} completed`}
        </p>

        <div className="breathing-controls-row">
          {!breathing.isActive ? (
            <button
              type="button"
              className="btn-primary"
              onClick={handleStart}
            >
              <Play size={16} fill="currentColor" />
              <span>Start Breathing</span>
            </button>
          ) : breathing.isPaused ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => actions.resumeBreathing()}
            >
              <Play size={16} fill="currentColor" />
              <span>Resume</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => actions.pauseBreathing()}
            >
              <Pause size={16} />
              <span>Pause</span>
            </button>
          )}

          {breathing.isActive && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => actions.resetBreathing()}
              title="Restart session"
            >
              <RotateCcw size={15} />
              <span>Restart</span>
            </button>
          )}

          {breathing.isActive && (
            <button
              type="button"
              className="btn-secondary breathing-btn-danger"
              onClick={() => actions.stopBreathing()}
              title="Stop exercise"
            >
              <Square size={13} fill="currentColor" />
              <span>Finish</span>
            </button>
          )}
        </div>
      </div>

      <div className="breathing-info-card">
        <h3 style={{ fontSize: '1.05rem', fontWeight: 600, margin: '0 0 6px' }}>
          How Box Breathing Works
        </h3>
        <p style={{ fontSize: '0.88rem', color: 'var(--muted)', margin: 0 }}>
          Also known as square breathing, this technique balances the autonomic nervous system by equalizing oxygen and carbon dioxide levels through four uniform counts.
        </p>

        <div className="breathing-info-grid">
          <div className="breathing-info-step">
            <strong>1. Inhale</strong>
            <span>4 seconds deep breath through nose</span>
          </div>
          <div className="breathing-info-step">
            <strong>2. Hold</strong>
            <span>4 seconds gentle lung retention</span>
          </div>
          <div className="breathing-info-step">
            <strong>3. Exhale</strong>
            <span>4 seconds smooth mouth release</span>
          </div>
          <div className="breathing-info-step">
            <strong>4. Hold</strong>
            <span>4 seconds calm empty lung pause</span>
          </div>
        </div>
      </div>
    </div>
  );
}
