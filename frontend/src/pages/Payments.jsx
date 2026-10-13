import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { Card, Button, Input, Select, Textarea, Spinner, Alert, PageHeader, Badge, EmptyState } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const MONTHLY_AMOUNTS = [20, 30, 50, 100];
const PURPOSE_LABELS = {
  event_contribution: 'Event Contribution',
  donation: 'Donation',
  help_fund: 'Help Fund',
  emergency_fund: 'Emergency Fund',
  other: 'Other',
};
const METHOD_LABELS = { test: 'TEST PAYMENT', bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket' };

// Dev-only TEST payment simulation. Hidden from the UI; set to true to re-enable for local demos.
const SHOW_TEST_PAYMENT_UI = false;

// Shown only until GET /api/payments/providers answers; the server copy is the
// source of truth (numbers come from backend/.env).
const FALLBACK_PROVIDERS = [
  {
    key: 'bkash', label: 'bKash', brand: '#E2136E', number: null, app_url: null,
    store_urls: { android: 'https://play.google.com/store/apps/details?id=com.bKash.customerapp', ios: 'https://apps.apple.com/app/bkash/id1351183172' },
    instructions: ['Open the bKash app on your phone (or dial *247#) and choose "Send Money".', 'Send the exact amount to the association\u2019s bKash number.', 'Copy the Transaction ID from the confirmation SMS.', 'Come back here, paste the Transaction ID and confirm — the payment is verified manually.'],
  },
  {
    key: 'nagad', label: 'Nagad', brand: '#F6921E', number: null, app_url: null, store_urls: null,
    instructions: ['Open the Nagad app on your phone (or dial *167#) and choose "Send Money".', 'Send the exact amount to the association\u2019s Nagad number.', 'Copy the Transaction ID from the confirmation SMS.', 'Come back here, paste the Transaction ID and confirm — the payment is verified manually.'],
  },
  {
    key: 'rocket', label: 'Rocket', brand: '#8C3494', number: null, app_url: null, store_urls: null,
    instructions: ['Open the Rocket app on your phone (or dial *322#) and choose "Bank to Rocket" / "Send Money".', 'Send the exact amount to the association\u2019s Rocket number.', 'Copy the Transaction ID from the confirmation SMS.', 'Come back here, paste the Transaction ID and confirm — the payment is verified manually.'],
  },
];

const TXN_RE = /^[A-Za-z0-9_-]{6,64}$/;
const monthLabel = (key) => {
  const [y, m] = String(key).split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const taka = (n) => `৳${Number(n).toLocaleString('en-US')}`;
const statusLabel = (s) => (s === 'success' ? 'approved' : s);

// Coarse mobile detection: phones (and narrow windows) get the "Open ... App"
// affordance, wide/desktop screens get an explicit "pay on your phone"
// explainer instead.
const isMobileDevice = () => {
  if (typeof navigator === 'undefined') return false;
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')) return true;
  if (navigator.userAgentData?.mobile === true) return true;
  return typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)')?.matches === true;
};

// The receiving number is configured ONCE in backend/.env (bKash:
// BKASH_NUMBER) and served to the whole UI. When it is not configured yet,
// render a setup notice — NEVER a fake/placeholder number.
function showProviderNumber(provider) {
  if (provider?.number) {
    return (
      <>
        <span className="font-mono text-lg font-bold text-ink">{provider.number}</span>
        <CopyButton value={provider.number} />
      </>
    );
  }
  return (
    <span className="text-sm font-semibold text-red-600">
      Not configured yet — set <code>{provider?.key === 'bkash' ? 'BKASH_NUMBER' : `${String(provider?.key || '').toUpperCase()}_NUMBER`}</code> in backend/.env and restart the server.
    </span>
  );
}

function CopyButton({ value, label = 'Copy Number' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const ta = document.createElement('textarea');
        ta.value = value; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — the number is visible anyway */ }
  };
  return (
    <Button type="button" variant="outline" className="!px-3 !py-1.5 text-xs" onClick={copy}>
      {copied ? '✓ Copied!' : `📋 ${label}`}
    </Button>
  );
}

function ProviderChip({ provider, size = 'md' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-bold text-white ${size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'}`}
      style={{ backgroundColor: provider.brand }}
    >
      {provider.label}
    </span>
  );
}

function Receipt({ payment, onClose }) {
  return (
    <Card className="mt-4 border-emerald-300 bg-emerald-50/40">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-emerald-800">Payment successful (TEST)</h3>
        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={onClose}>✕</Button>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-ink-soft">Payment ID</dt><dd className="font-semibold">#{payment.payment_id}</dd></div>
        <div><dt className="text-ink-soft">Registration No</dt><dd className="font-semibold">{payment.reg_number}</dd></div>
        <div><dt className="text-ink-soft">Member</dt><dd className="font-semibold">{payment.first_name} {payment.last_name}</dd></div>
        <div><dt className="text-ink-soft">Type</dt><dd className="font-semibold capitalize">{payment.payment_type}</dd></div>
        <div className="sm:col-span-2">
          <dt className="text-ink-soft">{payment.payment_type === 'monthly' ? 'Covered months' : 'Purpose'}</dt>
          <dd className="font-semibold">
            {payment.payment_type === 'monthly'
              ? (payment.covered_months || []).map((m) => monthLabel(m.month)).join(', ')
              : PURPOSE_LABELS[payment.purpose] || payment.purpose}
          </dd>
        </div>
        <div><dt className="text-ink-soft">Amount</dt><dd className="font-semibold">{taka(payment.amount)}</dd></div>
        <div><dt className="text-ink-soft">Method</dt><dd className="font-semibold">TEST PAYMENT</dd></div>
        <div><dt className="text-ink-soft">Transaction ID</dt><dd className="break-all font-mono text-xs">{payment.transaction_id}</dd></div>
        <div><dt className="text-ink-soft">Status</dt><dd><Badge value={statusLabel(payment.status)} /></dd></div>
      </dl>
      <p className="mt-3 text-xs text-ink-soft">No real money was transferred.</p>
    </Card>
  );
}

function PendingReceipt({ payment, provider, onClose }) {
  return (
    <Card className="mt-4 border-sun bg-sun/10">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-ink">Payment submitted — awaiting verification</h3>
        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={onClose}>✕</Button>
      </div>
      <Alert kind="success">
        <b>Payment submitted successfully.</b> Your payment is waiting for verification. An admin or the authority
        will check your Transaction ID and approve it — it will show as <b>Pending</b> until then.
      </Alert>
      <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-ink-soft">Payment ID</dt><dd className="font-semibold">#{payment.payment_id}</dd></div>
        <div><dt className="text-ink-soft">Member</dt><dd className="font-semibold">{payment.first_name} {payment.last_name} ({payment.reg_number})</dd></div>
        <div><dt className="text-ink-soft">Type</dt><dd className="font-semibold capitalize">{payment.payment_type}</dd></div>
        <div>
          <dt className="text-ink-soft">{payment.payment_type === 'monthly' ? 'Billing month' : 'Purpose'}</dt>
          <dd className="font-semibold">
            {payment.payment_type === 'monthly'
              ? monthLabel(payment.billing_month)
              : PURPOSE_LABELS[payment.purpose] || payment.purpose}
          </dd>
        </div>
        <div><dt className="text-ink-soft">Amount</dt><dd className="font-semibold">{taka(payment.amount)}</dd></div>
        <div><dt className="text-ink-soft">Method</dt><dd className="font-semibold">{provider ? <ProviderChip provider={provider} size="sm" /> : METHOD_LABELS[payment.payment_method]}</dd></div>
        <div><dt className="text-ink-soft">Transaction ID</dt><dd className="break-all font-mono text-xs">{payment.transaction_id}</dd></div>
        <div><dt className="text-ink-soft">Status</dt><dd><Badge value="pending" /></dd></div>
      </dl>
      {payment.screenshot_path && (
        <p className="mt-2 text-xs text-ink-soft">
          Screenshot attached: <a className="text-moss underline" href={`/uploads/${payment.screenshot_path}`} target="_blank" rel="noreferrer">view</a>
        </p>
      )}
    </Card>
  );
}

export default function Payments() {
  const { user } = useAuth();
  const [regInput, setRegInput] = useState('');
  const [member, setMember] = useState(null);
  const [lookupError, setLookupError] = useState('');
  const [looking, setLooking] = useState(false);

  const [tab, setTab] = useState('monthly');
  const [status, setStatus] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [amount, setAmount] = useState(null);
  const [purpose, setPurpose] = useState('');
  const [occAmount, setOccAmount] = useState('');
  const [occDesc, setOccDesc] = useState('');
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');

  // Manual provider checkout
  const [providers, setProviders] = useState(FALLBACK_PROVIDERS);
  const [providerKey, setProviderKey] = useState('');
  const [checkout, setCheckout] = useState(null); // validated summary awaiting provider + txn
  const [senderNumber, setSenderNumber] = useState('');
  const [txnId, setTxnId] = useState('');
  const [screenshotFile, setScreenshotFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [payError, setPayError] = useState('');
  const [pendingReceipt, setPendingReceipt] = useState(null);

  // Dev-only TEST flow
  const [testMode, setTestMode] = useState(false);
  const [review, setReview] = useState(null);
  const [receipt, setReceipt] = useState(null);

  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState('');

  // Oldest-first allocation preview: shows how the chosen amount will settle
  // confirmed dues before any money moves (GET /api/contributions/preview).
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');

  const loadHistory = () => api.get('/api/payments/mine')
    .then((r) => { setHistory(r.data); setHistoryError(''); })
    .catch((e) => setHistoryError(e.message || 'Failed to load payments.'));

  // "My Payments" loads automatically for the logged-in user — the token-scoped
  // /mine endpoint resolves ownership server-side, no registration number needed.
  useEffect(() => {
    loadHistory();
    api.get('/api/payments/providers')
      .then((r) => { if (r.data?.providers?.length) setProviders(r.data.providers); })
      .catch(() => { /* keep fallback provider info */ });
  }, []);

  const provider = useMemo(() => providers.find((p) => p.key === providerKey) || null, [providers, providerKey]);

  const findMember = async (e) => {
    if (e) e.preventDefault();
    setLooking(true); setLookupError(''); setMember(null); setReceipt(null);
    setCheckout(null); setPendingReceipt(null); setSelectedMonth(null); setAmount(null); setStatus(null);
    try {
      const res = await api.get(`/api/payments/lookup/${encodeURIComponent(regInput.trim())}`);
      setMember(res.data.member);
      const [st, ev] = await Promise.all([
        api.get(`/api/payments/monthly-status?user_id=${res.data.member.user_id}`),
        api.get('/api/events').catch(() => ({ data: { events: [] } })),
      ]);
      setStatus(st.data);
      setEvents(ev.data.events || []);
      loadHistory();
    } catch (err) { setLookupError(err.message); }
    finally { setLooking(false); }
  };

  const dueMonths = useMemo(() => (status ? status.months.filter((m) => !m.paid && !m.pending) : []), [status]);

  // Live allocation preview while the member picks an amount. Silent on failure
  // (e.g. a non-staff user peeking at someone else) — the payment itself is
  // validated server-side regardless.
  useEffect(() => {
    let alive = true;
    setPreview(null); setPreviewError('');
    if (tab !== 'monthly' || !member || !amount) return () => { alive = false; };
    const qs = new URLSearchParams({ amount: String(amount) });
    if (user && Number(member.user_id) !== Number(user.user_id)) qs.set('user_id', String(member.user_id));
    api.get(`/api/contributions/preview?${qs}`)
      .then((r) => { if (alive) setPreview(r.data); })
      .catch((e) => { if (alive) setPreviewError(e.message || ''); });
    return () => { alive = false; };
  }, [tab, member, amount, user]);

  const refreshStatus = async () => {
    if (!member) return;
    const st = await api.get(`/api/payments/monthly-status?user_id=${member.user_id}`);
    setStatus(st.data);
  };

  const openCheckout = () => {
    setPayError('');
    setProviderKey('');
    setTxnId('');
    setScreenshotFile(null);
    setSenderNumber(member.phone || '');
    if (tab === 'monthly') {
      if (!selectedMonth) return setPayError('Select the billing month you are paying for.');
      if (!amount) return setPayError('Choose a monthly contribution amount.');
      setCheckout({ type: 'monthly', billingMonth: selectedMonth, perMonth: amount, total: amount });
    } else {
      if (!purpose) return setPayError('Select a purpose.');
      const amt = Number(occAmount);
      if (!Number.isFinite(amt) || amt <= 0) return setPayError('Enter a valid positive amount.');
      if (purpose === 'event_contribution' && !eventId) return setPayError('Select an event.');
      setCheckout({ type: 'occasional', purpose, amount: amt, eventId: purpose === 'event_contribution' ? eventId : null, description: occDesc.trim() });
    }
  };

  const openProviderApp = () => {
    // Only OFFICIAL links are ever used: a verified gateway deep link
    // (provider.app_url, none exists today) or the provider's official
    // app-store pages (store_urls). Opening the app is a pure client-side
    // navigation — it can NEVER confirm or mark a payment; verification
    // stays with the admin via the required Transaction ID.
    const target =
      provider?.app_url ||
      (isMobileDevice() ? (provider?.store_urls?.ios || provider?.store_urls?.android || null) : (provider?.store_urls?.android || provider?.store_urls?.ios || null));
    if (!target) return;
    window.open(target, '_blank', 'noopener,noreferrer');
  };

  const confirmManualPay = async () => {
    if (!provider) return setPayError('Choose a payment provider (bKash / Nagad / Rocket).');
    const txn = txnId.trim();
    if (!TXN_RE.test(txn)) return setPayError('Enter the Transaction ID from your payment confirmation (6–64 letters, numbers, - or _).');
    if (screenshotFile && screenshotFile.size > 3 * 1024 * 1024) return setPayError('Screenshot must be 3 MB or smaller.');

    setBusy(true); setPayError('');
    try {
      const fd = new FormData();
      fd.append('registration_number', member.registration_number);
      fd.append('payment_type', checkout.type);
      fd.append('payment_method', provider.key);
      fd.append('transaction_id', txn);
      if (senderNumber.trim()) fd.append('sender_number', senderNumber.trim());
      if (checkout.type === 'monthly') {
        fd.append('amount', String(checkout.perMonth));
        fd.append('billing_month', checkout.billingMonth);
      } else {
        fd.append('purpose', checkout.purpose);
        fd.append('amount', String(checkout.amount));
        if (checkout.eventId) fd.append('event_id', String(checkout.eventId));
        if (checkout.description) fd.append('description', checkout.description);
      }
      if (screenshotFile) fd.append('image', screenshotFile);

      const res = await api.postForm('/api/payments/manual', fd);
      setPendingReceipt({ payment: res.data.payment, provider });
      setCheckout(null);
      setProviderKey('');
      setTxnId('');
      setScreenshotFile(null);
      setSelectedMonth(null);
      await refreshStatus().catch(() => {});
      loadHistory();
    } catch (err) { setPayError(err.message); }
    finally { setBusy(false); }
  };

  // ----- Dev-only TEST payment (kept for local demos; smoke-tested server-side) -----
  const openTestReview = () => {
    setPayError('');
    setSenderNumber(member.phone || '');
    if (tab === 'monthly') {
      if (!selectedMonth) return setPayError('Select the billing month you are paying for.');
      if (!amount) return setPayError('Choose a monthly contribution amount.');
      setReview({ type: 'monthly', months: [selectedMonth], perMonth: amount, total: amount });
    } else {
      if (!purpose) return setPayError('Select a purpose.');
      const amt = Number(occAmount);
      if (!Number.isFinite(amt) || amt <= 0) return setPayError('Enter a valid positive amount.');
      setReview({ type: 'occasional', purpose, amount: amt, eventId: purpose === 'event_contribution' ? eventId : null, description: occDesc.trim() });
    }
  };

  const confirmTestPay = async () => {
    setBusy(true); setPayError('');
    try {
      const body = review.type === 'monthly'
        ? { registration_number: member.registration_number, payment_type: 'monthly', amount: review.perMonth, months: review.months, sender_number: senderNumber }
        : { registration_number: member.registration_number, payment_type: 'occasional', purpose: review.purpose, amount: review.amount, event_id: review.eventId || undefined, description: review.description, sender_number: senderNumber };
      const res = await api.post('/api/payments', body);
      setReceipt(res.data.payment);
      setReview(null);
      setSelectedMonth(null);
      await refreshStatus().catch(() => {});
      loadHistory();
    } catch (err) { setPayError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Payments" subtitle="Monthly contributions and occasional payments via bKash, Nagad, or Rocket — every payment is verified before it counts." />

      {/* Step 1: find member by registration number */}
      <Card>
        <form onSubmit={findMember} className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Input label="Registration Number" placeholder="e.g. BSA-2026-00125" value={regInput} onChange={(e) => setRegInput(e.target.value)} required />
          </div>
          <Button type="submit" disabled={looking}>{looking ? 'Searching…' : 'Continue'}</Button>
        </form>
        {lookupError && <Alert kind="error">{lookupError}</Alert>}

        {member && (
          <div className="mt-4 rounded-lg bg-mint p-3 text-sm">
            <div className="font-bold text-ink">{member.first_name} {member.last_name}</div>
            <div className="mt-0.5 text-ink-soft">
              Reg No: <b>{member.registration_number}</b> · SSC Batch: <b>{member.ssc_batch ?? '—'}</b> · Phone: <b>{member.phone || '—'}</b>
            </div>
          </div>
        )}
      </Card>

      {member && (
        <Card className="mt-4">
          <div className="mb-4 flex gap-2">
            <Button variant={tab === 'monthly' ? 'primary' : 'outline'} onClick={() => { setTab('monthly'); setPayError(''); }}>Monthly Payment</Button>
            <Button variant={tab === 'occasional' ? 'primary' : 'outline'} onClick={() => { setTab('occasional'); setPayError(''); }}>Occasional Payment</Button>
          </div>

          {tab === 'monthly' && status && (
            <>
              <p className="text-sm text-ink-soft">
                {status.due_months === 0
                  ? 'All months are paid or awaiting verification. Thank you!'
                  : <><b>{status.due_months}</b> month(s) due for {status.year}</>}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {status.months.map((m) => (
                  <button
                    key={m.month}
                    type="button"
                    disabled={m.paid || m.pending}
                    onClick={() => setSelectedMonth((prev) => (prev === m.month ? null : m.month))}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                      m.paid
                        ? 'cursor-not-allowed border-emerald-200 bg-emerald-50 text-emerald-700'
                        : m.pending
                          ? 'cursor-not-allowed border-amber-300 bg-amber-50 text-amber-700'
                          : selectedMonth === m.month
                            ? 'border-forest bg-forest/10 font-semibold text-moss'
                            : 'border-line bg-white hover:border-forest/50'
                    }`}
                  >
                    <div className="font-medium">{monthLabel(m.month)}</div>
                    <div className="text-xs">
                      {m.paid
                        ? `✓ PAID ${m.amount ? `(${taka(m.amount)}/mo)` : ''}`
                        : m.pending
                          ? '⏳ PENDING VERIFICATION'
                          : selectedMonth === m.month ? '✓ selected' : 'DUE'}
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-4">
                <span className="mb-1 block text-sm font-medium text-ink">Monthly contribution (per month, max ৳100)</span>
                <div className="flex flex-wrap gap-2">
                  {MONTHLY_AMOUNTS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setAmount(a)}
                      className={`rounded-lg border px-4 py-2 text-sm font-bold transition ${
                        amount === a ? 'border-forest bg-forest text-white' : 'border-line bg-white text-ink hover:border-forest/50'
                      }`}
                    >
                      ৳{a}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 rounded-lg bg-mint p-3 text-sm">
                <div className="flex justify-between"><span>Billing month</span><b>{selectedMonth ? monthLabel(selectedMonth) : '—'}</b></div>
                <div className="flex justify-between"><span>Monthly contribution</span><b>{amount ? taka(amount) : '—'}</b></div>
                <div className="mt-1 flex justify-between border-t border-line pt-1 text-base"><span>Total</span><b className="text-moss">{taka(amount || 0)}</b></div>
              </div>

              {/* Oldest-first allocation preview: dues settle before any extra. */}
              {preview && (
                <div className="mt-3 rounded-lg border border-forest/30 bg-forest/5 p-3 text-sm">
                  <div className="font-semibold text-ink">How this payment will be allocated</div>
                  {preview.settles?.length ? (
                    <ul className="mt-1.5 space-y-1">
                      {preview.settles.map((s) => (
                        <li key={s.month} className="flex justify-between gap-3">
                          <span className="text-ink-soft"> settles {s.label} (of {taka(s.from_remaining)} due)</span>
                          <b className="text-ink">{taka(s.pays)}</b>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-ink-soft">No outstanding dues — the full amount becomes Extra Contribution.</p>
                  )}
                  <div className="mt-2 space-y-1 border-t border-forest/20 pt-2">
                    <div className="flex justify-between"><span className="text-ink-soft">Due settled</span><b>{taka(preview.settles_amount)}</b></div>
                    <div className="flex justify-between"><span className="text-ink-soft">Extra Contribution (after all dues)</span><b className="text-moss">{taka(preview.extra)}</b></div>
                    <div className="flex justify-between"><span className="text-ink-soft">Remaining due after payment</span><b>{taka(preview.remaining_due_after)}</b></div>
                  </div>
                  <p className="mt-2 text-xs text-ink-soft">
                    Confirmed dues are settled oldest-first using each month&rsquo;s historical rate. Pending payments never settle a month.
                  </p>
                </div>
              )}
              {previewError && tab === 'monthly' && amount && (
                <p className="mt-2 text-xs text-ink-soft">Allocation preview unavailable — the server still validates every payment.</p>
              )}
            </>
          )}

          {tab === 'occasional' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                <option value="">— Select Purpose —</option>
                {Object.entries(PURPOSE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              {purpose === 'event_contribution' && (
                <Select label="Event" value={eventId} onChange={(e) => setEventId(e.target.value)}>
                  <option value="">— Select Event —</option>
                  {events.map((ev) => <option key={ev.event_id} value={ev.event_id}>{ev.title}</option>)}
                  {events.length === 0 && <option value="" disabled>No published events yet</option>}
                </Select>
              )}
              <Input label="Amount (৳)" type="number" min="1" step="1" placeholder="e.g. 500" value={occAmount} onChange={(e) => setOccAmount(e.target.value)} />
              <div className="sm:col-span-2"><Textarea label="Description (optional)" value={occDesc} onChange={(e) => setOccDesc(e.target.value)} /></div>
            </div>
          )}

          {payError && !checkout && !review && <Alert kind="error">{payError}</Alert>}
          {tab === 'monthly' && status && (
            <Button className="mt-4" onClick={openCheckout} disabled={status.due_months === 0}>Continue to Payment</Button>
          )}
          {tab === 'occasional' && (
            <Button className="mt-4" onClick={openCheckout}>Continue to Payment</Button>
          )}

          {SHOW_TEST_PAYMENT_UI && (
          <div className="mt-4 border-t border-line pt-3">
            <button type="button" className="text-xs text-ink-soft underline" onClick={() => { setTestMode((v) => !v); setPayError(''); }}>
              {testMode ? 'Hide TEST payment (dev only)' : 'Developer: simulate a TEST payment'}
            </button>
            {testMode && (
              <div className="mt-2 rounded-lg border border-sun/60 bg-sun/20 p-3 text-sm">
                <b>TEST MODE</b> — no real money is transferred and no verification is needed (local demos only).
                <div className="mt-2">
                  <Button variant="outline" onClick={openTestReview}>Review TEST payment</Button>
                </div>
              </div>
            )}
          </div>
          )}
        </Card>
      )}

      {/* Step 2: choose provider (bKash / Nagad / Rocket) */}
      {checkout && !review && (
        <Card className="mt-4">
          <h3 className="font-bold text-ink">Choose payment method</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {providers.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => { setProviderKey(p.key); setPayError(''); }}
                className={`rounded-xl border-2 p-3 text-left transition ${
                  providerKey === p.key ? 'border-forest bg-forest/5 shadow-sm' : 'border-line bg-white hover:border-forest/40'
                }`}
              >
                <ProviderChip provider={p} />
                <div className="mt-2 text-xs text-ink-soft">Send Money to</div>
                {p.number ? (
                  <div className="font-mono text-sm font-semibold text-ink">{p.number}</div>
                ) : (
                  <div className="text-xs font-semibold text-red-500">number not configured</div>
                )}
              </button>
            ))}
          </div>

          {provider && (
            <div className="mt-4 rounded-xl border border-line bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <ProviderChip provider={provider} />
                <span className="text-xs text-ink-soft">Manual payment — verified by an admin</span>
              </div>

              <div className="mt-3 rounded-lg bg-mint p-3">
                <div className="text-xs font-semibold uppercase text-ink-soft">Send money to ({provider.label})</div>
                <div className="mt-1 flex flex-wrap items-center gap-3">{showProviderNumber(provider)}</div>
              </div>

              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink-soft">
                {provider.instructions.map((line, i) => <li key={i}>{line}</li>)}
              </ol>

              {/* App affordance (phones) vs explainer (desktop) — opening the app
                  never confirms anything: the payment only becomes VERIFIED after
                  an admin checks the required Transaction ID. */}
              <div className="mt-3 rounded-lg border border-line bg-mint p-3 text-sm">
                {(provider.app_url || provider.store_urls) && isMobileDevice() && (
                  <div className="mb-2">
                    <Button type="button" onClick={openProviderApp}>Open {provider.label} App</Button>
                  </div>
                )}
                {isMobileDevice() ? (
                  <div className="text-ink-soft">
                    <b>Can&apos;t open the {provider.label} app?</b> Open {provider.label} manually on this phone, send the exact amount to the number below, then come back and enter the Transaction ID.
                  </div>
                ) : (
                  <div className="text-ink-soft">
                    <b>Using a computer or can&apos;t open the {provider.label} app?</b> Open {provider.label} on your phone, send the exact amount to the number below, then come back here and enter the Transaction ID.
                  </div>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-2">{showProviderNumber(provider)}</div>
                <div className="mt-1 text-xs text-ink-soft">The Transaction ID is required — opening the app or sending money alone never confirms a payment.</div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Input label="Sender number (optional)" placeholder="Your bKash / Nagad / Rocket number" value={senderNumber} onChange={(e) => setSenderNumber(e.target.value)} />
                <Input
                  label="Transaction ID (required)"
                  placeholder="e.g. 9F2K1L8M3N"
                  value={txnId}
                  onChange={(e) => setTxnId(e.target.value)}
                />
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium text-ink">Payment screenshot (optional)</label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(e) => setScreenshotFile(e.target.files?.[0] || null)}
                  className="block w-full rounded-lg border border-line bg-white p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-forest file:px-3 file:py-1.5 file:text-white"
                />
                <p className="mt-1 text-xs text-ink-soft">JPG, PNG, WEBP or GIF — max 3 MB.{screenshotFile ? ` Selected: ${screenshotFile.name}` : ''}</p>
              </div>

              <div className="mt-4 rounded-lg bg-mint p-3 text-sm">
                <div className="flex justify-between"><span>Member</span><b>{member.first_name} {member.last_name} ({member.registration_number})</b></div>
                <div className="flex justify-between"><span>Type</span><b className="capitalize">{checkout.type}</b></div>
                <div className="flex justify-between">
                  <span>{checkout.type === 'monthly' ? 'Billing month' : 'Purpose'}</span>
                  <b>{checkout.type === 'monthly' ? monthLabel(checkout.billingMonth) : PURPOSE_LABELS[checkout.purpose]}</b>
                </div>
                <div className="mt-1 flex justify-between border-t border-line pt-1 text-base"><span>Total</span><b className="text-moss">{taka(checkout.total ?? checkout.amount)}</b></div>
              </div>

              {payError && <Alert kind="error">{payError}</Alert>}

              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={confirmManualPay} disabled={busy}>{busy ? 'Submitting…' : `Confirm Pay with ${provider.label}`}</Button>
                <Button variant="ghost" onClick={() => { setCheckout(null); setPayError(''); }} disabled={busy}>Cancel</Button>
              </div>
              <p className="mt-2 text-xs text-ink-soft">
                Your payment stays <b>Pending</b> until an admin or the authority verifies the Transaction ID. Only then does it count as paid.
              </p>
            </div>
          )}

          {!provider && payError && <Alert kind="error">{payError}</Alert>}
        </Card>
      )}

      {/* Dev-only TEST review card */}
      {review && (
        <Card className="mt-4">
          <h3 className="font-bold text-ink">Review TEST payment</h3>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-ink-soft">Member</dt><dd className="font-semibold">{member.first_name} {member.last_name} ({member.registration_number})</dd></div>
            <div><dt className="text-ink-soft">Type</dt><dd className="font-semibold capitalize">{review.type}</dd></div>
            {review.type === 'monthly'
              ? <div className="col-span-2"><dt className="text-ink-soft">Billing month</dt><dd className="font-semibold">{review.months.map(monthLabel).join(', ')}</dd></div>
              : <div className="col-span-2"><dt className="text-ink-soft">Purpose</dt><dd className="font-semibold">{PURPOSE_LABELS[review.purpose]}{review.eventId ? ` — ${events.find((e) => String(e.event_id) === String(review.eventId))?.title || ''}` : ''}</dd></div>}
            <div><dt className="text-ink-soft">Total</dt><dd className="font-semibold text-moss">{taka(review.total ?? review.amount)}</dd></div>
          </dl>
          <div className="mt-4 rounded-lg border border-sun/60 bg-sun/20 p-3 text-sm">
            <b>TEST PAYMENT MODE</b> — no real money will be transferred.
          </div>
          <div className="mt-3 max-w-xs">
            <Input label="Sender number" placeholder="" value={senderNumber} onChange={(e) => setSenderNumber(e.target.value)} />
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={confirmTestPay} disabled={busy}>{busy ? 'Processing…' : 'Confirm Test Payment'}</Button>
            <Button variant="ghost" onClick={() => setReview(null)} disabled={busy}>Cancel</Button>
          </div>
        </Card>
      )}

      {receipt && <Receipt payment={receipt} onClose={() => setReceipt(null)} />}
      {pendingReceipt && <PendingReceipt payment={pendingReceipt.payment} provider={pendingReceipt.provider} onClose={() => setPendingReceipt(null)} />}

      {/* My payments */}
      <h2 className="mt-8 text-lg font-bold text-ink">My Payments</h2>
      {history && (
        <div className="mt-2 grid grid-cols-3 gap-3">
          <Card className="text-center"><div className="text-xl font-black text-moss">{taka(history.totals.monthly_total)}</div><div className="text-xs font-semibold uppercase text-ink-soft">Monthly (approved)</div></Card>
          <Card className="text-center"><div className="text-xl font-black text-moss">{taka(history.totals.occasional_total)}</div><div className="text-xs font-semibold uppercase text-ink-soft">Occasional (approved)</div></Card>
          <Card className="text-center"><div className="text-xl font-black text-moss">{taka(Number(history.totals.monthly_total) + Number(history.totals.occasional_total))}</div><div className="text-xs font-semibold uppercase text-ink-soft">Total</div></Card>
        </div>
      )}
      <div className="mt-3">
        {!history && !historyError && <Spinner />}
        {historyError && !history && <Alert kind="error">{historyError}</Alert>}
        {history && history.payments.length === 0 && <EmptyState title="No payments yet." hint="Use the form above to make your first payment." />}
        {history && history.payments.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-line bg-white">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b bg-mint text-left text-xs uppercase text-ink-soft">
                  <th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Billing Month / Purpose</th>
                  <th className="px-3 py-2">Amount</th><th className="px-3 py-2">Method</th><th className="px-3 py-2">Transaction</th><th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.payments.map((p) => (
                  <tr key={p.payment_id} className="border-b last:border-0">
                    <td className="px-3 py-2 text-ink-soft">{fmtDate(p.payment_date)}</td>
                    <td className="px-3 py-2 capitalize">{p.payment_type}</td>
                    <td className="px-3 py-2">
                      {p.payment_type === 'monthly'
                        ? ((p.covered_months || []).length
                          ? (p.covered_months || []).map((m) => monthLabel(m.month)).join(', ')
                          : (p.billing_month ? monthLabel(p.billing_month) : '—'))
                        : PURPOSE_LABELS[p.purpose] || p.purpose}
                    </td>
                    <td className="px-3 py-2 font-semibold">{taka(p.amount)}</td>
                    <td className="px-3 py-2 text-xs">{METHOD_LABELS[p.payment_method] || p.payment_method}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {p.transaction_id}
                      {p.screenshot_path && <a className="ml-1 text-moss underline" href={`/uploads/${p.screenshot_path}`} target="_blank" rel="noreferrer" title="View screenshot">📷</a>}
                    </td>
                    <td className="px-3 py-2">
                      <Badge value={statusLabel(p.status)} />
                      {(p.reviewed_at || p.review_note) && (
                        <div className="mt-1 text-[10px] leading-tight text-ink-soft">
                          {p.reviewed_at ? fmtDateTime(p.reviewed_at) : ''}{p.review_note ? ` — ${p.review_note}` : ''}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
