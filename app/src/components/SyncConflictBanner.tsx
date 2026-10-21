import { useCallback, useEffect, useState } from 'react';
import { acknowledgeConflictNotice, getConflictNotice, type ConflictNotice } from '../sync';

/**
 * Persistent notice for server-wins sync conflicts. Auto-sync runs on
 * focus/online/interval and after edits, so a conflict can be resolved
 * without the user opening the Sync dialog; this banner keeps the dropped
 * local edits visible until acknowledged.
 */
export function SyncConflictBanner(): React.JSX.Element | null {
  const [notice, setNotice] = useState<ConflictNotice | null>(null);
  const refresh = useCallback(() => {
    void getConflictNotice().then(setNotice);
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener('lifedash:sync-conflict', refresh);
    return () => window.removeEventListener('lifedash:sync-conflict', refresh);
  }, [refresh]);
  if (!notice) return null;
  const dismiss = () => {
    void acknowledgeConflictNotice().then(() => setNotice(null));
  };
  return (
    <div className="conflict-banner" role="alert">
      <span>
        Sync conflict: newer synced changes replaced {notice.count} local{' '}
        edit{notice.count === 1 ? '' : 's'}.
      </span>
      <button type="button" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  );
}
