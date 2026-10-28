import { useCallback, useEffect, useRef, useState } from 'react';
import { acknowledgeConflictNotice, getConflictNotice, type ConflictNotice } from '../sync';

/**
 * Persistent notice for server-wins sync conflicts. Auto-sync runs on
 * focus/online/interval and after edits, so a conflict can be resolved
 * without the user opening the Sync dialog; this banner keeps the dropped
 * local edits visible until acknowledged.
 */
export function SyncConflictBanner(): React.JSX.Element | null {
  const [notice, setNotice] = useState<ConflictNotice | null>(null);
  const dismissing = useRef(false);
  const [pending, setPending] = useState(false);
  const [dismissFailed, setDismissFailed] = useState(false);
  const refresh = useCallback(() => {
    void getConflictNotice().then(setNotice);
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener('lifedash:sync-conflict', refresh);
    return () => window.removeEventListener('lifedash:sync-conflict', refresh);
  }, [refresh]);
  if (!notice) return null;
  const dismiss = async () => {
    if (dismissing.current) return;
    dismissing.current = true; setPending(true); setDismissFailed(false);
    try { await acknowledgeConflictNotice(); setNotice(null); }
    catch { setDismissFailed(true); }
    finally { dismissing.current = false; setPending(false); }
  };
  return (
    <div className="conflict-banner" role="alert">
      <span>
        Sync conflict: newer synced changes replaced {notice.count} local{' '}
        edit{notice.count === 1 ? '' : 's'}.
        {dismissFailed && <span className="conflict-dismiss-error">Could not save dismissal. This notice is still here. Try Dismiss again.</span>}
      </span>
      <button type="button" disabled={pending} onClick={() => void dismiss()}>
        {pending ? 'Dismissing…' : 'Dismiss'}
      </button>
    </div>
  );
}
