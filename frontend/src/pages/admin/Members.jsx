import { mediaUrl } from '../../utils/format.js';
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
                {user.profile_photo
                  ? <img src={mediaUrl(user.profile_photo)} alt="" className="h-16 w-16 rounded-full object-cover" />
                  : <div className="flex h-16 w-16 items-center justify-center rounded-full bg-forest/10 text-xl font-black text-moss">{user.first_name?.[0]}{user.last_name?.[0]}</div>}
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

export default function Members() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    api.get('/api/users')
      .then((r) => setUsers(r.data.users))
      .catch((e) => setError(e.message));
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

  return (
    <div>
      <PageHeader title="Member Information" subtitle="Complete registered information for every account. Admin & Authority only." />

      {error && <Alert kind="error">{error}</Alert>}
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
                    {filtered.map((u) => (
                      <tr key={u.user_id} className="border-b last:border-0">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {u.profile_photo
                              ? <img src={mediaUrl(u.profile_photo)} alt="" className="h-9 w-9 rounded-full object-cover" />
                              : <div className="flex h-9 w-9 items-center justify-center rounded-full bg-forest/10 text-xs font-bold text-moss">{u.first_name?.[0]}{u.last_name?.[0]}</div>}
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
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </>
      )}

      {selectedId !== null && <MemberDetailModal userId={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
