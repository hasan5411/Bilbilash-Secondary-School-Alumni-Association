import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { Card, Spinner, Alert, PageHeader } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export default function Stats() {
  const { isAuthority } = useAuth();
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/stats/overview').then((r) => setStats(r.data.stats)).catch((e) => setError(e.message));
    if (isAuthority) {
      api.get('/api/users/audit').then((r) => setActivity(r.data.activity)).catch(() => {});
    }
  }, [isAuthority]);

  return (
    <div>
      <PageHeader title="Administration Dashboard" subtitle="All numbers come directly from the database." />
      {error && <Alert kind="error">{error}</Alert>}
      {!stats && !error && <Spinner />}

      {stats && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {[
              ['Total users', stats.total_users], ['Pending approval', stats.pending], ['Members', stats.members],
              ['Admins', stats.admins], ['Approved jobs', stats.jobs],
              ['Published events', stats.events], ['Pending ideas', stats.pending_visions], ['Open help', stats.open_help],
              ['Published notices', stats.notices], ['Gallery photos', stats.gallery],
            ].map(([label, value]) => (
              <Card key={label} className="text-center">
                <div className="text-3xl font-black text-moss">{value}</div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</div>
              </Card>
            ))}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <Link to="/admin/approvals" className="rounded-xl bg-white p-5 font-semibold text-ink shadow-sm ring-1 ring-line transition hover:shadow-md">✅ Member approvals →</Link>
            <Link to="/admin/users" className="rounded-xl bg-white p-5 font-semibold text-ink shadow-sm ring-1 ring-line transition hover:shadow-md">👥 Users, promote & demote →</Link>
            <Link to="/admin/members" className="rounded-xl bg-white p-5 font-semibold text-ink shadow-sm ring-1 ring-line transition hover:shadow-md">📋 Member Information →</Link>
            <Link to="/admin/payments" className="rounded-xl bg-white p-5 font-semibold text-ink shadow-sm ring-1 ring-line transition hover:shadow-md">💳 Payment Management →</Link>
            <Link to="/admin/moderation" className="rounded-xl bg-white p-5 font-semibold text-ink shadow-sm ring-1 ring-line transition hover:shadow-md">🛡️ Job moderation →</Link>
            <Link to="/admin/events" className="rounded-xl bg-white p-5 font-semibold text-ink shadow-sm ring-1 ring-line transition hover:shadow-md">📅 Manage events →</Link>
            <Link to="/admin/notices" className="rounded-xl bg-white p-5 font-semibold text-ink shadow-sm ring-1 ring-line transition hover:shadow-md">📢 Manage notices →</Link>
            <Link to="/admin/polls" className="rounded-xl bg-white p-5 font-semibold text-ink shadow-sm ring-1 ring-line transition hover:shadow-md">📊 Manage polls →</Link>
            <Link to="/admin/teachers" className="rounded-xl bg-white p-5 font-semibold text-ink shadow-sm ring-1 ring-line transition hover:shadow-md">🎓 Manage teachers →</Link>
          </div>
        </>
      )}

      {isAuthority && (
        <Card className="mt-6">
          <h3 className="mb-3 font-bold text-ink">Audit trail (Authority only)</h3>
          {!activity && <p className="text-sm text-ink-soft">Loading…</p>}
          {activity && activity.length === 0 && <p className="text-sm text-ink-soft">No audit entries yet. Approvals, promotions, and demotions appear here.</p>}
          <ul className="divide-y text-sm">
            {(activity || []).map((a) => (
              <li key={a.audit_id} className="py-2 text-ink-soft">
                <span className="font-mono text-xs text-moss">{a.action}</span> on {a.entity} #{a.entity_id ?? '—'}
                <span className="ml-2 text-xs text-ink-soft">{new Date(a.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
