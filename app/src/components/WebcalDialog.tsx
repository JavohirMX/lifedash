import React, { useEffect, useState } from 'react';
import { Calendar, Check, ExternalLink, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import {
  DEFAULT_WEBCAL_PALETTE,
  loadWebcalFeeds,
  normalizeWebcalUrl,
  refreshAllWebcalFeeds,
  saveWebcalFeeds,
  type WebcalFeed,
} from '../webcal';
import { loadSyncSettings } from '../sync';

export default function WebcalDialog({ onClose }: { onClose: () => void }) {
  const panel = useDialogFocus<HTMLDivElement>(onClose, 'button, input');
  const [feeds, setFeeds] = useState<WebcalFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  // Form state
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [color, setColor] = useState(DEFAULT_WEBCAL_PALETTE[0]);

  useEffect(() => {
    void loadWebcalFeeds().then((f) => {
      setFeeds(f);
      setLoading(false);
    });
  }, []);

  const handleAddFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusMsg('');

    const cleanName = name.trim();
    const cleanUrl = normalizeWebcalUrl(url);

    if (!cleanName) {
      setErrorMsg('Please enter a name for this calendar.');
      return;
    }
    if (!cleanUrl || (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://'))) {
      setErrorMsg('Please enter a valid webcal or https URL.');
      return;
    }

    const newFeed: WebcalFeed = {
      id: `feed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: cleanName,
      url: cleanUrl,
      color,
      enabled: true,
    };

    const next = [...feeds, newFeed];
    setFeeds(next);
    await saveWebcalFeeds(next);

    setName('');
    setUrl('');
    setAdding(false);
    setStatusMsg(`Added "${cleanName}". Syncing events…`);

    // Immediately trigger a background refresh
    const syncSettings = loadSyncSettings();
    void refreshAllWebcalFeeds(next, syncSettings).then(({ updatedFeeds, errors }) => {
      setFeeds(updatedFeeds);
      if (errors[newFeed.id]) {
        setErrorMsg(`Calendar added, but could not fetch: ${errors[newFeed.id]}`);
      } else {
        setStatusMsg(`Synced "${cleanName}" successfully.`);
      }
    });
  };

  const handleToggleFeed = async (id: string) => {
    const next = feeds.map((f) => (f.id === id ? { ...f, enabled: !f.enabled } : f));
    setFeeds(next);
    await saveWebcalFeeds(next);
  };

  const handleDeleteFeed = async (id: string) => {
    const next = feeds.filter((f) => f.id !== id);
    setFeeds(next);
    await saveWebcalFeeds(next);
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setErrorMsg('');
    setStatusMsg('');

    try {
      const syncSettings = loadSyncSettings();
      const res = await refreshAllWebcalFeeds(feeds, syncSettings);
      setFeeds(res.updatedFeeds);
      const errorCount = Object.keys(res.errors).length;
      if (errorCount > 0) {
        setErrorMsg(`Refreshed with ${errorCount} error(s). Check feed status below.`);
      } else {
        setStatusMsg(`All calendars refreshed (${res.events.length} events loaded).`);
      }
    } catch {
      setErrorMsg('Failed to refresh calendars.');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div
        ref={panel}
        className="import-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Webcal Calendar Feeds"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="import-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={18} aria-hidden="true" />
            <h2>Calendar Feeds (Webcal / ICS)</h2>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        <p className="rule-note">
          Subscribe to any Google Calendar, Apple iCloud, Outlook, or external .ics feed. Events
          display as read-only time blocks on your Day Planner and Week View.
        </p>

        {statusMsg && <p className="form-save-status" role="status">{statusMsg}</p>}
        {errorMsg && <p className="form-save-error" role="alert">{errorMsg}</p>}

        <div style={{ display: 'flex', gap: 8, margin: '14px 0' }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setAdding((o) => !o)}
          >
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
            {adding ? 'Cancel' : 'Add Calendar Feed'}
          </button>
          {feeds.length > 0 && (
            <button
              type="button"
              className="btn-secondary"
              disabled={refreshing}
              onClick={() => void handleRefresh()}
            >
              <RefreshCw
                size={14}
                className={refreshing ? 'animate-spin' : ''}
                aria-hidden="true"
              />
              {refreshing ? 'Refreshing…' : 'Refresh Feeds'}
            </button>
          )}
        </div>

        {adding && (
          <form className="goal-add save-form" onSubmit={(e) => void handleAddFeed(e)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                autoFocus
                placeholder="Calendar Name (e.g. Work, Family)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Calendar Name"
              />
              <input
                placeholder="Feed URL (webcal://... or https://...ics)"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-label="Feed URL"
              />
              <div className="proj-colors" style={{ margin: '4px 0' }}>
                {DEFAULT_WEBCAL_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`swatch ${color === c ? 'on' : ''}`}
                    style={{ background: c }}
                    aria-label={`Color ${c}`}
                    aria-pressed={color === c}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn-primary">
                  Save Feed
                </button>
                <button type="button" className="mini" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </form>
        )}

        <div style={{ marginTop: 16 }}>
          {loading ? (
            <p className="workflow-hint">Loading feeds…</p>
          ) : feeds.length === 0 ? (
            <p className="workflow-hint">
              No calendar feeds configured. Click "Add Calendar Feed" above to paste a secret .ics
              link from Google Calendar or Apple Calendar.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {feeds.map((feed) => (
                <div
                  key={feed.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius, 6px)',
                    border: '1px solid var(--line)',
                    background: 'var(--card, transparent)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: feed.color,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{feed.name}</div>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 320,
                        }}
                      >
                        {feed.url}
                      </div>
                      {feed.lastError && (
                        <div style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: 2 }}>
                          {feed.lastError}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={feed.enabled}
                        onChange={() => void handleToggleFeed(feed.id)}
                      />
                      <span>Active</span>
                    </label>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Delete ${feed.name}`}
                      title="Delete Feed"
                      onClick={() => void handleDeleteFeed(feed.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
