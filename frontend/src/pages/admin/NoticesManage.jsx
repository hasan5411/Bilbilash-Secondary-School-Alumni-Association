import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { Card, Input, Textarea, Button, Spinner, Alert, EmptyState, PageHeader, Badge } from '../../components/ui.jsx';

export default function NoticesManage() {
  const [notices, setNotices] = useState(null);
  const [form, setForm] = useState({ title: '', body: '' });
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/api/notices').then((r) => setNotices(r.data.notices)).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const res = await api.post('/api/notices', form);
      setMsg({ kind: 'success', text: res.message });
      setForm({ title: '', body: '' });
      load();
    } catch (err) { setMsg({ kind: 'error', text: err.message }); }
    finally { setBusy(false); }
  };

  const archive = async (id) => {
    try { await api.put(`/api/notices/${id}/archive`); load(); }
    catch (e) { alert(e.message); }
  };

  const remove = async (n) => {
    if (!window.confirm(`Delete notice "${n.title}"? This cannot be undone.`)) return;
    setMsg(null);
    try { const res = await api.del(`/api/notices/${n.notice_id}`); setMsg({ kind: 'success', text: res.message }); load(); }
    catch (e) { setMsg({ kind: 'error', text: e.message }); }
  };

  return (
    <div>
      <PageHeader title="Manage Notices" subtitle="Published notices are visible to everyone." />
      <Card className="mb-5">
        <h3 className="mb-3 font-bold text-ink">New notice</h3>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <form onSubmit={submit} className="mt-2 space-y-3">
          <Input label="Title *" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Textarea label="Body *" required value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <Button type="submit" disabled={busy}>{busy ? 'Publishing…' : 'Publish notice'}</Button>
        </form>
      </Card>

      {error && <Alert kind="error">{error}</Alert>}
      {!notices && !error && <Spinner />}
      {notices && notices.length === 0 && <EmptyState title="No notices yet." />}
      <div className="space-y-3">
        {(notices || []).map((n) => (
          <Card key={n.notice_id} className="flex items-start justify-between">
            <div>
              <h3 className="font-bold text-ink">{n.title}</h3>
              <p className="line-clamp-2 text-sm text-ink-soft">{n.body}</p>
              <p className="mt-1 text-xs text-ink-soft">{new Date(n.created_at).toLocaleDateString()}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge value={n.status} />
              {n.status === 'published' && <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => archive(n.notice_id)}>Archive</Button>}
              <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={() => remove(n)}>Delete</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
