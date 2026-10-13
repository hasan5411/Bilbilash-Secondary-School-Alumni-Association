
export function Button({ children, variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-moss text-white hover:bg-forest disabled:opacity-50',
    sun: 'bg-sun text-ink hover:brightness-95 disabled:opacity-50',
    outline: 'border border-forest text-forest hover:bg-mint disabled:opacity-50',
    danger: 'bg-red-500 text-white hover:bg-red-600 disabled:opacity-50',
    ghost: 'text-ink-soft hover:bg-mist disabled:opacity-50',
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-1 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = '' }) {
  return <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

export function Input({ label, error, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-sm font-medium text-ink">{label}</span>}
      <input
        className={`w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-forest focus:ring-2 focus:ring-forest/20 ${className}`}
        {...props}
      />
      {error && <span className="mt-1 block text-xs text-red-500">{error}</span>}
    </label>
  );
}

export function Select({ label, children, ...props }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-sm font-medium text-ink">{label}</span>}
      <select
        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

export function Textarea({ label, ...props }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-sm font-medium text-ink">{label}</span>}
      <textarea
        className="min-h-24 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
        {...props}
      />
    </label>
  );
}

const BADGE_COLORS = {
  pending: 'bg-sun/20 text-yellow-800', approved: 'bg-emerald-100 text-emerald-700', published: 'bg-emerald-100 text-emerald-700',
  open: 'bg-emerald-100 text-emerald-700', rejected: 'bg-red-100 text-red-600', closed: 'bg-mist text-ink-soft',
  archived: 'bg-mist text-ink-soft', inactive: 'bg-mist text-ink-soft', cancelled: 'bg-red-100 text-red-600',
  resolved: 'bg-emerald-100 text-emerald-700', in_progress: 'bg-sky-100 text-sky-700', submitted: 'bg-sky-100 text-sky-700',
  shortlisted: 'bg-emerald-100 text-emerald-700', hired: 'bg-emerald-100 text-emerald-700', implemented: 'bg-emerald-100 text-emerald-700',
  draft: 'bg-mist text-ink-soft',
};
export function Badge({ value }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE_COLORS[value] || 'bg-mist text-ink-soft'}`}>{value}</span>;
}

export function Alert({ kind = 'info', children }) {
  const styles = { info: 'bg-sky-50 text-sky-800 border-sky-200', error: 'bg-red-50 text-red-700 border-red-200', success: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  return <div className={`rounded-lg border px-4 py-3 text-sm ${styles[kind]}`}>{children}</div>;
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-slate-500">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ title, hint }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-line bg-white/60 py-12 text-center">
      <p className="text-ink-soft">{title}</p>
      {hint && <p className="mt-1 text-sm text-ink-soft">{hint}</p>}
    </div>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
