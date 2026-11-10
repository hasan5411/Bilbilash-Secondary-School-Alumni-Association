import Avatar from '../../components/Avatar.jsx';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { Card, Button, Input, Spinner, Alert, PageHeader, Badge, EmptyState } from '../../components/ui.jsx';

function DetailRow({ label, children }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-soft">{label}</dt>
      <dd className="mt-0.5 break-words font-semibold text-ink">{children}</dd>
    </div>
  );
}

function MemberDetailModal({ userId, onClose }) {
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.get(`/api/users/${userId}`)
      .then((r) => { if (!cancelled) setUser(r.data.user); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [userId]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="mt-10 w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <Card>
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-bold text-ink">Member details</h2>
            <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={onClose}>✕ Close</Button>
          </div>

          {error && <Alert kind="error">{error}</Alert>}
          {!user && !error && <Spinner />}

          {user && (
            <>
              <div className="mt-4 flex items-center gap-4">
                <Avatar name={`${user.first_name || ''} ${user.last_name || ''}`} photoRef={user.profile_photo} className="h-16 w-16" textClass="text-xl font-black" />
                <div>
                  <div className="text-lg font-bold text-ink">{user.first_name} {user.last_name}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge value={user.role} />
                    <Badge value={user.status} />
                    <Badge value={user.is_active ? 'active' : 'inactive'} />
                  </div>
                </div>
              </div>

              <dl className="mt-5 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                <DetailRow label="Email">{user.email}</DetailRow>
                <DetailRow label="Phone">{user.phone || 'Not provided'}</DetailRow>
                <DetailRow label="Registration number">{user.registration_number || 'Not provided'}</DetailRow>
                <DetailRow label="SSC batch">{user.ssc_batch ?? 'Not provided'}</DetailRow>
                <DetailRow label="Blood group">{user.blood_group || 'Not provided'}</DetailRow>
                <DetailRow label="Profession">{user.profession || 'Not provided'}</DetailRow>
                <DetailRow label="Institute">{user.institute || 'Not provided'}</DetailRow>
                <DetailRow label="Registered on">{user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}</DetailRow>
                <DetailRow label="Present address">{user.present_address || 'Not provided'}</DetailRow>
                <DetailRow label="Permanent address">{user.permanent_address || 'Not provided'}</DetailRow>
                <div className="sm:col-span-2">
                  <DetailRow label="Facebook profile">
                    {user.facebook_url
                      ? <a href={user.facebook_url} target="_blank" rel="noopener noreferrer" className="text-moss hover:underline">{user.facebook_url}</a>
                      : 'Not provided'}
                  </DetailRow>
                </div>
                {user.bio && (
                  <div className="sm:col-span-2">
                    <DetailRow label="Bio">{user.bio}</DetailRow>
                  </div>
                )}
              </dl>
              <p className="mt-4 text-xs text-ink-soft">Security credentials (passwords, tokens) are never shown.</p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

/*
 * Payment-status colour code for one member row.
 * The status itself is decided by the backend (contributionService.memberPaymentStatus),
 * which reuses the SAME ledger as Profile, Payments and Analytics — no second
 * due calculation lives in this file. Light tints keep names/contacts readable;
 * index.css forces print-color-adjust so the tints survive printing.
 */
const PAYMENT_STATUS = {
  regular: { label: 'Regular payer', bg: '#bbf7d0' },
  due: { label: 'Due', bg: '#fff2a8' },
  never_paid: { label: 'Never paid', bg: '#b0e0e6' },
  not_configured: { label: 'No monthly contribution', bg: '#fecaca' },
};
const STATUS_ORDER = ['regular', 'due', 'never_paid', 'not_configured'];
const UNKNOWN_STATUS = PAYMENT_STATUS.not_configured;

export default function Members() {
  const [users, setUsers] = useState(null);
  const [statusOf, setStatusOf] = useState(null); // Map(user_id -> status key)
  const [statusError, setStatusError] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/users')
      .then((r) => { if (!cancelled) setUsers(r.data.users); })
      .catch((e) => { if (!cancelled) setError(e.message); });

    // Statuses come from the ONE authoritative contribution report
    // (same service that powers Profile, Payments and Analytics). Staff-only,
    // server-enforced — this page is already Admin/Authority only.
    api.get('/api/contributions/members?limit=1000')
      .then((r) => {
        if (cancelled) return;
        const map = new Map();
        for (const m of r.data.members) map.set(Number(m.user_id), m.payment_status);
        setStatusOf(map);
      })
      .catch((e) => { if (!cancelled) setStatusError(e.message); });

    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!users) return [];
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [`${u.first_name} ${u.last_name}`, u.email, String(u.ssc_batch ?? ''), u.profession ?? '', u.institute ?? '']
        .some((v) => v.toLowerCase().includes(q))
    );
  }, [users, search]);

  // Colour only once the authoritative statuses arrived; until then rows stay plain.
  const colourKeyOf = (u) => {
    if (!statusOf) return null;
    const key = statusOf.get(Number(u.user_id));
    return PAYMENT_STATUS[key] ? key : 'not_configured';
  };
  const statusMeta = (key) => PAYMENT_STATUS[key] || UNKNOWN_STATUS;

  const counts = useMemo(() => {
    const out = { regular: 0, due: 0, never_paid: 0, not_configured: 0 };
    if (!statusOf) return out;
    for (const u of filtered) out[colourKeyOf(u) || 'not_configured'] += 1;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, statusOf]);

  const printedAt = new Date().toLocaleString();
  const scopeLabel = search.trim() ? `Filtered: “${search.trim()}”` : 'All members';
  const canPrint = Boolean(users) && filtered.length > 0;

  return (
    <div>
      <PageHeader title="Member Information" subtitle="Complete registered information for every account. Admin & Authority only.">
        <Button
          variant="outline"
          onClick={() => window.print()}
          disabled={!canPrint}
          title={canPrint ? 'Print the displayed members / Save as PDF' : 'Nothing to print'}
        >
          Print / Save as PDF
        </Button>
      </PageHeader>

      {error && <Alert kind="error">{error}</Alert>}
      {statusError && (
        <Alert kind="error">
          Payment status could not be loaded ({statusError}). Member records are shown without status colours.
        </Alert>
      )}
      {!users && !error && <Spinner />}

      {users && (
        <>
          <Card className="mb-4">
            <Input
              label="Search member"
              placeholder="Search by name, email, SSC batch, profession, or institute…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Card>

          {statusOf && (
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-soft">
              <span className="font-semibold uppercase tracking-wide">Payment status:</span>
              {STATUS_ORDER.map((key) => (
                <span key={key} className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-3 w-3 rounded-sm border border-slate-300"
                    style={{ backgroundColor: statusMeta(key).bg }}
                  />
                  <span className="font-medium text-ink">{statusMeta(key).label}</span>
                  <span>({counts[key]})</span>
                </span>
              ))}
            </div>
          )}

          <p className="mb-2 text-sm text-ink-soft">{filtered.length} member(s)</p>

          {filtered.length === 0
            ? <EmptyState title="No members matched your search." hint="Try a different name, email, batch, or profession." />
            : (
              <div className="overflow-x-auto rounded-xl border border-line bg-white">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b bg-mint text-left text-xs uppercase text-ink-soft">
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Batch</th>
                      <th className="px-4 py-3">Profession</th>
                      <th className="px-4 py-3">Institute</th>
                      <th className="px-4 py-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((u) => {
                      const key = colourKeyOf(u);
                      return (
                        <tr
                          key={u.user_id}
                          className="border-b last:border-0"
                          style={key ? { backgroundColor: statusMeta(key).bg } : undefined}
                          title={key ? `Payment status: ${statusMeta(key).label}` : undefined}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <Avatar name={`${u.first_name || ''} ${u.last_name || ''}`} photoRef={u.profile_photo} className="h-9 w-9" textClass="text-xs font-bold" />
                              <div>
                                <div className="font-medium text-ink">{u.first_name} {u.last_name}</div>
                                <div className="text-xs text-ink-soft">{u.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-ink-soft">{u.ssc_batch ?? '—'}</td>
                          <td className="px-4 py-3 text-ink-soft">{u.profession || '—'}</td>
                          <td className="px-4 py-3 text-ink-soft">{u.institute || '—'}</td>
                          <td className="px-4 py-3">
                            <Button variant="outline" className="!px-2 !py-1 text-xs" onClick={() => setSelectedId(u.user_id)}>View Details</Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </>
      )}

      {/*
       * Print sheet — same mechanism as Event Management: the browser's native
       * Print / Save as PDF does the work (no PDF dependency), using the shared
       * .print-sheet rules in index.css (@page A4, thead repeats, rows never
       * split). Hidden on screen; .print-sheet becomes visible in print. Printing
       * only reads state — the page itself is never modified.
       */}
      {canPrint && (
        <div className="print-sheet hidden print:block">
          <div className="print-keep-colors border-b-2 border-slate-800 pb-2 text-center">
            <h2 className="text-lg font-bold uppercase">Bilbilash Secondary School Alumni Association</h2>
            <p className="text-sm font-semibold uppercase tracking-wide">Member Information</p>
            <p className="mt-1 text-xs">{scopeLabel} · {filtered.length} member(s)</p>
            <p className="text-xs">Printed on {printedAt}</p>
          </div>

          <div className="print-keep-colors mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]">
            {STATUS_ORDER.map((key) => (
              <span key={key} className="inline-flex items-center gap-1">
                <span
                  className="inline-block h-2.5 w-2.5 border border-slate-400"
                  style={{ backgroundColor: statusMeta(key).bg }}
                />
                <span>{statusMeta(key).label} ({counts[key]})</span>
              </span>
            ))}
          </div>

          <table className="print-keep-colors mt-3 w-full border-collapse text-[11px]">
            <thead>
              <tr>
                <th className="border border-slate-500 px-1.5 py-1 text-left font-semibold">#</th>
                <th className="border border-slate-500 px-1.5 py-1 text-left font-semibold">Member name</th>
                <th className="border border-slate-500 px-1.5 py-1 text-left font-semibold">Email</th>
                <th className="border border-slate-500 px-1.5 py-1 text-left font-semibold">SSC batch</th>
                <th className="border border-slate-500 px-1.5 py-1 text-left font-semibold">Profession</th>
                <th className="border border-slate-500 px-1.5 py-1 text-left font-semibold">Institute</th>
                <th className="border border-slate-500 px-1.5 py-1 text-left font-semibold">Payment status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => {
                const key = colourKeyOf(u);
                const meta = key ? statusMeta(key) : null;
                return (
                  <tr key={u.user_id} style={meta ? { backgroundColor: meta.bg } : undefined}>
                    <td className="border border-slate-500 px-1.5 py-1">{i + 1}</td>
                    <td className="border border-slate-500 px-1.5 py-1 font-medium">{u.first_name} {u.last_name}</td>
                    <td className="border border-slate-500 px-1.5 py-1">{u.email}</td>
                    <td className="border border-slate-500 px-1.5 py-1">{u.ssc_batch ?? '—'}</td>
                    <td className="border border-slate-500 px-1.5 py-1">{u.profession || '—'}</td>
                    <td className="border border-slate-500 px-1.5 py-1">{u.institute || '—'}</td>
                    <td className="border border-slate-500 px-1.5 py-1">{meta ? meta.label : 'Status unavailable'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedId !== null && <MemberDetailModal userId={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
