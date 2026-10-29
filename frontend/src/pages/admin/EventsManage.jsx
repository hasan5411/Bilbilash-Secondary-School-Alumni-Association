import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
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

  // ── Registration viewer (Admin/Authority only — route + API both enforce) ─
  const { isAdmin } = useAuth();
  const [viewer, setViewer] = useState(null);   // the event whose list is open
  const [regs, setRegs] = useState(null);       // { event, registrations, total }
  const [regsBusy, setRegsBusy] = useState(false);
  const [regsError, setRegsError] = useState('');
  const seqRef = useRef(0); // invalidates stale responses when switching events

  const closeRegistrations = () => {
    seqRef.current += 1; // any in-flight request for the previous event is ignored
    setViewer(null);
    setRegs(null);
    setRegsError('');
  };

  const openRegistrations = (ev) => {
    const seq = ++seqRef.current;
    setViewer(ev);
    setRegs(null);      // never show the previously selected event's rows
    setRegsError('');
    setRegsBusy(true);
    api.get(`/api/events/${ev.event_id}/registrations`)
      .then((r) => { if (seq === seqRef.current) setRegs(r.data); })
      .catch((e) => { if (seq === seqRef.current) setRegsError(e.message); })
      .finally(() => { if (seq === seqRef.current) setRegsBusy(false); });
  };

  useEffect(() => {
    if (!viewer) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closeRegistrations(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer]);

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
              {isAdmin && (
                <Button variant="outline" className="!px-2 !py-1 text-xs" onClick={() => openRegistrations(ev)}>
                  View Registrations ({ev.registration_count})
                </Button>
              )}
              {ev.status === 'published' && <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={() => cancel(ev.event_id)}>Cancel event</Button>}
              <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={() => remove(ev)}>Delete</Button>
            </div>
          </Card>
        ))}
      </div>

      {/* ── Registration viewer modal ───────────────────────────────────── */}
      {viewer && (
        <div
          className="reg-overlay fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 p-4"
          role="dialog" aria-modal="true" aria-label={`Registrations for ${viewer.title}`}
          onClick={(e) => { if (e.target === e.currentTarget) closeRegistrations(); }}
        >
          <div className="print-sheet mx-auto my-8 w-full max-w-3xl rounded-xl border border-line bg-white p-5 shadow-lg">
            {/* Print-only letterhead: association, event, date, total. */}
            <div className="hidden print:mb-4 print:block print:border-b-2 print:border-ink print:pb-2 print:text-center">
              <h2 className="print:text-lg print:font-bold">BILBILASH SECONDARY SCHOOL ALUMNI ASSOCIATION</h2>
              <p className="print:text-sm print:font-semibold">Event Registration List</p>
              <p className="print:text-sm">
                {viewer.title}{viewer.event_date ? ` — ${viewer.event_date}` : ''}{viewer.location ? ` · ${viewer.location}` : ''}
              </p>
              <p className="print:text-sm">Total registered members: {regs ? regs.total : '—'}</p>
            </div>

            {/* On-screen header (hidden while printing). */}
            <div className="no-print mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-ink">Registrations — {viewer.title}</h3>
                <p className="text-sm text-ink-soft">📅 {viewer.event_date}{viewer.location ? ` · ${viewer.location}` : ''}</p>
                <p className="mt-1 text-sm font-semibold text-ink">
                  Registered members: {regsBusy ? '…' : regsError ? '—' : regs ? regs.total : '…'}
                </p>
              </div>
              <Button variant="ghost" onClick={closeRegistrations}>Close</Button>
            </div>

            {regsBusy && <Spinner label="Loading registrations…" />}
            {!regsBusy && regsError && <Alert kind="error">{regsError}</Alert>}
            {!regsBusy && !regsError && regs && regs.registrations.length === 0 && (
              <EmptyState title="No members have registered for this event yet." />
            )}
            {!regsBusy && !regsError && regs && regs.registrations.length > 0 && (
              <div className="overflow-x-auto">
                <table className="reg-table w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line bg-mint text-left text-ink">
                      <th className="px-2 py-2 font-semibold">#</th>
                      <th className="px-2 py-2 font-semibold">Member name</th>
                      <th className="px-2 py-2 font-semibold">SSC batch</th>
                      <th className="px-2 py-2 font-semibold">Contact number</th>
                      <th className="px-2 py-2 font-semibold">Registered on</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regs.registrations.map((r, i) => (
                      <tr key={r.registration_id} className="border-b border-line align-top">
                        <td className="px-2 py-2 text-ink-soft">{i + 1}</td>
                        <td className="px-2 py-2 font-medium text-ink">{r.first_name} {r.last_name}</td>
                        <td className="px-2 py-2">{r.ssc_batch ?? '—'}</td>
                        <td className="px-2 py-2">{r.phone || '—'}</td>
                        <td className="px-2 py-2">{String(r.registered_at || '').slice(0, 10) || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="no-print mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={closeRegistrations}>Close</Button>
              <Button
                onClick={() => window.print()}
                disabled={regsBusy || Boolean(regsError) || !regs || regs.registrations.length === 0}
              >
                Print List
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
