import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { Card, Spinner, Alert, EmptyState, PageHeader } from '../components/ui.jsx';

export default function Notices() {
  const [notices, setNotices] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/notices')
      .then((r) => setNotices(r.data.notices))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <PageHeader title="Noticeboard" subtitle="Official announcements from the association." />
      {error && <Alert kind="error">{error}</Alert>}
      {!notices && !error && <Spinner />}
      {notices && notices.length === 0 && <EmptyState title="No notices published yet." />}
      <div className="space-y-4">
        {(notices || []).map((n, i) => (
          <Card key={n.notice_id} className={i % 2 === 0 ? 'bg-[#E8E8E8]!' : 'bg-[#F5F5F5]!'}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#242424]">{n.title}</h2>
              <span className="text-xs text-ink-soft">{new Date(n.published_at || n.created_at).toLocaleDateString()}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-[#555555]">{n.body}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
