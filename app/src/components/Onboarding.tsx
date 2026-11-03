import { Cloud, ArrowRight } from 'lucide-react';

/**
 * First-open welcome: offers sync setup (create account or sign in on your
 * own server) with a skip path - the app is fully usable local-only and the
 * same setup stays available later under Settings > Sync.
 */
export default function Onboarding(props: { onSetUpSync: () => void; onSkip: () => void }) {
  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label="Welcome to Lifedash">
      <div className="onboarding-card">
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
