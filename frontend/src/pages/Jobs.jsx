import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { Card, Input, Select, Textarea, Button, Spinner, Alert, EmptyState, PageHeader, Badge } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Jobs() {
  const { isMember } = useAuth();
  const [jobs, setJobs] = useState(null);
  const [search, setSearch] = useState('');
  const [mine, setMine] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', company: '', description: '', location: '', employment_type: 'full-time', salary: '', application_info: '', deadline: '' });
  const [formMsg, setFormMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (mine) params.set('mine', '1');
      const res = await api.get(`/api/jobs?${params}`);
      setJobs(res.data.jobs);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [search, mine]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setFormMsg(null);
    try {
      const res = await api.post('/api/jobs', { ...form, deadline: form.deadline || undefined });
      setFormMsg({ kind: 'success', text: res.message });
      setForm({ title: '', company: '', description: '', location: '', employment_type: 'full-time', salary: '', application_info: '', deadline: '' });
      load();
    } catch (err) { setFormMsg({ kind: 'error', text: err.message }); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title="Job Board" subtitle="Opportunities shared by alumni.">
        {isMember && <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Close form' : '+ Post a job'}</Button>}
      </PageHeader>

      {isMember && showForm && (
        <Card className="mb-5">
          <h3 className="mb-3 font-bold text-ink">New job post (goes to moderation)</h3>
          {formMsg && <Alert kind={formMsg.kind}>{formMsg.text}</Alert>}
          <form onSubmit={submit} className="mt-2 grid gap-3 sm:grid-cols-2">
            <Input label="Job title *" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Input label="Company *" required value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            <div className="sm:col-span-2"><Textarea label="Description *" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <Input label="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            <Select label="Employment type" value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value })}>
              {['full-time', 'part-time', 'contract', 'internship', 'remote'].map((t) => <option key={t}>{t}</option>)}
            </Select>
            <Input label="Salary (optional)" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} />
            <Input label="Application info" value={form.application_info} onChange={(e) => setForm({ ...form, application_info: e.target.value })} />
            <Input label="Deadline" type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit job post'}</Button></div>
          </form>
        </Card>
      )}

      <Card className="mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1"><Input label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title or company" /></div>
          <label className="flex items-center gap-2 pb-2 text-sm text-ink-soft">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> My posts only
          </label>
          <Button variant="outline" onClick={load}>Refresh</Button>
        </div>
      </Card>

      {loading && <Spinner />}
      {error && <Alert kind="error">{error}</Alert>}
      {jobs && jobs.length === 0 && <EmptyState title="No job posts found." />}
      <div className="grid gap-4 lg:grid-cols-2">
        {(jobs || []).map((j) => (
          <Link key={j.job_id} to={`/jobs/${j.job_id}`}>
            <Card className="h-full transition hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold text-ink">{j.title}</h3>
                  <p className="text-sm text-ink-soft">{j.company}{j.location ? ` · ${j.location}` : ''}</p>
                </div>
                <Badge value={j.status} />
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-ink-soft">{j.description}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-ink-soft">
                <span className="rounded bg-mist px-2 py-0.5">{j.employment_type}</span>
                {j.salary && <span className="rounded bg-mist px-2 py-0.5">{j.salary}</span>}
                {j.deadline && <span className="rounded bg-mist px-2 py-0.5">Deadline: {j.deadline}</span>}
                <span className="rounded bg-mist px-2 py-0.5">{j.application_count} application(s)</span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
