import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { Card, Button, Input, Select, Textarea, Spinner, Alert, PageHeader, Badge, EmptyState } from '../../components/ui.jsx';

const PURPOSE_LABELS = {
  event_contribution: 'Event Contribution',
  donation: 'Donation',
  help_fund: 'Help Fund',
  emergency_fund: 'Emergency Fund',
  other: 'Other',
};
const METHOD_LABELS = { test: 'TEST PAYMENT', bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket' };
const monthLabel = (key) => {
  const [y, m] = String(key).split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const taka = (n) => `৳${Number(n).toLocaleString('en-US')}`;

function MemberSummaryModal({ userId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.get(`/api/payments/summary/${userId}`)
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [userId]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="mt-10 w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
        <Card>
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-bold text-ink">Payment summary</h2>
            <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={onClose}>✕ Close</Button>
          </div>

          {error && <Alert kind="error">{error}</Alert>}
          {!data && !error && <Spinner />}

          {data && (
            <>
              <div className="mt-3 rounded-lg bg-mint p-3 text-sm">
                <div className="font-bold text-ink">{data.member.first_name} {data.member.last_name}</div>
                <div className="text-ink-soft">
                  Reg No: <b>{data.member.registration_number || '—'}</b> · Batch: <b>{data.member.ssc_batch ?? '—'}</b> · Phone: <b>{data.member.phone || '—'}</b>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded-lg bg-mint p-2"><div className="font-black text-moss">{taka(data.monthly_total)}</div><div className="text-xs text-ink-soft">Monthly</div></div>
                <div className="rounded-lg bg-mint p-2"><div className="font-black text-moss">{taka(data.occasional_total)}</div><div className="text-xs text-ink-soft">Occasional</div></div>
                <div className="rounded-lg bg-mint p-2"><div className="font-black text-moss">{taka(data.total_contributions)}</div><div className="text-xs text-ink-soft">Total</div></div>
              </div>

              <h3 className="mt-4 text-sm font-bold text-ink">Monthly status {data.monthly.year}</h3>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {data.monthly.months.map((m) => (
                  <div key={m.month} className={`rounded-lg border px-2 py-1.5 text-xs ${
                    m.paid ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : m.pending ? 'border-amber-300 bg-amber-50 text-amber-700'
                        : 'border-red-200 bg-red-50 text-red-600'
                  }`}>
                    {monthLabel(m.month)} {m.paid ? '✓' : m.pending ? '⏳' : '✗'}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-sm text-ink-soft">
                Current due: <b>{data.monthly.due_months}</b> month(s)
                {data.monthly.months.some((m) => m.pending) && <span className="ml-1 text-amber-700">(⏳ = awaiting verification)</span>}
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function ReviewModal({ payment, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const decide = async (status) => {
    setBusy(true); setError('');
    try {
      await api.patch(`/api/payments/${payment.payment_id}/review`, { status, note: note.trim() || undefined });
      onDone();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="mt-10 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <Card>
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-bold text-ink">Verify payment #{payment.payment_id}</h2>
            <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={onClose}>✕ Close</Button>
          </div>

          {error && <Alert kind="error">{error}</Alert>}

          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-ink-soft">Member</dt><dd className="font-semibold">{payment.first_name} {payment.last_name}</dd></div>
            <div><dt className="text-ink-soft">Reg No</dt><dd className="font-semibold">{payment.reg_number || '—'}</dd></div>
            <div><dt className="text-ink-soft">Type</dt><dd className="font-semibold capitalize">{payment.payment_type}</dd></div>
            <div>
              <dt className="text-ink-soft">{payment.payment_type === 'monthly' ? 'Billing month' : 'Purpose'}</dt>
              <dd className="font-semibold">
                {payment.payment_type === 'monthly'
                  ? (payment.billing_month ? monthLabel(payment.billing_month) : '—')
                  : PURPOSE_LABELS[payment.purpose] || payment.purpose}
              </dd>
            </div>
            <div><dt className="text-ink-soft">Amount</dt><dd className="font-semibold text-moss">{taka(payment.amount)}</dd></div>
            <div><dt className="text-ink-soft">Method</dt><dd className="font-semibold">{METHOD_LABELS[payment.payment_method] || payment.payment_method}</dd></div>
            <div className="col-span-2">
              <dt className="text-ink-soft">Transaction ID</dt>
              <dd className="break-all font-mono text-sm font-semibold">{payment.transaction_id}</dd>
            </div>
            <div><dt className="text-ink-soft">Sender number</dt><dd className="font-semibold">{payment.sender_number || '—'}</dd></div>
            <div><dt className="text-ink-soft">Submitted</dt><dd className="font-semibold">{fmtDateTime(payment.payment_date)}</dd></div>
            {payment.screenshot_path && (
              <div className="col-span-2">
                <dt className="text-ink-soft">Screenshot</dt>
                <dd><a className="text-moss underline" href={`/uploads/${payment.screenshot_path}`} target="_blank" rel="noreferrer">Open payment screenshot ↗</a></dd>
              </div>
            )}
          </dl>

          <div className="mt-3">
            <Textarea label="Review note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. TrxID verified against bKash statement" />
          </div>

          <p className="mt-2 text-xs text-ink-soft">
            Approving marks the payment as paid{payment.payment_type === 'monthly' ? ` and records ${payment.billing_month ? monthLabel(payment.billing_month) : 'the billing month'} as paid` : ''}. Rejecting keeps it out of all totals.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => decide('success')} disabled={busy}>{busy ? 'Saving…' : '✓ Approve payment'}</Button>
            <Button variant="outline" className="!border-red-300 !text-red-600" onClick={() => decide('rejected')} disabled={busy}>✗ Reject</Button>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function AdminPayments() {
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ reg: '', name: '', batch: '', phone: '', payment_type: '', purpose: '', status: 'success', from: '', to: '', limit: 25, offset: 0 });
  const [summaryId, setSummaryId] = useState(null);
  const [reviewPayment, setReviewPayment] = useState(null);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v !== '' && v != null) params.set(k, v); });
    api.get(`/api/payments?${params.toString()}`)
      .then((r) => { setRows(r.data.payments); setTotal(r.data.total); })
      .catch((e) => setError(e.message));
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value, offset: 0 }));

  return (
    <div>
      <PageHeader title="Payment Management" subtitle="Verify manual payments (bKash / Nagad / Rocket), search, filter, and inspect monthly status." />

      {error && <Alert kind="error">{error}</Alert>}

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Input label="Registration No" value={filters.reg} onChange={set('reg')} placeholder="e.g. BSA-" />
          <Input label="Name" value={filters.name} onChange={set('name')} />
          <Input label="SSC Batch" type="number" value={filters.batch} onChange={set('batch')} />
          <Input label="Phone / Sender" value={filters.phone} onChange={set('phone')} />
          <Select label="Type" value={filters.payment_type} onChange={set('payment_type')}>
            <option value="">— Any —</option>
            <option value="monthly">Monthly</option>
            <option value="occasional">Occasional</option>
          </Select>
          <Select label="Purpose" value={filters.purpose} onChange={set('purpose')}>
            <option value="">— Any —</option>
            {Object.entries(PURPOSE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Select label="Status" value={filters.status} onChange={set('status')}>
            <option value="">— Any —</option>
            <option value="pending">Pending (needs review)</option>
            <option value="success">Success / Approved</option>
            <option value="rejected">Rejected</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
            <option value="refunded">Refunded</option>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input label="From" type="date" value={filters.from} onChange={set('from')} />
            <Input label="To" type="date" value={filters.to} onChange={set('to')} />
          </div>
        </div>
      </Card>

      <p className="mb-2 text-sm text-ink-soft">
        {total} payment(s)
        <button type="button" className="ml-2 text-xs text-moss underline" onClick={() => setFilters((f) => ({ ...f, status: 'pending', offset: 0 }))}>
          Show pending only
        </button>
      </p>

      {!rows && !error && <Spinner />}
      {rows && rows.length === 0 && <EmptyState title="No payments matched." hint="Adjust the filters above." />}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b bg-mint text-left text-xs uppercase text-ink-soft">
                <th className="px-3 py-2">Reg No</th><th className="px-3 py-2">Member</th><th className="px-3 py-2">Batch</th>
                <th className="px-3 py-2">Type</th><th className="px-3 py-2">Billing Month / Purpose</th><th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Sender</th><th className="px-3 py-2">Method</th><th className="px-3 py-2">Transaction</th>
                <th className="px-3 py-2">Date</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.payment_id} className={`border-b last:border-0 ${p.status === 'pending' ? 'bg-amber-50/40' : ''}`}>
                  <td className="px-3 py-2 font-mono text-xs">{p.reg_number || '—'}</td>
                  <td className="px-3 py-2">{p.first_name} {p.last_name}</td>
                  <td className="px-3 py-2 text-ink-soft">{p.ssc_batch ?? '—'}</td>
                  <td className="px-3 py-2 capitalize">{p.payment_type}</td>
                  <td className="px-3 py-2">
                    {p.payment_type === 'monthly'
                      ? ((p.covered_months || []).length
                        ? (p.covered_months || []).map((m) => monthLabel(m.month)).join(', ')
                        : (p.billing_month ? monthLabel(p.billing_month) : '—'))
                      : PURPOSE_LABELS[p.purpose] || p.purpose}
                  </td>
                  <td className="px-3 py-2 font-semibold">{taka(p.amount)}</td>
                  <td className="px-3 py-2 text-xs">{p.sender_number || '—'}</td>
                  <td className="px-3 py-2 text-xs">{METHOD_LABELS[p.payment_method] || p.payment_method}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {p.transaction_id}
                    {p.screenshot_path && <a className="ml-1 text-moss underline" href={`/uploads/${p.screenshot_path}`} target="_blank" rel="noreferrer" title="View screenshot">📷</a>}
                  </td>
                  <td className="px-3 py-2 text-ink-soft">{fmtDate(p.payment_date)}</td>
                  <td className="px-3 py-2">
                    <Badge value={p.status === 'success' ? 'approved' : p.status} />
                    {(p.reviewed_at || p.review_note) && (
                      <div className="mt-1 text-[10px] leading-tight text-ink-soft">
                        {p.reviewed_at ? fmtDateTime(p.reviewed_at) : ''}{p.reviewer_first_name ? ` by ${p.reviewer_first_name}` : ''}{p.review_note ? ` — ${p.review_note}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {p.status === 'pending' && (
                        <Button variant="outline" className="!px-2 !py-1 text-xs !border-forest !text-moss" onClick={() => setReviewPayment(p)}>Review</Button>
                      )}
                      <Button variant="outline" className="!px-2 !py-1 text-xs" onClick={() => setSummaryId(p.user_id)}>Summary</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > filters.limit && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <Button variant="ghost" disabled={filters.offset === 0} onClick={() => setFilters((f) => ({ ...f, offset: Math.max(0, f.offset - f.limit) }))}>← Previous</Button>
          <span className="text-ink-soft">Showing {filters.offset + 1}–{Math.min(filters.offset + filters.limit, total)} of {total}</span>
          <Button variant="ghost" disabled={filters.offset + filters.limit >= total} onClick={() => setFilters((f) => ({ ...f, offset: f.offset + f.limit }))}>Next →</Button>
        </div>
      )}

      {summaryId !== null && <MemberSummaryModal userId={summaryId} onClose={() => setSummaryId(null)} />}
      {reviewPayment && (
        <ReviewModal
          payment={reviewPayment}
          onClose={() => setReviewPayment(null)}
          onDone={() => { setReviewPayment(null); load(); }}
        />
      )}
    </div>
  );
}
