import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { Card, Button, Spinner, Alert, EmptyState, PageHeader } from '../../components/ui.jsx';

export default function Approvals() {
  const [pending, setPending] = useState(null);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get('/api/users/pending')
      .then((r) => setPending(r.data.users))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (id, action) => {
    setMsg(null);
    try {
      const res = await api.put(`/api/users/${id}/${action}`);
      setMsg({ kind: 'success', text: res.message });
      load();
    } catch (e) { setMsg({ kind: 'error', text: e.message }); }
  };

  return (
    <div>
      <PageHeader title="Member Approvals" subtitle="Review pending registrations. Approved users become Members." />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      {!pending && !error && <Spinner />}
      {pending && pending.length === 0 && <EmptyState title="No pending registrations." />}
      <div className="grid gap-4 md:grid-cols-2">
        {(pending || []).map((u) => (
          <Card key={u.user_id}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-ink">{u.first_name} {u.last_name}</h3>
                <p className="text-sm text-ink-soft">{u.email}{u.phone ? ` · ${u.phone}` : ''}</p>
                <p className="mt-1 text-xs text-ink-soft">SSC {u.ssc_batch ?? '—'} · {u.blood_group ?? 'no blood group'} · {u.profession || '—'}</p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button onClick={() => act(u.user_id, 'approve')}>Approve</Button>
              <Button variant="danger" onClick={() => act(u.user_id, 'reject')}>Reject</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
