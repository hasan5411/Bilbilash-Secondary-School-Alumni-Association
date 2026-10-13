import { ChartBox, PALETTE, DONUT_COLORS } from '../../components/charts.jsx';
import { formatNumber, formatPercent } from '../../utils/format.js';
import { useAnalytics } from './useAnalytics.js';
import { KpiCard, Note, SectionLoading, SectionError, RefreshError, UpdatingBar } from './bits.jsx';

/**
 * Category 3 — Blood donor analytics.
 * Uses the existing profile fields `active_donor` (BOOLEAN) and `blood_group`.
 * Only profiles with active_donor = TRUE count as donors; missing/false values
 * never do. The separate Blood navigation section is NOT recreated here.
 */
export default function Donors({ refreshKey }) {
  const { data, loading, error, reload } = useAnalytics('/api/analytics/donors', refreshKey);

  if (!data) {
    if (error) return <SectionError message={error} onRetry={reload} />;
    return <SectionLoading label="Loading blood donor analytics…" />;
  }

  const { kpis: k, blood_groups: groups, active_vs_inactive: split } = data;

  return (
    <div className="space-y-4">
      <UpdatingBar show={loading} />
      <RefreshError message={error} onRetry={reload} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Active Blood Donors" value={formatNumber(k.active_donors)} sub="active_donor = TRUE" accent="red" />
        <KpiCard label="Donor Rate" value={formatPercent(k.donor_percentage)} sub="Among profiles with a blood group" accent="green" />
        <KpiCard label="Not Active Donors" value={formatNumber(k.inactive_donors)} sub="Blood group recorded, not opted in" accent="slate" />
        <KpiCard label="Members with Blood Group" value={formatNumber(k.profiles_with_blood_group)} sub={`of ${formatNumber(k.eligible_profiles)} members`} accent="blue" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartBox
          type="doughnut"
          title="Active Donors by Blood Group"
          subtitle="Only members marked as active donors · share of active donors"
          labels={groups.map((g) => g.blood_group)}
          datasets={[{
            label: 'Donors',
            data: groups.map((g) => g.count),
            backgroundColor: groups.map((_, i) => DONUT_COLORS[i % DONUT_COLORS.length]),
            borderWidth: 2,
            borderColor: '#ffffff',
          }]}
          percent
          height={320}
          emptyMessage="No active blood donors yet."
          note="Profiles without a blood group are shown as 'Unknown'; inactive donors are excluded from this chart."
        />

        <ChartBox
          type="bar"
          title="Active vs Inactive Donors"
          subtitle="Approved members with a blood group on file"
          labels={split.map((s) => s.label)}
          datasets={[{
            label: 'Members',
            data: split.map((s) => s.count),
            backgroundColor: [PALETTE.green, PALETTE.slate],
          }]}
          height={320}
          emptyMessage="No donor profiles recorded yet."
        />
      </div>

      <Note>{k.note} Contact details are never included in analytics responses.</Note>
    </div>
  );
}
