import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import { notificationIcon, notificationHref, relativeTime, badgeText, NOTIF_CHANGED_EVENT } from '../utils/notifications.js';
import { Spinner, Alert } from './ui.jsx';

const POLL_MS = 30000; // Lightweight polling — the DB stays the source of truth.
const RECENT_LIMIT = 10;

/**
 * Notification bell for the navbar (replaces the plain 🔔 link).
 * Badge = unread count from GET /api/notifications/unread-count, refreshed
 * every 30s and re-checked when the panel opens. Clicking an item marks it
 * read and navigates to its deep link.
 */
export default function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const boxRef = useRef(null);
  const panelRef = useRef(null);

  // Poll the unread count only while logged in.
  useEffect(() => {
    if (!user) {
      setCount(0);
      return undefined;
    }
    let alive = true;
    const fetchCount = () =>
      api.get('/api/notifications/unread-count')
        .then((r) => { if (alive) setCount(r.data.count); })
        .catch(() => { /* transient network errors: keep the last count */ });
    fetchCount();
    const timer = setInterval(fetchCount, POLL_MS);
    // Mark-read/mark-all/delete actions elsewhere (e.g. /notifications page)
    // re-sync the badge immediately.
    window.addEventListener(NOTIF_CHANGED_EVENT, fetchCount);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener(NOTIF_CHANGED_EVENT, fetchCount);
    };
  }, [user?.user_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRecent = useCallback(() => {
    setError('');
    setItems(null);
    api.get(`/api/notifications?limit=${RECENT_LIMIT}`)
      .then((r) => {
        setItems(r.data.notifications);
        setCount(r.data.unread);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => { if (open) loadRecent(); }, [open, loadRecent]);

  // Keep the panel inside the viewport on narrow screens (the wrapped mobile
  // navbar can place the bell near the left edge, where right-0 anchoring
  // would push the panel off-screen).
  useEffect(() => {
    const el = panelRef.current;
    if (!open || !el) return undefined;
    const margin = 8;
    const r = el.getBoundingClientRect();
    let shift = 0;
    if (r.left < margin) shift = margin - r.left;
    else if (r.right > window.innerWidth - margin) shift = window.innerWidth - margin - r.right;
    el.style.transform = shift ? `translateX(${Math.round(shift)}px)` : '';
    return () => { el.style.transform = ''; };
  }, [open, items, error]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const openItem = (n) => {
    setOpen(false);
    if (!n.is_read) {
      setCount((c) => Math.max(0, c - 1));
      api.put(`/api/notifications/${n.notification_id}/read`).catch(() => {});
    }
    navigate(notificationHref(n) || '/notifications');
  };

  const markAll = async () => {
    try { await api.put('/api/notifications/read-all'); } catch { /* keep panel usable */ }
    setCount(0);
    loadRecent();
  };

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        title="Notifications"
        className="relative rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-white hover:text-brand"
      >
        <span aria-hidden="true">🔔</span>
        {count > 0 && (
          <span
            data-testid="notif-badge"
            className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white shadow"
          >
            {badgeText(count)}
          </span>
        )}
      </button>

      {open && (
        <div ref={panelRef} className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg sm:w-96">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="font-bold text-slate-800">Notifications</span>
            {count > 0 && <span className="text-xs font-semibold text-red-500">{badgeText(count)} unread</span>}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {error && <div className="p-3"><Alert kind="error">Unable to load notifications. Please try again.</Alert></div>}
            {!error && !items && <Spinner label="Loading…" />}
            {!error && items && items.length === 0 && (
              <div className="px-4 py-10 text-center">
                <div className="text-3xl" aria-hidden="true">🔔</div>
                <p className="mt-2 text-sm text-slate-500">No notifications yet.</p>
              </div>
            )}
            {!error && (items || []).map((n) => (
              <button
                key={n.notification_id}
                type="button"
                onClick={() => openItem(n)}
                className={`flex w-full items-start gap-3 border-b border-slate-50 px-4 py-3 text-left transition hover:bg-slate-50 ${n.is_read ? '' : 'bg-brand/5'}`}
              >
                <span className="text-lg leading-6" aria-hidden="true">{notificationIcon(n.type)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={`truncate text-sm ${n.is_read ? 'font-medium text-slate-700' : 'font-bold text-slate-900'}`}>{n.title}</span>
                    {!n.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-label="unread" />}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{n.message}</span>
                  <span className="mt-1 block text-[11px] text-slate-400" title={new Date(String(n.created_at).replace(' ', 'T')).toLocaleString()}>
                    {relativeTime(n.created_at)}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-sm">
            <button type="button" onClick={markAll} className="font-medium text-slate-600 transition hover:text-brand disabled:opacity-40" disabled={count === 0}>
              Mark all as read
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); navigate('/notifications'); }}
              className="font-semibold text-brand hover:underline"
            >
              See all notifications
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
