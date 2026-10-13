import { useEffect, useState } from 'react';
import { ChartBox, PALETTE, DONUT_COLORS, STATUS_COLORS } from '../../components/charts.jsx';
import { formatBDT, formatNumber } from '../../utils/format.js';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Card, Input, Button, Alert } from '../../components/ui.jsx';
import { useAnalytics } from './useAnalytics.js';
import { KpiCard, Note, SectionLoading, SectionError, RefreshError, UpdatingBar } from './bits.jsx';

const cap = (s) => String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Admin/AUTHORITY member-wise due report — same authoritative service as the
 * Profile, Payments page and the KPI cards (getMembersDueReport), so the table
 * can never disagree with the totals above it. Ordinary members never see it:
 * the endpoint itself returns 403 and the UI hides it too.
 */
function MemberDuesReport({ refreshKey }) {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ limit: '200' });
      if (applied) qs.set('search', applied);
      const res = await api.get(`/api/contributions/members?${qs}`);
      setData(res.data);
    } catch (e) { setError(e.message || 'Request failed'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [applied, refreshKey]);

  const members = data?.members || [];
  const totals = members.reduce((acc, m) => ({
    due: acc.due + Number(m.total_due || 0),
    extra: acc.extra + Number(m.total_extra || 0),
    paid: acc.paid + Number(m.approved_monthly_total || 0),
    unpriced: acc.unpriced + (m.rate_not_set_months?.length || 0),
  }), { due: 0, extra: 0, paid: 0, unpriced: 0 });

  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-bold text-ink">Member-wise Due Report</h3>
          <p className="text-xs text-ink-soft">
            Per-member rate, allocation and outstanding dues — ADMIN/AUTHORITY only, computed by the same service as every figure above.
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); setApplied(search.trim()); }}
        >
          <Input placeholder="Search name / reg no" value={search} onChange={(e) => setSearch(e.target.value)} className="!w-48" />
          <Button type="submit" variant="outline">Search</Button>
        </form>
      </div>

      {error && <div className="mt-3"><Alert kind="error">{error}</Alert></div>}

      {loading && !data ? <SectionLoading label="Loading member dues…" /> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-mint text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-3 py-2">Member</th>
                <th className="px-3 py-2">Reg No</th>
                <th className="px-3 py-2">Rate</th>
                <th className="px-3 py-2">Start</th>
                <th className="px-3 py-2 text-right">Due months</th>
                <th className="px-3 py-2 text-right">Outstanding due</th>
                <th className="px-3 py-2 text-right">Extra</th>
                <th className="px-3 py-2 text-right">Paid (monthly)</th>
                <th className="px-3 py-2 text-right">Unpriced</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {members.map((m) => (
                <tr key={m.user_id} className="hover:bg-mint/60">
                  <td className="px-3 py-2 font-medium text-ink">{m.name}</td>
                  <td className="px-3 py-2 text-ink-soft">{m.registration_number || '—'}</td>
                  <td className="px-3 py-2">{m.current_rate != null ? formatBDT(m.current_rate) : <span className="text-ink-soft">Not set</span>}</td>
                  <td className="px-3 py-2 text-ink-soft">{m.start_month || (m.start_unknown ? 'Unknown' : '—')}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(m.due_month_count || 0)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-ink">{formatBDT(m.total_due || 0)}</td>
                  <td className="px-3 py-2 text-right text-moss">{formatBDT(m.total_extra || 0)}</td>
                  <td className="px-3 py-2 text-right text-ink-soft">{formatBDT(m.approved_monthly_total || 0)}</td>
                  <td className="px-3 py-2 text-right">
                    {m.rate_not_set_months?.length
                      ? <span className="rounded-full bg-mist px-2 py-0.5 text-xs font-semibold text-ink-soft">{m.rate_not_set_months.length}</span>
                      : <span className="text-ink-soft">0</span>}
                  </td>
                </tr>
              ))}
              {!members.length && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-ink-soft">No members match this search.</td></tr>
              )}
            </tbody>
            <tfoot className="bg-mint text-xs font-bold text-ink">
              <tr>
                <td className="px-3 py-2" colSpan={5}>Totals ({data?.total ?? members.length} approved members)</td>
                <td className="px-3 py-2 text-right">{formatBDT(totals.due)}</td>
                <td className="px-3 py-2 text-right text-moss">{formatBDT(totals.extra)}</td>
                <td className="px-3 py-2 text-right">{formatBDT(totals.paid)}</td>
                <td className="px-3 py-2 text-right">{formatNumber(totals.unpriced)}</td>
              </tr>
            </tfoot>
          </table>
          {data?.limit >= (data?.total || 0) && (
            <p className="mt-2 text-xs text-ink-soft">Unpriced = obligated months with no configured rate — excluded from every money total, never guessed at ৳0.</p>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * Category 1 — Financial analytics.
 * Paid = approved monthly payments only (monthly_payment_details, written on
 * approval). Pending / rejected / failed / refunded are never counted.
 * Due = confirmed outstanding months of the member-wise report: each month is
 * priced with the rate that was effective FOR that month (oldest-first
 * settlement), never a flat assumed fee (see analyticsService.js).
 */
export default function Financial({ filters, refreshKey, onYears }) {
  const { isAdmin } = useAuth();
  const { year, month } = filters;
  const qs = new URLSearchParams();
  if (year) qs.set('year', String(year));
  if (month) qs.set('month', String(month));
  const url = `/api/analytics/financial${qs.toString() ? `?${qs}` : ''}`;
  const { data, loading, error, reload } = useAnalytics(url, refreshKey);

  // Share the real set of years that exist in the data with the filter bar.
  useEffect(() => {
    if (data?.scope?.available_years) onYears?.(data.scope.available_years);
  }, [data, onYears]);

  if (!data) {
    if (error) return <SectionError message={error} onRetry={reload} />;
    return <SectionLoading label="Loading financial analytics…" />;
  }

  const { kpis: k, monthly_trend: trend, status_breakdown: statuses, category_breakdown: cats } = data;
  const dueAvailable = k.total_due !== null && k.total_due !== undefined;

  const paidVsDueLabels = dueAvailable
    ? ['Collected (monthly dues)', 'Outstanding due']
    : ['Collected (monthly dues)'];
  const paidVsDueData = dueAvailable ? [k.total_paid, k.total_due] : [k.total_paid];

  const dueSeries = dueAvailable ? trend.filter((m) => m.due_months > 0) : [];
  const showDueOverTime = dueAvailable && dueSeries.some((m) => m.due > 0);

  return (
    <div className="space-y-4">
      <UpdatingBar show={loading} />
      <RefreshError message={error} onRetry={reload} />

      {/* ---------- KPI cards ---------- */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label="Total Paid Collection"
          value={formatBDT(k.total_paid)}
          sub={k.total_paid_basis}
          hint="Approved monthly payments only"
          accent="green"
        />
        <KpiCard
          label="Total Outstanding Due"
          value={dueAvailable ? formatBDT(k.total_due) : '—'}
          sub={dueAvailable ? `${formatNumber(k.due_months)} unpaid month(s) · ${formatNumber(k.due_members)} member(s)` : 'No data'}
          hint={`${formatNumber(k.rate_not_set_months)} month(s) rate-not-set · ${formatNumber(k.start_unknown_members)} start-unknown member(s) excluded`}
          accent="amber"
        />
        <KpiCard
          label="Extra Contributions"
          value={formatBDT(k.extra_contributions)}
          sub="Surplus after ALL dues settled"
          hint="Never counted as monthly dues"
          accent="violet"
        />
        <KpiCard
          label={`${k.period_label} Collection`}
          value={formatBDT(k.period_collection)}
          sub="Monthly dues billed to this month"
          accent="teal"
        />
        <KpiCard
          label="Successful Transactions"
          value={formatNumber(k.successful_transactions)}
          sub="Approved payments (by payment date)"
          hint={`Pending ${formatBDT(k.pending_amount)} · Rejected/failed ${formatBDT(k.rejected_amount)} excluded`}
          accent="blue"
        />
        <KpiCard
          label="Donations & Other"
          value={formatBDT(k.donations_and_other)}
          sub="Occasional payments (success)"
          hint="Never counted as monthly dues"
          accent="violet"
        />
      </div>

      {/* ---------- Paid vs Due + collection categories ---------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartBox
          type="bar"
          title="Total Paid vs Total Due"
          subtitle={`Monetary comparison · ${data.scope.scope_label}`}
          labels={paidVsDueLabels}
          datasets={[{
            label: 'Amount',
            data: paidVsDueData,
            backgroundColor: dueAvailable ? [PALETTE.green, PALETTE.amber] : [PALETTE.green],
          }]}
          currency
          height={260}
          note={dueAvailable ? k.due_note : 'No outstanding balance is defined for the selected period.'}
        />

        <ChartBox
          type="doughnut"
          title="Collection by Category"
          subtitle="Monthly dues are kept separate from donations and other contributions"
          labels={cats.map((c) => c.category)}
          datasets={[{
            label: 'Amount',
            data: cats.map((c) => c.amount),
            backgroundColor: cats.map((c, i) => (
              c.color === 'green' ? PALETTE.green : c.color === 'amber' ? PALETTE.amber : DONUT_COLORS[i % DONUT_COLORS.length]
            )),
            borderWidth: 2,
            borderColor: '#ffffff',
          }]}
          currency
          percent
          height={260}
          emptyMessage="No successful collections in this period."
          note="Only payments with status 'success' appear here."
        />
      </div>

      {/* ---------- Monthly collection trend ---------- */}
      <ChartBox
        type="line"
        title="Monthly Collection Trend"
        subtitle={year ? `Successful monthly dues collected in ${year} (chronological, zero months included)` : 'Last 12 months · successful monthly dues collected'}
        labels={trend.map((m) => m.label)}
        datasets={[{
          label: 'Collected',
          data: trend.map((m) => m.paid),
          borderColor: PALETTE.green,
          backgroundColor: 'rgba(15, 76, 58, 0.10)',
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: PALETTE.green,
          borderWidth: 2.5,
        }]}
        currency
        height={300}
        emptyMessage="No monthly dues were collected in this period."
        note="Month labels are billing periods (payment_month), not submission dates. Months with no collection are shown as ৳0."
      />

      {/* ---------- Paid vs due over time + status breakdown ---------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartBox
          type="bar"
          title="Paid vs Due over Time"
          subtitle={showDueOverTime ? 'Per billing month · collected amount vs outstanding amount' : 'Per billing month · collected amount'}
          labels={trend.map((m) => m.label)}
          datasets={[
            {
              label: 'Collected',
              data: trend.map((m) => m.paid),
              backgroundColor: PALETTE.green,
            },
            ...(showDueOverTime ? [{
              label: 'Outstanding due',
              data: trend.map((m) => m.due),
              backgroundColor: PALETTE.amber,
            }] : []),
          ]}
          currency
          height={300}
          emptyMessage="No collection or dues recorded for these months."
          note={showDueOverTime
            ? 'Due is priced with each member\u2019s own recorded contribution — never a flat assumed fee.'
            : 'Outstanding due is only defined for the current billing cycle.'}
        />

        <ChartBox
          type="doughnut"
          title="Payment Status Breakdown"
          subtitle="All submitted transactions · amount by status"
          labels={statuses.map((s) => `${cap(s.status)} (${s.count})`)}
          datasets={[{
            label: 'Amount',
            data: statuses.map((s) => s.amount),
            backgroundColor: statuses.map((s) => STATUS_COLORS[s.status] || PALETTE.slate),
            borderWidth: 2,
            borderColor: '#ffffff',
          }]}
          currency
          percent
          height={300}
          emptyMessage="No transactions recorded yet."
          note="Only the 'success' slice counts as collected revenue; pending, rejected and failed amounts are excluded from every KPI above."
        />
      </div>

      {/* ---------- Member-wise due report (staff only) ---------- */}
      {isAdmin && <MemberDuesReport refreshKey={refreshKey} />}

      <Note>
        Calculation rules — <b>Paid</b>: SUM(monthly_payment_details) where the underlying payment was approved
        (status = 'success'); allocations are grouped per member per month, so the same money can never be
        counted twice. <b>Due</b>: each obligated member × each month priced with the rate effective for THAT
        month, minus approved allocations; payments settle the OLDEST outstanding months first and only the
        remainder becomes Extra Contribution. Pending/rejected transactions never settle a month and are
        excluded from every KPI above. Months with no configured rate and members with an unknown contribution
        start are reported separately and never priced. <b>Donations</b>: occasional payments, reported
        separately. Scope: {data.scope.scope_label}.
      </Note>
    </div>
  );
}
