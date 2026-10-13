import { useEffect } from 'react';
import { ChartBox, PALETTE, STATUS_COLORS, URGENCY_COLORS } from '../../components/charts.jsx';
import { formatNumber } from '../../utils/format.js';
import { useAnalytics } from './useAnalytics.js';
import { KpiCard, Note, SectionLoading, SectionError, RefreshError, UpdatingBar } from './bits.jsx';

const cap = (s) => String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Category 4 — Help request analytics.
 * Uses the real workflow statuses (open, in_progress, resolved, closed) and
 * urgencies (low, medium, high, emergency) from help_requests — no invented
 * 'Resolved' state, no descriptions or contact details in the response.
 * Non-admin viewers see the same visibility rule as the Help list: closed
 * requests are not counted (they are hidden from members everywhere else).
 */
export default function HelpSection({ filters, refreshKey, onYears }) {
  const { year } = filters;
  const url = `/api/analytics/help${year ? `?year=${year}` : ''}`;
  const { data, loading, error, reload } = useAnalytics(url, refreshKey);

  useEffect(() => {
    if (data?.scope?.available_years) onYears?.(data.scope.available_years);
  }, [data, onYears]);

  if (!data) {
    if (error) return <SectionError message={error} onRetry={reload} />;
    return <SectionLoading label="Loading help request analytics…" />;
  }

  const { kpis: k, statuses, urgencies, categories, blood_groups: blood, trend, scope } = data;

  return (
    <div className="space-y-4">
      <UpdatingBar show={loading} />
      <RefreshError message={error} onRetry={reload} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Total Help Requests" value={formatNumber(k.total)} sub={year ? `Created in ${year}` : 'All time'} accent="green" />
        <KpiCard label="Open (Pending)" value={formatNumber(k.open)} sub="Awaiting help" accent="amber" />
        <KpiCard label="In Progress" value={formatNumber(k.in_progress)} sub="Being handled" accent="sky" />
        <KpiCard label="Resolved" value={formatNumber(k.resolved)} sub="Successfully closed by workflow" accent="teal" />
        <KpiCard label="Emergency Requests" value={formatNumber(k.emergency)} sub="Urgency = emergency" accent="red" />
        <KpiCard label="Blood Requests" value={formatNumber(k.blood_requests)} sub="Category = blood" accent="violet" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartBox
          type="doughnut"
          title="Requests by Status"
          subtitle={`Distribution across the existing workflow statuses${scope.visibility === 'excludes_closed' ? ' (closed requests hidden from members)' : ''}`}
          labels={statuses.map((s) => `${cap(s.status)} (${s.count})`)}
          datasets={[{
            label: 'Requests',
            data: statuses.map((s) => s.count),
            backgroundColor: statuses.map((s) => STATUS_COLORS[s.status] || PALETTE.slate),
            borderWidth: 2,
            borderColor: '#ffffff',
          }]}
          percent
          height={300}
          emptyMessage="No help requests recorded yet."
        />

        <ChartBox
          type="bar"
          title="Requests by Urgency"
          subtitle="Emergency, high, medium and low — the levels stored in the database"
          labels={urgencies.map((u) => cap(u.urgency))}
          datasets={[{
            label: 'Requests',
            data: urgencies.map((u) => u.count),
            backgroundColor: urgencies.map((u) => URGENCY_COLORS[u.urgency] || PALETTE.slate),
          }]}
          height={300}
          emptyMessage="No urgency data recorded yet."
        />
      </div>

      <ChartBox
        type="line"
        title="Help Request Trends"
        subtitle={year ? `Monthly volume of new requests in ${year}` : 'Monthly volume of new requests (last 12 months)'}
        labels={trend.map((t) => t.label)}
        datasets={[{
          label: 'Requests',
          data: trend.map((t) => t.count),
          borderColor: PALETTE.blue,
          backgroundColor: 'rgba(37, 99, 235, 0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          borderWidth: 2.5,
        }]}
        height={280}
        emptyMessage="No help requests were created in this period."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartBox
          type="horizontalBar"
          title="Requests by Category"
          subtitle="Existing help categories (career, education, medical, financial, blood, other)"
          labels={categories.map((c) => cap(c.category))}
          datasets={[{
            label: 'Requests',
            data: categories.map((c) => c.count),
            backgroundColor: PALETTE.teal,
          }]}
          height={260}
          emptyMessage="No categories recorded yet."
        />

        <ChartBox
          type="bar"
          title="Blood-related Requests by Blood Group"
          subtitle="Only requests with category = blood"
          labels={blood.map((b) => b.blood_group)}
          datasets={[{
            label: 'Requests',
            data: blood.map((b) => b.count),
            backgroundColor: PALETTE.red,
          }]}
          height={260}
          emptyMessage="No blood-related help requests recorded."
        />
      </div>

      <Note>
        Aggregates only — request titles, descriptions, locations and personal contact details are never
        returned by the analytics API. {k.staff ? '' : 'Closed requests are excluded for members, matching the Help page rules.'}
      </Note>
    </div>
  );
}
