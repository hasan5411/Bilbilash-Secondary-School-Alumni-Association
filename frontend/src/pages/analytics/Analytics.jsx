import { useCallback, useState } from 'react';
import { PageHeader, Button, Select, Alert } from '../../components/ui.jsx';
import Financial from './Financial.jsx';
import Alumni from './Alumni.jsx';
import Donors from './Donors.jsx';
import HelpSection from './HelpSection.jsx';
import Community from './Community.jsx';

const TABS = [
  { id: 'financial', label: 'Financial' },
  { id: 'alumni', label: 'Alumni' },
  { id: 'donors', label: 'Blood Donor' },
  { id: 'help', label: 'Help Requests' },
  { id: 'community', label: 'Community' },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Analytics Dashboard (Category 1–5).
 * Rendered behind RequireRole(min=MEMBER, approved) in App.jsx and behind
 * authenticate → requireApproved → requireRole('MEMBER') on the API, so
 * visitors can neither see it nor call it.
 *
 * Filters: Year windows every section's trend charts and fully scopes the
 * Financial section; Month scopes the Financial cards/charts. Every filter
 * change refetches from the backend (never client-side fake maths), and the
 * useAnalytics hook drops stale responses.
 */
export default function Analytics() {
  const currentYear = new Date().getFullYear();
  const [tab, setTab] = useState('financial');
  const [year, setYear] = useState(String(currentYear));
  const [month, setMonth] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [years, setYears] = useState([currentYear]);

  const onYears = useCallback((list) => {
    setYears((prev) => [...new Set([...prev, ...(list || [])])].sort((a, b) => b - a));
  }, []);

  const filters = { year: year ? Number(year) : null, month: month ? Number(month) : null };
  const refresh = () => setRefreshKey((k) => k + 1);

  const sectionProps = { filters, refreshKey, onYears };
  const sections = {
    financial: <Financial {...sectionProps} />,
    alumni: <Alumni {...sectionProps} />,
    donors: <Donors refreshKey={refreshKey} />,
    help: <HelpSection {...sectionProps} />,
    community: <Community {...sectionProps} />,
  };

  return (
    <div>
      <PageHeader
        title="Analytics Dashboard"
        subtitle="Association-wide statistics computed live from the database — financial, alumni, donor, help and community insights."
      >
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-ink-soft sm:block">Refreshes on every filter change</span>
          <Button onClick={refresh}>↻ Refresh</Button>
        </div>
      </PageHeader>

      {/* ---------- Filters ---------- */}
      <div className="mb-5 rounded-xl border border-line bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Select label="Year" value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">All years</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
          </div>
          <div className="w-44">
            <Select label="Month (financial)" value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">All months</option>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
          </div>
          <p className="mb-1 text-xs text-ink-soft">
            The year filters every section&rsquo;s trends; the month filter applies to the Financial figures.
            Only approved, successful payments are counted as collected.
          </p>
        </div>
      </div>

      {/* ---------- Tabs ---------- */}
      <div className="mb-5 flex flex-wrap gap-1.5 rounded-xl border border-line bg-white/70 p-1.5" role="tablist" aria-label="Analytics categories">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
              tab === t.id
                ? 'bg-[#0F4C3A] text-white shadow-sm'
                : 'text-ink-soft hover:bg-white hover:text-[#0F4C3A]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ---------- Section ---------- */}
      <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
        {sections[tab]}
      </div>

      <div className="mt-6">
        <Alert kind="info">
          All numbers are aggregates (counts and sums) returned by the secured <code>/api/analytics</code> endpoints.
          Personal payment records, transaction IDs and other members&rsquo; details are never part of this dashboard.
        </Alert>
      </div>
    </div>
  );
}
