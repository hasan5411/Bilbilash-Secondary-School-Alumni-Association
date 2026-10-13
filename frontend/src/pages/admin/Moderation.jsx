import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { Card, Button, Spinner, Alert, EmptyState, PageHeader, Badge } from '../../components/ui.jsx';

export default function Moderation() {
  const [jobs, setJobs] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get(`/api/jobs?status=${filter}`)
      .then((r) => setJobs(r.data.jobs))
      .catch((e) => setError(e.message));
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const moderate = async (id, action) => {
    setMsg(null);
    try {
      const res = await api.put(`/api/jobs/${id}/moderate`, { action });
      setMsg({ kind: 'success', text: res.message });
      load();
    } catch (e) { setMsg({ kind: 'error', text: e.message }); }
  };

  const remove = async (j) => {
    if (!window.confirm(`Delete job "${j.title}"? Its ${j.application_count} application(s) are removed too. This cannot be undone.`)) return;
    setMsg(null);
    try {
      const res = await api.del(`/api/jobs/${j.job_id}`);
      setMsg({ kind: 'success', text: res.message });
      load();
    } catch (e) { setMsg({ kind: 'error', text: e.message }); }
  };

  return (
    <div>
      <PageHeader title="Job Moderation" subtitle="Review job posts submitted by members.">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border border-line px-3 py-2 text-sm">
          {['pending', 'approved', 'rejected', 'closed'].map((s) => <option key={s}>{s}</option>)}
        </select>
      </PageHeader>

      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      {!jobs && !error && <Spinner />}
      {jobs && jobs.length === 0 && <EmptyState title={`No ${filter} jobs.`} />}

      <div className="space-y-3">
        {(jobs || []).map((j) => (
          <Card key={j.job_id}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-ink">{j.title} <span className="text-sm font-normal text-ink-soft">· {j.company}</span></h3>
                <p className="text-xs text-ink-soft">by {j.first_name} {j.last_name} · {j.application_count} application(s)</p>
                <p className="mt-1 line-clamp-1 text-sm text-ink-soft">{j.description}</p>
              </div>
              <Badge value={j.status} />
            </div>
            <div className="mt-3 flex gap-2">
              {j.status !== 'approved' && <Button className="!px-3 !py-1.5 text-xs" onClick={() => moderate(j.job_id, 'approve')}>Approve</Button>}
              {j.status !== 'rejected' && <Button variant="danger" className="!px-3 !py-1.5 text-xs" onClick={() => moderate(j.job_id, 'reject')}>Reject</Button>}
              {j.status !== 'closed' && <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => moderate(j.job_id, 'close')}>Close</Button>}
              <Button variant="danger" className="!px-3 !py-1.5 text-xs" onClick={() => remove(j)}>Delete</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
