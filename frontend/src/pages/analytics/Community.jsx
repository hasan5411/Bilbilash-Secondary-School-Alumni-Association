import { useEffect, useState } from 'react';
import { ChartBox, PALETTE, STATUS_COLORS } from '../../components/charts.jsx';
import { formatNumber } from '../../utils/format.js';
import { useAnalytics } from './useAnalytics.js';
import { KpiCard, Note, SectionLoading, SectionError, RefreshError, UpdatingBar } from './bits.jsx';
import { Select } from '../../components/ui.jsx';

const cap = (s) => String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Category 5 — Community analytics (Job Board, Vision & Ideas, Polls, Events).
 * Counts come from real records only: job applications are counted because the
 * feature and table exist, event participation uses event_registrations, and
 * votes use poll_votes (one row per user per poll — no JOIN duplication).
 * Moderation states (pending/rejected/closed) are returned for Admin/Authority;
 * members only receive the states they can already see in the app.
 */
export default function Community({ filters, refreshKey, onYears }) {
  const { year } = filters;
  const [pollId, setPollId] = useState(null);

  const qs = new URLSearchParams();
  if (year) qs.set('year', String(year));
  if (pollId) qs.set('poll_id', String(pollId));
  const url = `/api/analytics/community${qs.toString() ? `?${qs}` : ''}`;
  const { data, loading, error, reload } = useAnalytics(url, refreshKey);

  useEffect(() => {
    if (data?.scope?.available_years) onYears?.(data.scope.available_years);
  }, [data, onYears]);

  if (!data) {
    if (error) return <SectionError message={error} onRetry={reload} />;
    return <SectionLoading label="Loading community analytics…" />;
  }

  const { jobs, visions, polls, events, scope } = data;
  const selected = polls.selected;

  return (
    <div className="space-y-4">
      <UpdatingBar show={loading} />
      <RefreshError message={error} onRetry={reload} />

      {/* ---------- Community overview ---------- */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Job Posts" value={formatNumber(jobs.total)} sub={`${formatNumber(jobs.applications)} applications`} accent="blue" />
        <KpiCard label="Vision & Ideas" value={formatNumber(visions.total)} sub="Submitted ideas" accent="teal" />
        <KpiCard label="Community Polls" value={formatNumber(polls.total)} sub="Visible polls" accent="violet" />
        <KpiCard label="Recorded Votes" value={formatNumber(polls.total_votes)} sub="One vote per member per poll" accent="green" />
        <KpiCard label="Events" value={formatNumber(events.total)} sub={`${formatNumber(events.upcoming)} upcoming · ${formatNumber(events.past)} past`} accent="amber" />
        <KpiCard label="Event Registrations" value={formatNumber(events.registrations)} sub="From event_registrations" accent="sky" />
        <KpiCard label={year ? `Jobs in ${year}` : 'Job Posts (12 mo)'} value={formatNumber(jobs.trend.reduce((a, r) => a + r.count, 0))} sub="New posts in period" accent="slate" />
        <KpiCard label={year ? `Ideas in ${year}` : 'Ideas (12 mo)'} value={formatNumber(visions.trend.reduce((a, r) => a + r.count, 0))} sub="New submissions in period" accent="slate" />
      </div>

      {/* ---------- Jobs ---------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartBox
          type="bar"
          title="Job Posts by Status"
          subtitle={scope.staff ? 'All moderation states' : 'Only approved jobs (pending/rejected are admin-only)'}
          labels={jobs.statuses.map((s) => cap(s.status))}
          datasets={[{
            label: 'Jobs',
            data: jobs.statuses.map((s) => s.count),
            backgroundColor: jobs.statuses.map((s) => STATUS_COLORS[s.status] || PALETTE.slate),
          }]}
          height={270}
          emptyMessage="No job posts in this view."
        />

        <ChartBox
          type="line"
          title="Monthly Job Posting Trend"
          subtitle={year ? `New job posts in ${year}` : 'New job posts, last 12 months'}
          labels={jobs.trend.map((t) => t.label)}
          datasets={[{
            label: 'Job posts',
            data: jobs.trend.map((t) => t.count),
            borderColor: PALETTE.blue,
            backgroundColor: 'rgba(37, 99, 235, 0.12)',
            fill: true,
            tension: 0.35,
            pointRadius: 3,
            borderWidth: 2.5,
          }]}
          height={270}
          emptyMessage="No job posts in this period."
          note={jobs.applications > 0 ? `${jobs.applications} job application${jobs.applications === 1 ? '' : 's'} submitted in total.` : 'No job applications recorded yet.'}
        />
      </div>

      {/* ---------- Visions ---------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartBox
          type="bar"
          title="Vision & Ideas by Status"
          subtitle={scope.staff ? 'All moderation states (pending, approved, rejected, implemented)' : 'Only approved ideas (moderation states are admin-only)'}
          labels={visions.statuses.map((s) => cap(s.status))}
          datasets={[{
            label: 'Ideas',
            data: visions.statuses.map((s) => s.count),
            backgroundColor: visions.statuses.map((s) => STATUS_COLORS[s.status] || PALETTE.violet),
          }]}
          height={270}
          emptyMessage="No ideas in this view."
        />

        <ChartBox
          type="line"
          title="Monthly Submission Trend"
          subtitle={year ? `New ideas submitted in ${year}` : 'New ideas submitted, last 12 months'}
          labels={visions.trend.map((t) => t.label)}
          datasets={[{
            label: 'Ideas',
            data: visions.trend.map((t) => t.count),
            borderColor: PALETTE.violet,
            backgroundColor: 'rgba(124, 58, 237, 0.12)',
            fill: true,
            tension: 0.35,
            pointRadius: 3,
            borderWidth: 2.5,
          }]}
          height={270}
          emptyMessage="No ideas submitted in this period."
        />
      </div>

      {/* ---------- Polls ---------- */}
      <ChartBox
        type="horizontalBar"
        title="Votes by Poll Option"
        subtitle={selected ? `"${selected.question}" · ${formatNumber(selected.total_votes)} votes` : 'Select a poll to see its results'}
        labels={selected ? selected.options.map((o) => o.option_text) : []}
        datasets={[{
          label: 'Votes',
          data: selected ? selected.options.map((o) => o.votes) : [],
          backgroundColor: PALETTE.green,
        }]}
        height={Math.max(200, 70 + (selected?.options.length || 0) * 46)}
        emptyMessage="No polls or votes recorded yet."
        note="Each member can vote once per poll (UNIQUE poll_id + user_id), so a vote can never be counted twice."
      />

      {polls.list.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56">
            <Select label="Poll" value={pollId ?? selected?.poll_id ?? ''} onChange={(e) => setPollId(Number(e.target.value))}>
              {polls.list.map((p) => (
                <option key={p.poll_id} value={p.poll_id}>
                  {p.question} ({p.votes} votes{scope.staff ? `, ${p.status}` : ''})
                </option>
              ))}
            </Select>
          </div>
          <Note>Poll results follow the existing visibility rules — members see open polls, Admin/Authority see all.</Note>
        </div>
      )}

      {/* ---------- Events ---------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartBox
          type="bar"
          title="Upcoming vs Past Events"
          subtitle="Based on the stored event dates"
          labels={['Upcoming', 'Past']}
          datasets={[{
            label: 'Events',
            data: [events.upcoming, events.past],
            backgroundColor: [PALETTE.green, PALETTE.slate],
          }]}
          height={270}
          emptyMessage="No events in this view."
        />

        <div className="rounded-xl border border-line bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-ink">Event Participation</h3>
          <p className="mt-0.5 text-xs text-ink-soft">Registration records stored per event</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-mint p-4 text-center">
              <div className="text-2xl font-black text-forest">{formatNumber(events.registrations)}</div>
              <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Registrations</div>
            </div>
            <div className="rounded-lg bg-mint p-4 text-center">
              <div className="text-2xl font-black text-forest">{formatNumber(events.total)}</div>
              <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Events</div>
            </div>
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-ink-soft">
            Participation counts come from the event_registrations table only — no attendance is assumed or
            fabricated for events without registration records.
          </p>
        </div>
      </div>

      {!scope.staff && (
        <Note>
          You are seeing the states already visible to members (approved jobs, approved ideas, open polls,
          published events). Pending/rejected/closed counts are shown to Admin &amp; Authority accounts.
        </Note>
      )}
    </div>
  );
}
