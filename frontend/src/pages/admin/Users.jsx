import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { Button, Spinner, Alert, PageHeader, Badge, EmptyState } from '../../components/ui.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export default function Users() {
  const { isAuthority, user: me } = useAuth();
  const [users, setUsers] = useState(null);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get('/api/users')
      .then((r) => setUsers(r.data.users))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (id, action, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setMsg(null);
    try {
      const res = await api.put(`/api/users/${id}/${action}`);
      setMsg({ kind: 'success', text: res.message });
      load();
    } catch (e) { setMsg({ kind: 'error', text: e.message }); }
  };

  const remove = async (u) => {
    if (!window.confirm(`Delete ${u.first_name} ${u.last_name}? This permanently removes the account and profile. Contribution-rate attribution and audit history are retained; accounts with payment history can't be deleted — deactivate them instead.`)) return;
    setMsg(null);
    try {
      const res = await api.del(`/api/users/${u.user_id}`);
      setMsg({ kind: 'success', text: res.message });
      load();
    } catch (e) {
      // Blocked deletions (409) carry the exact remaining dependency from the
      // backend (e.g. "3 payment record(s) totalling ৳150") — show it verbatim.
      setMsg({ kind: 'error', text: e.message });
      load(); // refresh so the list reflects any partial-failure state
    }
  };

  return (
    <div>
      <PageHeader title="All Users" subtitle={isAuthority ? 'Authority view: promote members to Admin (max 100) and demote Admins.' : 'Manage community accounts.'} />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      {!users && !error && <Spinner />}
      {users && users.length === 0 && <EmptyState title="No users." />}

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b bg-mint text-left text-xs uppercase text-ink-soft">
              <th className="px-4 py-3">Name</th><th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(users || []).map((u) => (
              <tr key={u.user_id} className="border-b last:border-0">
                <td className="px-4 py-3 font-medium text-ink">{u.first_name} {u.last_name}{u.user_id === me.user_id && <span className="ml-1 text-xs text-moss">(you)</span>}</td>
                <td className="px-4 py-3 text-ink-soft">{u.email}</td>
                <td className="px-4 py-3"><Badge value={u.role} /></td>
                <td className="px-4 py-3"><Badge value={u.status} /></td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {isAuthority && u.role === 'MEMBER' && u.status === 'approved' && (
                      <Button variant="sun" className="!px-2 !py-1 text-xs" onClick={() => act(u.user_id, 'promote-admin', `Promote ${u.first_name} to Admin?`)}>Promote to Admin</Button>
                    )}
                    {isAuthority && u.role === 'ADMIN' && (
                      <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={() => act(u.user_id, 'demote-admin', `Demote ${u.first_name} to Member?`)}>Demote</Button>
                    )}
                    {u.status !== 'inactive' && u.role !== 'AUTHORITY' && u.user_id !== me.user_id && (
                      <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => act(u.user_id, 'deactivate', `Deactivate ${u.first_name}? The account keeps all history and can be reactivated later.`)}>Deactivate</Button>
                    )}
                    {u.user_id !== me.user_id && u.role !== 'AUTHORITY' && (u.role !== 'ADMIN' || isAuthority) && (
                      <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={() => remove(u)}>Delete</Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
