import { Card, Spinner, Alert, Button } from '../../components/ui.jsx';

/** Accent colours reuse the association's green identity + tasteful extras. */
const ACCENTS = {
  green: 'border-l-[#0F4C3A]',
  teal: 'border-l-teal-600',
  blue: 'border-l-blue-600',
  sky: 'border-l-sky-500',
  amber: 'border-l-amber-500',
  red: 'border-l-red-500',
  violet: 'border-l-violet-600',
  slate: 'border-l-slate-400',
};

/** Responsive KPI card: label, big value, context line, optional footnote. */
export function KpiCard({ label, value, sub, hint, accent = 'green' }) {
  return (
    <Card className={`min-w-0 max-w-full border-l-4 ${ACCENTS[accent] || ACCENTS.green}`}>
      <div className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">{label}</div>
      <div className="mt-1.5 text-2xl font-black leading-none text-ink">{value}</div>
      {sub && <div className="mt-1.5 text-xs font-medium text-ink-soft">{sub}</div>}
      {hint && <div className="mt-1 text-[11px] leading-snug text-ink-soft">{hint}</div>}
    </Card>
  );
}

/** Small muted explanation line (calculation rules, scope, permissions). */
export function Note({ children }) {
  return <p className="text-xs leading-relaxed text-ink-soft">{children}</p>;
}

/** Loading state for a section that has no data yet. */
export function SectionLoading({ label = 'Loading analytics…' }) {
  return <Spinner label={label} />;
}

/** Error state with a retry button (requirement: useful errors + retry). */
export function SectionError({ message, onRetry }) {
  return (
    <div className="space-y-3">
      <Alert kind="error">
        <b>Could not load this section.</b> {message}
      </Alert>
      <Button variant="outline" onClick={onRetry}>Retry</Button>
    </div>
  );
}

/**
 * Failed REFETCH: keep the previously loaded figures visible (they are still
 * real data) but tell the user the update did not go through, with a Retry.
 */
export function RefreshError({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span>
        <b>Could not refresh.</b> {message} — showing the last loaded figures.
      </span>
      <Button variant="outline" onClick={onRetry} className="ml-auto">Retry</Button>
    </div>
  );
}

/** Thin "Updating…" strip shown while refetching with data already on screen. */
export function UpdatingBar({ show }) {
  if (!show) return null;
  return (
    <div className="mb-3 flex items-center gap-2 text-xs font-medium text-ink-soft">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-forest border-t-transparent" />
      Updating with the selected filters…
    </div>
  );
}
