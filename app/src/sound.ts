// Offline-first Web Audio API sound synthesizer for gentle focus bells and mindfulness cues.

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!audioCtx) {
    try {
      audioCtx = new AudioContextClass();
    } catch {
      return null;
    }
  }

  if (audioCtx.state === 'suspended') {
    void audioCtx.resume();
  }

  return audioCtx;
}

const SOUND_MUTE_KEY = 'lifedash-sound-muted';

export function isSoundMuted(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(SOUND_MUTE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setSoundMuted(muted: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SOUND_MUTE_KEY, String(muted));
  } catch {
    // ignore
  }
}

/**
 * Plays a calm singing-bowl bell chime using harmonic oscillators with exponential decay.
 * @param freq Fundamental frequency in Hz (default: 587.33 Hz - D5)
 * @param duration Duration in seconds
 */
export function playBell(freq = 587.33, duration = 2.5): void {
  if (isSoundMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;

    // Master gain node
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.001, now);
    masterGain.gain.exponentialRampToValueAtTime(0.3, now + 0.02);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    masterGain.connect(ctx.destination);

    // Fundamental oscillator (warm sine wave)
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(freq, now);

    // Harmonic overtone for natural metallic singing bowl resonance
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 1.5, now); // perfect fifth overtone

    const overtoneGain = ctx.createGain();
    overtoneGain.gain.setValueAtTime(0.4, now);
    overtoneGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.7);

    osc1.connect(masterGain);
    osc2.connect(overtoneGain);
    overtoneGain.connect(masterGain);

    osc1.start(now);
    osc2.start(now);

    osc1.stop(now + duration);
    osc2.stop(now + duration);
  } catch {
    // graceful degradation if audio is blocked
  }
}

/**
 * Plays a soft, subtle mindfulness cue for breathing transitions.
 */
export function playBreathingCue(type: 'inhale' | 'hold' | 'exhale'): void {
  if (isSoundMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const freq = type === 'inhale' ? 392.0 : type === 'hold' ? 440.0 : 329.63; // G4, A4, E4
    const duration = 0.8;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.connect(gain);

    osc.start(now);
    osc.stop(now + duration);
  } catch {
    // ignore
  }
}
