import { useEffect } from 'react';
import { Cloud, ArrowRight, X } from 'lucide-react';

/**
 * First-open welcome: offers sync setup (create account or sign in on your
 * own server) with a skip path - the app is fully usable local-only and the
 * same setup stays available later under Settings > Sync.
 */
export default function Onboarding(props: { onSetUpSync: () => void; onSkip: () => void }) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        props.onSkip();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [props.onSkip]);

  return (
    <div
      className="onboarding"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Lifedash"
      onClick={props.onSkip}
    >
      <div className="onboarding-card" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="onboarding-close"
          aria-label="Dismiss welcome dialog"
          title="Dismiss"
          onClick={props.onSkip}
        >
          <X size={16} aria-hidden="true" />
        </button>
        <p className="eyebrow">Welcome to Lifedash</p>
        <h1>One thing at a time.</h1>
        <p>
          Tasks, habits, notes and journal are stored on this device. To keep them in sync across
          devices, connect your own server - create an account or sign in. You can also skip this
          and set it up anytime under Settings &gt; Sync.
        </p>
        <div className="onboarding-actions">
          <button className="btn-primary" onClick={props.onSetUpSync}>
            <Cloud size={17} aria-hidden="true" /> Set up sync
          </button>
          <button className="btn-secondary" onClick={props.onSkip}>
            Skip for now <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
