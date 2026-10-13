import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { Card, Input, Select, Textarea, Button, Spinner, Alert, EmptyState, PageHeader, Badge } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const CATEGORIES = ['education', 'welfare', 'event', 'infrastructure', 'other'];

export default function Visions() {
  const { isAdmin } = useAuth();
  const [visions, setVisions] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', category: 'education' });
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/api/visions'); setVisions(r.data.visions); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const res = await api.post('/api/visions', form);
      setMsg({ kind: 'success', text: res.message });
      setForm({ title: '', description: '', category: 'education' });
      load();
    } catch (err) { setMsg({ kind: 'error', text: err.message }); }
    finally { setBusy(false); }
  };

  const moderate = async (id, action) => {
    try { await api.put(`/api/visions/${id}/moderate`, { action }); load(); }
    catch (e) { alert(e.message); }
  };

  const remove = async (v) => {
    if (!window.confirm(`Delete idea "${v.title}"? This cannot be undone.`)) return;
    setMsg(null);
    try { const res = await api.del(`/api/visions/${v.vision_id}`); setMsg({ kind: 'success', text: res.message }); load(); }
    catch (e) { setMsg({ kind: 'error', text: e.message }); }
  };

  return (
    <div>
      <PageHeader title="Vision & Ideas" subtitle="Share ideas to improve the association and the school." />
      <Card className="mb-5">
        <h3 className="mb-3 font-bold text-ink">Submit a new idea</h3>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <form onSubmit={submit} className="mt-2 grid gap-3 sm:grid-cols-2">
          <Input label="Title *" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </Select>
          <div className="sm:col-span-2"><Textarea label="Description *" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div><Button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit idea'}</Button></div>
        </form>
      </Card>

      {loading && <Spinner />}
      {error && <Alert kind="error">{error}</Alert>}
      {visions && visions.length === 0 && <EmptyState title="No ideas yet. Be the first!" />}
      <div className="space-y-3">
        {(visions || []).map((v) => (
          <Card key={v.vision_id}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-ink">{v.title}</h3>
                <p className="text-xs text-ink-soft">by {v.first_name} {v.last_name} · {v.category}</p>
              </div>
              <Badge value={v.status} />
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{v.description}</p>
            {isAdmin && (
              <div className="mt-3 flex flex-wrap gap-2">
                {v.status === 'pending' && <Button variant="outline" className="!px-2 !py-1 text-xs" onClick={() => moderate(v.vision_id, 'approve')}>Approve</Button>}
                {v.status !== 'rejected' && <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={() => moderate(v.vision_id, 'reject')}>Reject</Button>}
                {v.status !== 'implemented' && <Button variant="sun" className="!px-2 !py-1 text-xs" onClick={() => moderate(v.vision_id, 'implement')}>Mark implemented</Button>}
                <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={() => remove(v)}>Delete</Button>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
