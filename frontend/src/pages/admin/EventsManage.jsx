import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { Card, Input, Textarea, Button, Spinner, Alert, EmptyState, PageHeader, Badge } from '../../components/ui.jsx';

export default function EventsManage() {
  const [events, setEvents] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', location: '', event_date: '', start_time: '', end_time: '', capacity: 100 });
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const load = useCallback(() => {
    api.get('/api/events').then((r) => setEvents(r.data.events)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const res = await api.post('/api/events', { ...form, capacity: Number(form.capacity), start_time: form.start_time || undefined, end_time: form.end_time || undefined, description: form.description || undefined, location: form.location || undefined });
      setMsg({ kind: 'success', text: res.message });
      setForm({ title: '', description: '', location: '', event_date: '', start_time: '', end_time: '', capacity: 100 });
      load();
    } catch (err) { setMsg({ kind: 'error', text: err.message }); }
    finally { setBusy(false); }
  };

  const cancel = async (id) => {
    if (!window.confirm('Cancel this event?')) return;
    try { await api.put(`/api/events/${id}/cancel`); load(); }
    catch (e) { alert(e.message); }
  };

  const remove = async (ev) => {
    if (!window.confirm(`Delete event "${ev.title}"? Registrations are removed too. This cannot be undone.`)) return;
    setMsg(null);
    try { const res = await api.del(`/api/events/${ev.event_id}`); setMsg({ kind: 'success', text: res.message }); load(); }
    catch (e) { setMsg({ kind: 'error', text: e.message }); }
  };

  return (
    <div>
      <PageHeader title="Manage Events" subtitle="Create and cancel association events." />
      <Card className="mb-5">
        <h3 className="mb-3 font-bold text-ink">New event</h3>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <form onSubmit={submit} className="mt-2 grid gap-3 sm:grid-cols-3">
          <Input label="Title *" required value={form.title} onChange={set('title')} />
          <Input label="Date *" type="date" required value={form.event_date} onChange={set('event_date')} />
          <Input label="Capacity *" type="number" min="1" required value={form.capacity} onChange={set('capacity')} />
          <Input label="Start time" type="time" value={form.start_time} onChange={set('start_time')} />
          <Input label="End time" type="time" value={form.end_time} onChange={set('end_time')} />
          <Input label="Location" value={form.location} onChange={set('location')} />
          <div className="sm:col-span-3"><Textarea label="Description" value={form.description} onChange={set('description')} /></div>
          <div><Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create event'}</Button></div>
        </form>
      </Card>

      {loading && <Spinner />}
      {error && <Alert kind="error">{error}</Alert>}
      {events && events.length === 0 && <EmptyState title="No events yet." />}
      <div className="space-y-3">
        {(events || []).map((ev) => (
          <Card key={ev.event_id} className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-ink">{ev.title}</h3>
              <p className="text-sm text-ink-soft">📅 {ev.event_date}{ev.location ? ` · ${ev.location}` : ''} · {ev.registration_count}/{ev.capacity} registered</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge value={ev.status} />
              {ev.status === 'published' && <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={() => cancel(ev.event_id)}>Cancel event</Button>}
              <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={() => remove(ev)}>Delete</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
