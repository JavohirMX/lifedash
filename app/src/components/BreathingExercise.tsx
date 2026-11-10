import { useEffect, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, X, Volume2, VolumeX } from 'lucide-react';
import { isSoundMuted, playBreathingCue, setSoundMuted } from '../sound';
import './breathing-exercise.css';

type Phase = 'inhale' | 'hold-in' | 'exhale' | 'hold-out';

const PHASES: { phase: Phase; label: string; duration: number; soundType: 'inhale' | 'hold' | 'exhale' }[] = [
  { phase: 'inhale', label: 'Breathe In', duration: 4, soundType: 'inhale' },
  { phase: 'hold-in', label: 'Hold', duration: 4, soundType: 'hold' },
  { phase: 'exhale', label: 'Breathe Out', duration: 4, soundType: 'exhale' },
  { phase: 'hold-out', label: 'Hold', duration: 4, soundType: 'hold' },
];

export default function BreathingExercise({ onClose }: { onClose: () => void }) {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(4);
  const [isActive, setIsActive] = useState(true);
  const [completedCycles, setCompletedCycles] = useState(0);
  const [muted, setMutedState] = useState(() => isSoundMuted());

  const currentPhase = PHASES[phaseIndex];

  useEffect(() => {
    if (!isActive) return;

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          // Transition to next phase
          const nextIndex = (phaseIndex + 1) % PHASES.length;
          setPhaseIndex(nextIndex);
          if (nextIndex === 0) {
            setCompletedCycles((c) => c + 1);
          }
          const nextPhase = PHASES[nextIndex];
          playBreathingCue(nextPhase.soundType);
          return nextPhase.duration;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isActive, phaseIndex]);

  // Initial chime cue
  useEffect(() => {
    playBreathingCue('inhale');
  }, []);

  // Keyboard shortcut listener
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ') {
        e.preventDefault();
        setIsActive((a) => !a);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const toggleSound = () => {
    const next = !muted;
    setMutedState(next);
    setSoundMuted(next);
  };

  const handleRestart = () => {
    setPhaseIndex(0);
    setSecondsRemaining(4);
    setIsActive(true);
    setCompletedCycles(0);
    playBreathingCue('inhale');
  };

  return (
    <div
      className="breathing-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Mindful breathing reset"
    >
      <button
        type="button"
        className="icon-btn breathing-close-btn"
        onClick={onClose}
        title="Close (Esc)"
        aria-label="Close"
      >
        <X size={20} />
      </button>

      <div className="breathing-card">
        <p className="breathing-eyebrow">Mindful Reset</p>
        <h1 className="breathing-title">Box Breathing</h1>
        <p className="breathing-sub">
          4-4-4-4 rhythm to downregulate stress, calm your heart rate, and clear mental clutter.
        </p>

        <div className="breathing-circle-wrap">
          <div className="breathing-circle-outer" />
          <div
            className={`breathing-circle-inner ${currentPhase.phase}`}
            style={{ width: 170, height: 170 }}
          >
            <span className="breathing-phase-text">{currentPhase.label}</span>
            <span className="breathing-timer-count num">{secondsRemaining}</span>
          </div>
        </div>

        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '0 0 24px' }}>
          {completedCycles === 0
            ? 'Cycle 1'
            : `${completedCycles} cycle${completedCycles === 1 ? '' : 's'} completed`}
        </p>

        <div className="breathing-controls">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setIsActive((a) => !a)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {isActive ? <Pause size={15} /> : <Play size={15} />}
            <span>{isActive ? 'Pause' : 'Resume'}</span>
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={handleRestart}
            title="Restart exercise"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <RotateCcw size={15} />
            <span>Restart</span>
          </button>

          <button
            type="button"
            className="icon-btn"
            onClick={toggleSound}
            title={muted ? 'Unmute chime' : 'Mute chime'}
            aria-label={muted ? 'Unmute chime' : 'Mute chime'}
          >
            {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
        </div>
      </div>
    </div>
  );
}
