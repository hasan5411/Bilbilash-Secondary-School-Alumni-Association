import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { Card, Button, Spinner, Alert, EmptyState, PageHeader } from '../components/ui.jsx';
import { notificationIcon, notificationHref, relativeTime, badgeText, emitNotifChanged } from '../utils/notifications.js';

const PAGE_SIZE = 20;
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'read', label: 'Read' },
];

export default function Notifications() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (nextFilter, nextOffset) => {
    setBusy(true);
    setError('');
    try {
      const r = await api.get(`/api/notifications?filter=${nextFilter}&limit=${PAGE_SIZE}&offset=${nextOffset}`);
      setData(r.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { load(filter, offset); }, [load, filter, offset]);

  const switchTab = (key) => {
    setFilter(key);
    setOffset(0);
  };

  const markOne = async (n) => {
    if (n.is_read) return;
    try {
      await api.put(`/api/notifications/${n.notification_id}/read`);
      emitNotifChanged();
      load(filter, offset);
    } catch { /* row stays unread; next poll resyncs */ }
  };

  const openItem = async (n) => {
    await markOne(n);
    navigate(notificationHref(n) || '/notifications');
  };

  const markAll = async () => {
    try { await api.put('/api/notifications/read-all'); } catch { /* best effort */ }
    emitNotifChanged();
    load(filter, offset);
  };

  const removeOne = async (n) => {
    try { await api.del(`/api/notifications/${n.notification_id}`); } catch { /* best effort */ }
    emitNotifChanged();
    load(filter, offset);
  };

  // Bulk: delete every READ notification (unread ones are never touched).
  const clearRead = async () => {
    if (!window.confirm('Delete all read notifications? Unread notifications are kept.')) return;
    setBusy(true);
    try {
      await api.del('/api/notifications/read');
      setError('');
      setOffset(0);
      emitNotifChanged();
      load(filter, 0);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const items = data?.notifications || [];
  const total = data?.total || 0;
  const unread = data?.unread || 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader title="Notifications" subtitle={unread ? `${badgeText(unread)} unread notification${unread === 1 ? '' : 's'}` : 'All caught up!'}>
        {unread > 0 && <Button variant="outline" onClick={markAll} disabled={busy}>Mark all as read</Button>}
        {total > unread && <Button variant="outline" onClick={clearRead} disabled={busy}>Clear read</Button>}
      </PageHeader>

      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => switchTab(t.key)}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${filter === t.key ? 'bg-forest text-white' : 'text-ink-soft hover:bg-white hover:text-moss'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <Alert kind="error">Unable to load notifications. Please try again. ({error})</Alert>}
      {!error && !data && <Spinner />}
      {!error && data && items.length === 0 && (
        <EmptyState title="🔔 No notifications yet." hint="Community updates and review results will appear here." />
      )}

      <div className="space-y-2">
        {items.map((n) => (
          <Card key={n.notification_id} className={`p-4 ${n.is_read ? '' : 'border-l-4 border-l-forest bg-forest/5'}`}>
            <div className="flex items-start gap-3">
              <span className="text-xl leading-7" aria-hidden="true">{notificationIcon(n.type)}</span>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => openItem(n)}
                  className={`text-left text-sm hover:text-moss ${n.is_read ? 'font-semibold text-ink' : 'font-bold text-ink'}`}
                >
                  {n.title}
                </button>
                <p className="mt-0.5 text-sm text-ink-soft">{n.message}</p>
                <p className="mt-1 text-xs text-ink-soft" title={new Date(String(n.created_at).replace(' ', 'T')).toLocaleString()}>
                  {relativeTime(n.created_at)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {!n.is_read && (
                  <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => markOne(n)}>Mark read</Button>
                )}
                <button
                  type="button"
                  onClick={() => removeOne(n)}
                  aria-label="Delete notification"
                  title="Delete this notification"
                  className="rounded-md border border-line px-2 py-0.5 text-xs font-bold text-ink-soft transition hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                >
                  ✕ Delete
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {data && total > PAGE_SIZE && (
        <div className="mt-6 flex items-center justify-center gap-3 text-sm text-ink-soft">
          <Button variant="outline" className="!px-3 !py-1.5 text-xs" disabled={offset === 0 || busy} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            ← Previous
          </Button>
          <span>Page {page} of {pageCount} · {total} notification{total === 1 ? '' : 's'}</span>
          <Button variant="outline" className="!px-3 !py-1.5 text-xs" disabled={offset + PAGE_SIZE >= total || busy} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next →
          </Button>
        </div>
      )}
    </div>
  );
}
