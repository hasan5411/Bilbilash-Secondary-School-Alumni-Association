import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { Card, Button, Spinner, Alert, EmptyState, PageHeader, Badge } from '../components/ui.jsx';
import TshirtSizePicker from '../components/TshirtSizePicker.jsx';

const money = (v) => Number(v || 0).toLocaleString();
const day = (v) => (v ? String(v).slice(0, 10) : '');
const stamp = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : '');

function paymentLine(r) {
  if (r.payment_status === 'paid') {
    return `Paid ৳${money(r.registration_fee)}${r.confirmed_at ? ` · confirmed ${stamp(r.confirmed_at)}` : ''}`;
  }
  if (r.payment_status === 'unpaid') {
    const due = r.payment_deadline_display || stamp(r.payment_deadline);
    return `Unpaid — ৳${money(r.registration_fee)} due by ${due || 'the deadline'}`;
  }
  return 'No payment required';
}

export default function MyEventRegistrations() {
  const [regs, setRegs] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState(null);

  const load = useCallback(() => {
    api.get('/api/events/mine/registrations')
      .then((r) => setRegs(r.data.registrations))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  const cancel = async (r) => {
    if (!window.confirm(`Cancel your registration for "${r.title}"? Any payment already made is kept and reviewed by an admin — it is not refunded automatically.`)) return;
    setMsg(null);
    try {
      const res = await api.del(`/api/events/${r.event_id}/register`);
      setMsg({ kind: 'success', text: res.message });
      load();
    } catch (e) { setMsg({ kind: 'error', text: e.message }); }
  };

  return (
    <div>
      <PageHeader title="My Event Registrations" subtitle="Active and cancelled registrations, with payment status.">
        <Link to="/events" className="text-sm font-semibold text-moss hover:underline">Browse events →</Link>
      </PageHeader>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      {!regs && !error && <Spinner />}
      {regs && regs.length === 0 && <EmptyState title="You have not registered for any events." />}
      <div className="grid gap-4 md:grid-cols-2">
        {(regs || []).map((r) => (
          <Card key={r.registration_id}>
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-bold text-ink">{r.title}</h3>
              <div className="flex flex-wrap justify-end gap-1">
                <Badge value={r.status} />
                {r.event_status && r.event_status !== r.status && <Badge value={r.event_status} />}
              </div>
            </div>
            <p className="text-sm text-ink-soft">
              📅 {r.event_start_display ? r.event_start_display.slice(0, 10) : r.event_date}
              {r.start_time ? ` · 🕒 ${String(r.start_time).slice(0, 5)}` : ''}
              {r.location ? ` · 📍 ${r.location}` : ''}
            </p>

            <dl className="mt-3 space-y-1 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Registration fee</dt>
                <dd className="font-semibold text-ink">{r.registration_fee == null ? 'Free' : `৳${money(r.registration_fee)}`}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Payment</dt>
                <dd className={`text-right font-semibold ${r.payment_status === 'unpaid' ? 'text-amber-700' : 'text-ink'}`}>{paymentLine(r)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-soft">Registered on</dt>
                <dd className="font-semibold text-ink">{day(r.registered_at) || '—'}</dd>
              </div>
              {r.unpaid_expiry_attempts > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-soft">Unpaid expiry attempts</dt>
                  <dd className="font-semibold text-ink">{r.unpaid_expiry_attempts}/3</dd>
                </div>
              )}
              {r.is_cancelled && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-soft">Cancelled</dt>
                  <dd className="text-right font-semibold text-ink">
                    {stamp(r.cancelled_at) || '—'}{r.cancel_reason ? ` — ${r.cancel_reason}` : ''}
                  </dd>
                </div>
              )}
            </dl>

            {r.is_active && r.tshirt_included
              && (r.payment_status === 'paid' || r.payment_status === 'not_required') && (
              <TshirtSizePicker eventId={r.event_id} size={r.tshirt_size || ''} onSaved={load} />
            )}

            {r.is_active && (
              <div className="mt-3 flex items-center justify-end gap-2">
                {!r.can_cancel && r.cancel_block_reason && (
                  <span className="text-xs text-ink-soft">{r.cancel_block_reason}</span>
                )}
                <Button
                  variant="outline"
                  disabled={!r.can_cancel}
                  title={r.cancel_block_reason || ''}
                  onClick={() => cancel(r)}
                >
                  Cancel registration
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
