import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { Card, Textarea, Input, Button, Spinner, Alert, Badge } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function JobDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [job, setJob] = useState(null);
  const [applications, setApplications] = useState(null);
  const [cover, setCover] = useState('');
  const [portfolio, setPortfolio] = useState('');
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/api/jobs/${id}`);
      setJob(res.data.job);
      const mine = await api.get(`/api/jobs/${id}/applications`).catch(() => null);
      if (mine) setApplications(mine.data.applications);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const apply = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const res = await api.post(`/api/jobs/${id}/apply`, { cover_message: cover, portfolio_url: portfolio || undefined });
      setMsg({ kind: 'success', text: res.message });
      setCover(''); setPortfolio('');
    } catch (err) { setMsg({ kind: 'error', text: err.message }); }
    finally { setBusy(false); }
  };

  if (loading) return <Spinner />;
  if (error) return <Alert kind="error">{error}</Alert>;

  const canSeeApplications = applications && (job.posted_by === user.user_id || ['ADMIN', 'AUTHORITY'].includes(user.role));

  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-ink">{job.title}</h1>
            <p className="text-ink-soft">{job.company}{job.location ? ` · ${job.location}` : ''}</p>
            <p className="mt-1 text-xs text-ink-soft">Posted by {job.first_name} {job.last_name}</p>
          </div>
          <Badge value={job.status} />
        </div>
        <p className="mt-4 whitespace-pre-wrap text-sm text-ink-soft">{job.description}</p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-ink-soft">
          <span className="rounded bg-mist px-2 py-1">{job.employment_type}</span>
          {job.salary && <span className="rounded bg-mist px-2 py-1">Salary: {job.salary}</span>}
          {job.deadline && <span className="rounded bg-mist px-2 py-1">Deadline: {job.deadline}</span>}
          {job.application_info && <span className="rounded bg-mist px-2 py-1">{job.application_info}</span>}
        </div>
      </Card>

      {user.role === 'VISITOR' && <Alert kind="info">Your account is pending approval — member actions like applying are unlocked after approval.</Alert>}

      {user.role !== 'VISITOR' && job.status === 'approved' && (
        <Card className="mt-5">
          <h3 className="mb-3 font-bold text-ink">Apply for this job</h3>
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
          <form onSubmit={apply} className="mt-2 space-y-3">
            <Textarea label="Cover message *" required value={cover} onChange={(e) => setCover(e.target.value)} />
            <Input label="Portfolio URL (optional)" value={portfolio} onChange={(e) => setPortfolio(e.target.value)} />
            <Button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit application'}</Button>
          </form>
        </Card>
      )}

      {canSeeApplications && (
        <Card className="mt-5">
          <h3 className="mb-3 font-bold text-ink">Applications ({applications.length})</h3>
          {applications.length === 0 && <p className="text-sm text-ink-soft">No applications yet.</p>}
          <div className="space-y-3">
            {applications.map((a) => (
              <div key={a.application_id} className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-ink">{a.first_name} {a.last_name}</div>
                  <Badge value={a.status} />
                </div>
                <p className="mt-1 text-sm text-ink-soft">{a.cover_message}</p>
                {a.portfolio_url && <a href={a.portfolio_url} target="_blank" rel="noreferrer" className="text-sm text-moss hover:underline">Portfolio ↗</a>}
                <ApplicationActions application={a} onDone={load} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function ApplicationActions({ application, onDone }) {
  const update = async (status) => {
    try {
      await api.put(`/api/jobs/applications/${application.application_id}/status`, { status });
      onDone();
    } catch (e) { alert(e.message); }
  };
  return (
    <div className="mt-2 flex gap-2">
      <Button variant="outline" className="!px-2 !py-1 text-xs" onClick={() => update('shortlisted')}>Shortlist</Button>
      <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={() => update('rejected')}>Reject</Button>
      <Button variant="primary" className="!px-2 !py-1 text-xs" onClick={() => update('hired')}>Mark hired</Button>
    </div>
  );
}
