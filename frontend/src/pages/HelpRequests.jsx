import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { Card, Input, Select, Textarea, Button, Spinner, Alert, EmptyState, PageHeader, Badge, BLOOD_GROUPS } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const CATEGORIES = ['career', 'education', 'medical', 'financial', 'blood', 'other'];
const URGENCIES = ['low', 'medium', 'high', 'emergency'];
const emptyForm = { title: '', description: '', category: 'other', urgency: 'medium', blood_group: '', location: '', required_date: '' };

export default function HelpRequests() {
  const { user, isAdmin } = useAuth();
  const [requests, setRequests] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/api/help'); setRequests(r.data.requests); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const res = await api.post('/api/help', form);
      setMsg({ kind: 'success', text: res.message });
      setForm(emptyForm);
      load();
    } catch (err) { setMsg({ kind: 'error', text: err.message }); }
    finally { setBusy(false); }
  };

  const setStatus = async (id, status) => {
    try { await api.put(`/api/help/${id}/status`, { status }); load(); }
    catch (e) { alert(e.message); }
  };

  const remove = async (h) => {
    if (!window.confirm(`Delete help request "${h.title}"? This cannot be undone.`)) return;
    setMsg(null);
    try { const res = await api.del(`/api/help/${h.help_id}`); setMsg({ kind: 'success', text: res.message }); load(); }
    catch (e) { setMsg({ kind: 'error', text: e.message }); }
  };

  return (
    <div>
      <PageHeader title="Help Requests" subtitle="Ask the community for support." />
      <Card className="mb-5">
        <h3 className="mb-3 font-bold text-ink">Request help</h3>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <form onSubmit={submit} className="mt-2 grid gap-3 sm:grid-cols-3">
          <Input label="Title *" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </Select>
          <Select label="Urgency" value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })}>
            {URGENCIES.map((u) => <option key={u}>{u}</option>)}
          </Select>
          {form.category === 'blood' && (
            <>
              <Select label="Blood group *" value={form.blood_group} onChange={(e) => setForm({ ...form, blood_group: e.target.value })}>
                <option value="">— Select —</option>
                {BLOOD_GROUPS.map((b) => <option key={b}>{b}</option>)}
              </Select>
              <Input label="Location *" placeholder="Where the blood is needed" maxLength={255} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              <Input label="Required date *" type="date" value={form.required_date} onChange={(e) => setForm({ ...form, required_date: e.target.value })} />
            </>
          )}
          <div className="sm:col-span-3"><Textarea label="Description *" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div><Button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</Button></div>
        </form>
      </Card>

      {loading && <Spinner />}
      {error && <Alert kind="error">{error}</Alert>}
      {requests && requests.length === 0 && <EmptyState title="No help requests." />}
      <div className="space-y-3">
        {(requests || []).map((h) => (
          <Card key={h.help_id}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-ink">
                  {h.category === 'blood' && <span className="mr-1">🩸</span>}{h.title}
                </h3>
                <p className="text-xs text-ink-soft">by {h.first_name} {h.last_name}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-mist px-2 py-0.5 font-semibold text-ink-soft">{h.category === 'blood' ? '🩸 Blood' : h.category}</span>
                  {h.urgency === 'emergency'
                    ? <span className="rounded-full bg-red-100 px-2 py-0.5 font-bold text-red-600">🚨 Emergency</span>
                    : <span className="rounded-full bg-mist px-2 py-0.5 text-ink-soft">urgency: {h.urgency}</span>}
                  {h.category === 'blood' && h.blood_group && (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 font-bold text-red-600">{h.blood_group}</span>
                  )}
                  {h.location && <span className="text-ink-soft">📍 {h.location}</span>}
                  {h.required_date && <span className="text-ink-soft">Needed: {h.required_date}</span>}
                </p>
              </div>
              <Badge value={h.status} />
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{h.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {isAdmin && h.status === 'open' && <Button variant="outline" className="!px-2 !py-1 text-xs" onClick={() => setStatus(h.help_id, 'in_progress')}>Start progress</Button>}
              {isAdmin && h.status === 'in_progress' && <Button variant="outline" className="!px-2 !py-1 text-xs" onClick={() => setStatus(h.help_id, 'resolved')}>Mark resolved</Button>}
              {(isAdmin || h.user_id === user.user_id) && !['closed', 'resolved'].includes(h.status) && (
                <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setStatus(h.help_id, 'closed')}>Close</Button>
              )}
              {isAdmin && <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={() => remove(h)}>Delete</Button>}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
