import { useSyncExternalStore } from 'react';
import { completionFailures, subscribeCompletionFailures, dismissCompletionFailure } from '../completionFeedback';
export default function CompletionFailureNotice() {
  const failures = useSyncExternalStore(subscribeCompletionFailures, completionFailures);
  return <>{failures.map(failure => <div key={failure.id} className="sub-add-feedback completion-failure-notice">
    <p role="alert">Couldn't finish changing "{failure.title}". Part of the change may have been saved. Check this task and related tasks before trying again.</p>
    <button className="btn-secondary" onClick={() => dismissCompletionFailure(failure.id)}>Dismiss completion notice for {failure.title}</button>
  </div>)}</>;
}
