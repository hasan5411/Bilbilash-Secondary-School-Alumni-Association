import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Card, Input, Select, Textarea, Button, Spinner, Alert, EmptyState, PageHeader, Badge } from '../../components/ui.jsx';

const EMPTY_FORM = {
  title: '', description: '', location: '', event_date: '', start_time: '', end_time: '',
  capacity: 100, registration_fee: '', eligible_batches: '', tshirt_included: 'no',
};

const money = (v) => Number(v || 0).toLocaleString();
const day = (v) => (v ? String(v).slice(0, 10) : '—');
const when = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : '—');

/** Comma/space separated SSC batches → sorted unique integers (empty = all). */
function parseBatches(text) {
  const tokens = String(text || '').split(/[\s,]+/).filter(Boolean);
  const nums = tokens.map((t) => Number(t));
  if (nums.some((n) => !Number.isInteger(n) || n <= 0)) {
    throw new Error('Eligible SSC batches must be whole numbers separated by commas (e.g. 2005, 2010).');
  }
  return [...new Set(nums)].sort((a, b) => a - b);
}

function feeText(fee) {
  return fee === null || fee === undefined ? 'Free' : `৳${money(fee)}`;
}

function batchText(batches) {
  return Array.isArray(batches) && batches.length ? `Batches ${batches.join(', ')}` : 'All batches';
}

/** Viewer/print cell: the event flag wins over every row value. */
const tshirtText = (row, event) => {
  if (!event?.tshirt_included) return 'Not Applicable';
  return row?.tshirt_size || 'Not Selected';
};

const VIEWS = [
  ['active', 'Active'],
  ['pending', 'Pending Payments'],
  ['cancelled', 'Cancelled'],
];

export default function EventsManage() {
  const { isAdmin } = useAuth();
  const [events, setEvents] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
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
      const batches = parseBatches(form.eligible_batches);
      const res = await api.post('/api/events', {
        title: form.title,
        capacity: Number(form.capacity),
        event_date: form.event_date,
        start_time: form.start_time || undefined,
        end_time: form.end_time || undefined,
        description: form.description || undefined,
        location: form.location || undefined,
        registration_fee: form.registration_fee === '' ? undefined : Number(form.registration_fee),
        eligible_batches: batches.length ? batches : undefined,
        tshirt_included: form.tshirt_included === 'yes',
      });
      setMsg({ kind: 'success', text: res.message });
      setForm(EMPTY_FORM);
      load();
    } catch (err) { setMsg({ kind: 'error', text: err.message }); }
    finally { setBusy(false); }
  };

  const cancel = async (id) => {
    if (!window.confirm('Cancel this event?')) return;
    try { await api.put(`/api/events/${id}/cancel`); load(); }
    catch (e) { alert(e.message); }
  };

  const archive = async (ev) => {
    if (!window.confirm(`Archive "${ev.title}"? Members can no longer register; history stays intact.`)) return;
    setMsg(null);
    try { const res = await api.put(`/api/events/${ev.event_id}/archive`); setMsg({ kind: 'success', text: res.message }); load(); }
    catch (e) { setMsg({ kind: 'error', text: e.message }); }
  };

  const remove = async (ev) => {
    if (!window.confirm(`Delete event "${ev.title}"? This is only possible when it has no registration or payment history.`)) return;
    setMsg(null);
    try { const res = await api.del(`/api/events/${ev.event_id}`); setMsg({ kind: 'success', text: res.message }); load(); }
    catch (e) { setMsg({ kind: 'error', text: e.message }); }
  };

  // ── Fee + eligibility editing (fee changes affect NEW registrations only) ──
  const [editing, setEditing] = useState(null); // { event_id, registration_fee, eligible_batches }
  const startEdit = (ev) => setEditing({
    event_id: ev.event_id,
    registration_fee: ev.registration_fee == null ? '' : String(ev.registration_fee),
    eligible_batches: Array.isArray(ev.eligible_batches) ? ev.eligible_batches.join(', ') : '',
    tshirt_included: ev.tshirt_included ? 'yes' : 'no',
  });
  const saveEdit = async (ev) => {
    setBusy(true); setMsg(null);
    try {
      // Disabling T-shirts never deletes saved sizes — warn before hiding it.
      if (ev.tshirt_included && editing.tshirt_included === 'no') {
        let saved = 0;
        try {
          const r = await api.get(`/api/events/${ev.event_id}/registrations?view=active`);
          saved = (r.data.registrations || []).filter((x) => x.tshirt_size).length;
        } catch { /* the count is advisory; saving still requires explicit confirmation */ }
        const note = saved
          ? `${saved} member(s) already chose a size. Saved sizes are kept and will show again if you re-enable T-shirts.`
          : 'Members will no longer be able to choose a size.';
        if (!window.confirm(`Disable T-shirts for "${ev.title}"? ${note} Continue?`)) return;
      }
      const batches = parseBatches(editing.eligible_batches);
      const res = await api.put(`/api/events/${ev.event_id}`, {
        title: ev.title,
        description: ev.description || undefined,
        location: ev.location || undefined,
        event_date: day(ev.event_date),
        start_time: ev.start_time || undefined,
        end_time: ev.end_time || undefined,
        capacity: Number(ev.capacity),
        status: ev.status,
        registration_fee: editing.registration_fee === '' ? undefined : Number(editing.registration_fee),
        eligible_batches: batches.length ? batches : undefined,
        tshirt_included: editing.tshirt_included === 'yes',
      });
      setMsg({ kind: 'success', text: res.message });
      setEditing(null);
      load();
    } catch (err) { setMsg({ kind: 'error', text: err.message }); }
    finally { setBusy(false); }
  };

  // ── Registration viewer (Admin/Authority only — route + API both enforce) ─
  const [viewer, setViewer] = useState(null);   // the event whose list is open
  const [view, setView] = useState('active');   // active | pending | cancelled
  const [regs, setRegs] = useState(null);       // { event, view, registrations, total, counts }
  const [participants, setParticipants] = useState(null); // print dataset
  const [regsBusy, setRegsBusy] = useState(false);
  const [regsError, setRegsError] = useState('');
  const seqRef = useRef(0); // invalidates stale responses when switching events/views

  const fetchView = (ev, nextView, seq) => {
    setRegsBusy(true);
    api.get(`/api/events/${ev.event_id}/registrations?view=${nextView}`)
      .then((r) => { if (seq === seqRef.current) setRegs(r.data); })
      .catch((e) => { if (seq === seqRef.current) setRegsError(e.message); })
      .finally(() => { if (seq === seqRef.current) setRegsBusy(false); });
  };

  const fetchParticipants = (ev, seq) => {
    api.get(`/api/events/${ev.event_id}/participants`)
      .then((r) => { if (seq === seqRef.current) setParticipants(r.data); })
      .catch(() => { if (seq === seqRef.current) setParticipants(null); });
  };

  const openRegistrations = (ev) => {
    const seq = ++seqRef.current;
    setViewer(ev);
    setView('active');
    setRegs(null);      // never show the previously selected event's rows
    setParticipants(null);
    setRegsError('');
    fetchView(ev, 'active', seq);
    fetchParticipants(ev, seq);
  };

  const changeView = (nextView) => {
    if (!viewer || nextView === view) return;
    const seq = ++seqRef.current;
    setView(nextView);
    setRegs(null);
    setRegsError('');
    fetchView(viewer, nextView, seq);
  };

  const refreshViewer = () => {
    if (!viewer) return;
    const seq = ++seqRef.current;
    fetchView(viewer, view, seq);
    fetchParticipants(viewer, seq);
  };

  const closeRegistrations = () => {
    seqRef.current += 1; // any in-flight request for the previous event is ignored
    setViewer(null);
    setRegs(null);
    setParticipants(null);
    setRegsError('');
  };

  const cancelReg = async (r) => {
    if (!window.confirm(`Cancel the registration of ${r.first_name} ${r.last_name}? Payments already received are kept for manual reconciliation.`)) return;
    setRegsError('');
    try {
      await api.patch(`/api/events/${viewer.event_id}/registrations/${r.registration_id}/cancel`);
      refreshViewer();
      load();
    } catch (e) { setRegsError(e.message); }
  };

  useEffect(() => {
    if (!viewer) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closeRegistrations(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer]);

  return (
    <div>
      <PageHeader title="Manage Events" subtitle="Create, edit, cancel and archive association events." />
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
          <Input
            label="Registration fee (৳) — leave empty for a free event"
            type="number" min="1" step="0.01"
            value={form.registration_fee} onChange={set('registration_fee')}
          />
          <Select label="T-shirt Included?" value={form.tshirt_included} onChange={set('tshirt_included')}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </Select>
          <div className="sm:col-span-2">
            <Input
              label="Eligible SSC batches — leave empty for all batches"
              placeholder="e.g. 2005, 2010, 2015"
              value={form.eligible_batches} onChange={set('eligible_batches')}
            />
            <p className="mt-1 text-xs text-ink-soft">Only members whose profile SSC batch is in this list can register.</p>
          </div>
          {/* Full-width, ~8 visible lines, vertically resizable: long descriptions
              can be read and edited without scrolling inside a 3-line box. */}
          <div className="sm:col-span-3">
            <Textarea
              label="Description"
              rows={8}
              className="min-h-52 resize-y leading-relaxed"
              value={form.description}
              onChange={set('description')}
            />
            <p className="mt-1 text-xs text-ink-soft">Up to 3000 characters. Drag the lower-right corner to resize.</p>
          </div>
          <div><Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create event'}</Button></div>
        </form>
      </Card>

      {loading && <Spinner />}
      {error && <Alert kind="error">{error}</Alert>}
      {events && events.length === 0 && <EmptyState title="No events yet." />}
      <div className="space-y-3">
        {(events || []).map((ev) => (
          <Card key={ev.event_id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-ink">{ev.title}</h3>
                <p className="text-sm text-ink-soft">📅 {ev.event_date}{ev.location ? ` · ${ev.location}` : ''} · {ev.registration_count}/{ev.capacity} active</p>
                <p className="mt-1 text-xs font-semibold text-ink-soft">
                  {feeText(ev.registration_fee)} · {batchText(ev.eligible_batches)}
                  {ev.tshirt_included ? ' · T-shirt included' : ''}
                  {ev.archived_at ? ' · archived' : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge value={ev.status} />
                {isAdmin && (
                  <Button variant="outline" className="!px-2 !py-1 text-xs" onClick={() => openRegistrations(ev)}>
                    View Registrations ({ev.registration_count})
                  </Button>
                )}
                <Button variant="outline" className="!px-2 !py-1 text-xs" onClick={() => (editing?.event_id === ev.event_id ? setEditing(null) : startEdit(ev))}>
                  {editing?.event_id === ev.event_id ? 'Close editor' : 'Edit fee & eligibility'}
                </Button>
                {ev.status === 'published' && <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={() => cancel(ev.event_id)}>Cancel event</Button>}
                {!ev.archived_at && <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => archive(ev)}>Archive</Button>}
                <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={() => remove(ev)}>Delete</Button>
              </div>
            </div>

            {editing?.event_id === ev.event_id && (
              <div className="mt-3 grid gap-3 rounded-lg border border-line bg-ice p-3 sm:grid-cols-3">
                <Input
                  label="Registration fee (৳) — empty = free"
                  type="number" min="1" step="0.01"
                  value={editing.registration_fee}
                  onChange={(e) => setEditing({ ...editing, registration_fee: e.target.value })}
                />
                <div className="sm:col-span-2">
                  <Input
                    label="Eligible SSC batches — empty = all"
                    placeholder="e.g. 2005, 2010"
                    value={editing.eligible_batches}
                    onChange={(e) => setEditing({ ...editing, eligible_batches: e.target.value })}
                  />
                </div>
                <Select
                  label="T-shirt Included?"
                  value={editing.tshirt_included}
                  onChange={(e) => setEditing({ ...editing, tshirt_included: e.target.value })}
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </Select>
                <p className="text-xs text-ink-soft sm:col-span-3">
                  Fee and eligibility changes apply to new registrations only — existing registrations keep their snapshot.
                  Disabling T-shirts keeps every saved size stored.
                </p>
                <div className="flex gap-2 sm:col-span-3">
                  <Button disabled={busy} onClick={() => saveEdit(ev)}>{busy ? 'Saving…' : 'Save changes'}</Button>
                  <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* ── Registration viewer modal (3 tabs; print uses the participants API) ── */}
      {viewer && (
        <div
          className="reg-overlay fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 p-4"
          role="dialog" aria-modal="true" aria-label={`Registrations for ${viewer.title}`}
          onClick={(e) => { if (e.target === e.currentTarget) closeRegistrations(); }}
        >
          <div className="print-sheet mx-auto my-8 w-full max-w-5xl rounded-xl border border-line bg-white p-5 shadow-lg">
            {/* Print-only letterhead — totals come from the participants API. */}
            <div className="hidden print:mb-4 print:block print:border-b-2 print:border-ink print:pb-2 print:text-center">
              <h2 className="print:text-lg print:font-bold">BILBILASH SECONDARY SCHOOL ALUMNI ASSOCIATION</h2>
              <p className="print:text-sm print:font-semibold">Event Participant List</p>
              <p className="print:text-sm">
                {viewer.title}{viewer.event_date ? ` — ${viewer.event_date}` : ''}{viewer.location ? ` · ${viewer.location}` : ''}
              </p>
              <p className="print:text-sm">Total participants: {participants ? participants.total : '—'}</p>
            </div>

            {/* On-screen header (hidden while printing). */}
            <div className="no-print mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-ink">Registrations — {viewer.title}</h3>
                <p className="text-sm text-ink-soft">📅 {viewer.event_date}{viewer.location ? ` · ${viewer.location}` : ''}</p>
                <p className="mt-1 text-sm font-semibold text-ink">
                  Active: {regs?.counts?.active ?? '…'} · Pending payments: {regs?.counts?.pending ?? '…'} · Cancelled: {regs?.counts?.cancelled ?? '…'}
                </p>
              </div>
              <Button variant="ghost" onClick={closeRegistrations}>Close</Button>
            </div>

            {/* Tabs */}
            <div className="no-print mb-3 flex flex-wrap gap-2">
              {VIEWS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => changeView(key)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${view === key ? 'bg-moss text-white' : 'bg-mist text-ink-soft hover:bg-line'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {regsBusy && <Spinner label="Loading registrations…" />}
            {!regsBusy && regsError && <Alert kind="error">{regsError}</Alert>}
            {!regsBusy && !regsError && regs && regs.registrations.length === 0 && (
              <EmptyState title={`No ${view === 'pending' ? 'pending-payment' : view} registrations for this event.`} />
            )}

            {!regsBusy && !regsError && regs && regs.registrations.length > 0 && (
              <div className="no-print overflow-x-auto">
                <table className="reg-table w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line bg-mint text-left text-ink">
                      <th className="px-2 py-2 font-semibold">#</th>
                      <th className="px-2 py-2 font-semibold">Member name</th>
                      <th className="px-2 py-2 font-semibold">Member ID</th>
                      <th className="px-2 py-2 font-semibold">SSC batch</th>
                      {view !== 'cancelled' && <th className="px-2 py-2 font-semibold">Phone</th>}
                      <th className="px-2 py-2 font-semibold">Registered</th>
                      {view === 'active' && <th className="px-2 py-2 font-semibold">Payment</th>}
                      {view === 'active' && <th className="px-2 py-2 font-semibold">Fee</th>}
                      {view === 'active' && <th className="px-2 py-2 font-semibold">Deadline</th>}
                      {view === 'pending' && <th className="px-2 py-2 font-semibold">Required fee</th>}
                      {view === 'pending' && <th className="px-2 py-2 font-semibold">Approved</th>}
                      {view === 'pending' && <th className="px-2 py-2 font-semibold">Remaining</th>}
                      {view === 'pending' && <th className="px-2 py-2 font-semibold">Deadline</th>}
                      {view === 'cancelled' && <th className="px-2 py-2 font-semibold">Cancelled on</th>}
                      {view === 'cancelled' && <th className="px-2 py-2 font-semibold">Reason</th>}
                      {view === 'cancelled' && <th className="px-2 py-2 font-semibold">Previous payment</th>}
                      {view === 'cancelled' && <th className="px-2 py-2 font-semibold">Attempts</th>}
                      <th className="px-2 py-2 font-semibold">T-shirt size</th>
                      {view === 'active' && <th className="px-2 py-2 font-semibold" />}
                    </tr>
                  </thead>
                  <tbody>
                    {regs.registrations.map((r, i) => (
                      <tr key={r.registration_id} className="border-b border-line align-top">
                        <td className="px-2 py-2 text-ink-soft">{i + 1}</td>
                        <td className="px-2 py-2 font-medium text-ink">{r.first_name} {r.last_name}</td>
                        <td className="px-2 py-2">{r.registration_number || '—'}</td>
                        <td className="px-2 py-2">{r.ssc_batch ?? '—'}</td>
                        {view !== 'cancelled' && <td className="px-2 py-2">{r.phone || '—'}</td>}
                        <td className="px-2 py-2">{day(r.registered_at)}</td>
                        {view === 'active' && <td className="px-2 py-2">{r.payment_status}</td>}
                        {view === 'active' && <td className="px-2 py-2">{feeText(r.registration_fee)}</td>}
                        {view === 'active' && <td className="px-2 py-2">{r.payment_deadline_display || '—'}</td>}
                        {view === 'pending' && <td className="px-2 py-2">{feeText(r.registration_fee)}</td>}
                        {view === 'pending' && <td className="px-2 py-2">৳{money(r.approved_amount)}</td>}
                        {view === 'pending' && <td className="px-2 py-2">৳{money(r.remaining_amount)}</td>}
                        {view === 'pending' && <td className="px-2 py-2">{r.payment_deadline_display || '—'}</td>}
                        {view === 'cancelled' && <td className="px-2 py-2">{when(r.cancelled_at)}</td>}
                        {view === 'cancelled' && <td className="px-2 py-2">{r.cancel_reason || '—'}</td>}
                        {view === 'cancelled' && <td className="px-2 py-2">{r.payment_status}</td>}
                        {view === 'cancelled' && <td className="px-2 py-2">{r.unpaid_expiry_attempts}/3</td>}
                        <td className="px-2 py-2">{tshirtText(r, regs?.event)}</td>
                        {view === 'active' && (
                          <td className="px-2 py-2 text-right">
                            <Button variant="danger" className="!px-2 !py-1 text-xs" disabled={!r.can_cancel} title={r.cancel_block_reason || ''} onClick={() => cancelReg(r)}>
                              Cancel
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {view === 'active' && regs.registrations.some((r) => !r.can_cancel && r.cancel_block_reason) && (
                      <tr>
                        <td colSpan={11} className="px-2 pt-2 text-xs text-ink-soft">
                          {regs.registrations.find((r) => !r.can_cancel && r.cancel_block_reason)?.cancel_block_reason}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Print-only participant table (active + eligible + paid/not_required). */}
            <div className="hidden print:block">
              {participants && participants.registrations.length > 0 ? (
                <table className="reg-table w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink text-left">
                      <th className="px-2 py-1 font-semibold">#</th>
                      <th className="px-2 py-1 font-semibold">Member name</th>
                      <th className="px-2 py-1 font-semibold">SSC batch</th>
                      <th className="px-2 py-1 font-semibold">Contact number</th>
                      <th className="px-2 py-1 font-semibold">Registered on</th>
                      <th className="px-2 py-1 font-semibold">Payment</th>
                      <th className="px-2 py-1 font-semibold">T-shirt size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {participants.registrations.map((r, i) => (
                      <tr key={r.registration_id} className="border-b border-line">
                        <td className="px-2 py-1">{i + 1}</td>
                        <td className="px-2 py-1">{r.first_name} {r.last_name}</td>
                        <td className="px-2 py-1">{r.ssc_batch ?? '—'}</td>
                        <td className="px-2 py-1">{r.phone || '—'}</td>
                        <td className="px-2 py-1">{day(r.registered_at)}</td>
                        <td className="px-2 py-1">{r.payment_status === 'paid' ? `Paid ৳${money(r.registration_fee)}` : 'Free'}</td>
                        <td className="px-2 py-1">{tshirtText(r, participants.event)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm">No eligible confirmed participants.</p>
              )}
            </div>

            <div className="no-print mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={closeRegistrations}>Close</Button>
              <Button
                onClick={() => window.print()}
                disabled={!participants}
                title={participants ? '' : 'Participant list is still loading'}
              >
                Print Participant List ({participants ? participants.total : '…'})
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
