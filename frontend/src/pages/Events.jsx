import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { Card, Button, Spinner, Alert, EmptyState, PageHeader, Badge } from '../components/ui.jsx';
import TshirtSizePicker from '../components/TshirtSizePicker.jsx';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Event description with access to the FULL text. The card keeps its compact
 * 2-line preview, but a long or multi-line description can be expanded inline —
 * nothing is ever truncated without a way to read it.
 */
function EventDescription({ text }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 140 || text.includes('\n');
  return (
    <div className="mt-2">
      <p className={`whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-soft ${open ? '' : 'line-clamp-2'}`}>
        {text}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-1 text-xs font-semibold text-moss hover:underline"
        >
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  );
}

const feeLabel = (fee) => (fee === null || fee === undefined ? 'Free entry' : `Fee ৳${Number(fee).toLocaleString()}`);
const batchLabel = (batches) => (
  Array.isArray(batches) && batches.length
    ? `Eligible SSC batches: ${batches.join(', ')}`
    : 'Open to all SSC batches'
);
const paymentLabel = (reg) => {
  if (!reg) return null;
  if (reg.payment_status === 'paid') return `Paid ৳${Number(reg.registration_fee || 0).toLocaleString()}`;
  if (reg.payment_status === 'unpaid') {
    const due = reg.payment_deadline_display || String(reg.payment_deadline || '').slice(0, 16);
    return `Payment unpaid — ৳${Number(reg.registration_fee || 0).toLocaleString()} due by ${due || 'the deadline'}`;
  }
  return 'No payment required';
};

export default function Events() {
  const { isMember } = useAuth();
  const [events, setEvents] = useState(null);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.get('/api/events');
      setEvents(res.data.events);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (eventId, action) => {
    setMsg(null);
    try {
      const res = action === 'register'
        ? await api.post(`/api/events/${eventId}/register`)
        : await api.del(`/api/events/${eventId}/register`);
      setMsg({ kind: 'success', text: res.message });
      load();
    } catch (e) { setMsg({ kind: 'error', text: e.message }); }
  };

  return (
    <div>
      <PageHeader title="Events" subtitle="Reunions, seminars, and community gatherings.">
        <Link to="/my-registrations" className="text-sm font-semibold text-moss hover:underline">My registrations →</Link>
      </PageHeader>

      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      {loading && <Spinner />}
      {events && events.length === 0 && <EmptyState title="No upcoming events." />}

      <div className="grid gap-4 md:grid-cols-2">
        {(events || []).map((ev) => {
          const reg = ev.my_registration || null; // active registration only (server-derived)
          const open = ev.status === 'published' && !ev.archived_at;
          // T-shirt facility: the admin must enable it per event, and the
          // member's registration must be confirmed — 'paid', or 'not_required'
          // for a free event (unpaid/pending/rejected payments never qualify).
          const tshirtAvailable = Boolean(
            reg && ev.tshirt_included && open && ev.eligible !== false
            && (reg.payment_status === 'paid' || reg.payment_status === 'not_required')
          );
          return (
            /* min-w-0: a long unbroken description/URL must not widen the grid
               track and push the Register button off-screen on narrow viewports. */
            <Card key={ev.event_id} className="min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words text-lg font-bold text-ink">{ev.title}</h3>
                  <p className="text-sm text-ink-soft">📅 {ev.event_date}{ev.start_time ? ` · 🕒 ${ev.start_time.slice(0, 5)}` : ''}{ev.location ? ` · 📍 ${ev.location}` : ''}</p>
                </div>
                <Badge value={ev.status} />
              </div>
              {ev.description && <EventDescription text={ev.description} />}

              {/* Fee + eligibility are server-provided (never inferred here). */}
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold">
                <span className={ev.registration_fee == null ? 'text-moss' : 'text-ink'}>{feeLabel(ev.registration_fee)}</span>
                <span className="text-ink-soft">{batchLabel(ev.eligible_batches)}</span>
                {ev.eligible === false && <span className="text-amber-700">You are not eligible for this event</span>}
              </div>

              {reg && <p className="mt-2 text-xs font-semibold text-ink-soft">{paymentLabel(reg)}</p>}
              {tshirtAvailable && (
                <TshirtSizePicker eventId={ev.event_id} size={reg.tshirt_size || ''} onSaved={load} />
              )}
              {ev.unpaid_expiry_attempts > 0 && (
                <p className="mt-1 text-xs text-ink-soft">Unpaid registration attempts: {ev.unpaid_expiry_attempts}/3</p>
              )}
              {!reg && !ev.can_register && ev.eligibility_reason && (
                <p className="mt-2 text-xs font-semibold text-amber-700">{ev.eligibility_reason}</p>
              )}

              <div className="mt-3 flex items-center justify-between">
                <span className={`text-xs font-semibold ${ev.registration_count >= ev.capacity ? 'text-red-500' : 'text-ink-soft'}`}>
                  {ev.registration_count}/{ev.capacity} registered{ev.registration_count >= ev.capacity ? ' · FULL' : ''}
                </span>
                {isMember && open && (
                  reg ? (
                    <Button
                      variant="outline"
                      disabled={!reg.can_cancel}
                      title={reg.cancel_block_reason || ''}
                      onClick={() => act(ev.event_id, 'unregister')}
                    >
                      Cancel registration
                    </Button>
                  ) : (
                    <Button
                      onClick={() => act(ev.event_id, 'register')}
                      disabled={!ev.can_register}
                      title={ev.eligibility_reason || ''}
                    >
                      {ev.can_register ? 'Register' : 'Registration unavailable'}
                    </Button>
                  )
                )}
              </div>
              {reg && !reg.can_cancel && reg.cancel_block_reason && (
                <p className="mt-1 text-right text-xs text-ink-soft">{reg.cancel_block_reason}</p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
