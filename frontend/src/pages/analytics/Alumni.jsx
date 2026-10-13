import { useEffect } from 'react';
import { ChartBox, PALETTE } from '../../components/charts.jsx';
import { formatNumber, formatPercent } from '../../utils/format.js';
import { useAnalytics } from './useAnalytics.js';
import { KpiCard, Note, SectionLoading, SectionError, RefreshError, UpdatingBar } from './bits.jsx';

/**
 * Category 2 — Alumni analytics.
 * Population = approved + active accounts (same standard as the Directory).
 * Pending registration counts are returned only for ADMIN/AUTHORITY, because
 * registration moderation is admin-only everywhere else in the app.
 */
export default function Alumni({ filters, refreshKey, onYears }) {
  const { year } = filters;
  const url = `/api/analytics/alumni${year ? `?year=${year}` : ''}`;
  const { data, loading, error, reload } = useAnalytics(url, refreshKey);

  useEffect(() => {
    if (data?.scope?.available_years) onYears?.(data.scope.available_years);
  }, [data, onYears]);

  if (!data) {
    if (error) return <SectionError message={error} onRetry={reload} />;
    return <SectionLoading label="Loading alumni analytics…" />;
  }

  const { kpis: k, batches, growth, professions, scope } = data;

  return (
    <div className="space-y-4">
      <UpdatingBar show={loading} />
      <RefreshError message={error} onRetry={reload} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total Registered Alumni" value={formatNumber(k.total_registered)} sub="Active accounts" accent="green" />
        <KpiCard label="Approved Members" value={formatNumber(k.approved_members)} sub="Role MEMBER · approved" accent="teal" />
        <KpiCard label="Active Accounts" value={formatNumber(k.active_accounts)} sub="Approved & active (any role)" accent="blue" />
        {k.staff && (
          <KpiCard label="Pending Registrations" value={formatNumber(k.pending_registrations)} sub="Awaiting admin approval" accent="amber" />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartBox
          type="bar"
          title="Batch-wise Alumni Distribution"
          subtitle="Approved members grouped by SSC batch · exact counts in tooltips"
          labels={batches.map((b) => b.batch)}
          datasets={[{
            label: 'Alumni',
            data: batches.map((b) => b.count),
            backgroundColor: batches.map((b) => (b.batch === 'Not specified' ? PALETTE.slate : PALETTE.teal)),
          }]}
          height={300}
          emptyMessage="No alumni profiles yet."
          note="Members without an SSC batch are grouped as 'Not specified' instead of being dropped."
        />

        <ChartBox
          type="horizontalBar"
          title="Profession Distribution"
          subtitle="Approved members by profession · 'Not specified' when the profile has none"
          labels={professions.map((p) => p.profession)}
          datasets={[{
            label: 'Members',
            data: professions.map((p) => p.count),
            backgroundColor: PALETTE.blue,
          }]}
          height={300}
          emptyMessage="No profession data recorded yet."
          note="Values are grouped case-insensitively; no profession is invented or inferred."
        />
      </div>

      <ChartBox
        type="line"
        title="Membership Growth"
        subtitle={year
          ? `Registrations in ${year} — monthly (bars via points) vs cumulative total`
          : `Registrations up to the current month (first registration: ${scope.first_registration_month})`}
        labels={growth.map((g) => g.label)}
        datasets={[
          {
            label: 'New registrations (month)',
            data: growth.map((g) => g.new_registrations),
            borderColor: PALETTE.sky,
            backgroundColor: 'rgba(14, 165, 233, 0.15)',
            tension: 0.35,
            pointRadius: 3,
            borderWidth: 2.5,
          },
          {
            label: 'Cumulative total',
            data: growth.map((g) => g.cumulative),
            borderColor: PALETTE.green,
            backgroundColor: 'rgba(15, 76, 58, 0.10)',
            borderDash: [6, 4],
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 2.5,
            fill: true,
          },
        ]}
        height={320}
        emptyMessage="No registrations recorded yet."
        note="Monthly line counts new registrations created in that month; the dashed line is the running cumulative total — they are different measures, not duplicates."
      />

      <Note>
        Pending-registration counts and moderation states are visible to Admin/Authority only. All figures are
        aggregates — no names, emails or personal records are returned by these endpoints.
      </Note>
    </div>
  );
}
