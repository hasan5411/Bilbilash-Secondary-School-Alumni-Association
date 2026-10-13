import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { Card, Button, Spinner, Alert, EmptyState, PageHeader } from '../../components/ui.jsx';

export default function PollsManage() {
  const [polls, setPolls] = useState(null);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get('/api/polls').then((r) => setPolls(r.data.polls)).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const close = async (id) => {
    try { await api.put(`/api/polls/${id}/close`); load(); }
    catch (e) { alert(e.message); }
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete poll "${p.question}"? All votes are removed too. This cannot be undone.`)) return;
    setMsg(null);
    try { const res = await api.del(`/api/polls/${p.poll_id}`); setMsg({ kind: 'success', text: res.message }); load(); }
    catch (e) { setMsg({ kind: 'error', text: e.message }); }
  };

  return (
    <div>
      <PageHeader title="Manage Polls" subtitle="Open polls accept one vote per member. Create new polls from the Polls page." />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      {!polls && !error && <Spinner />}
      {polls && polls.length === 0 && <EmptyState title="No polls yet. Create one from the Polls page." />}
      <div className="space-y-3">
        {(polls || []).map((p) => (
          <Card key={p.poll_id} className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-ink">{p.question}</h3>
              <p className="text-xs text-ink-soft">{p.options.map((o) => `${o.option_text}: ${o.votes}`).join(' · ')}</p>
            </div>
            <div className="flex items-center gap-2">
              {p.status === 'open' && <Button variant="outline" className="!px-3 !py-1.5 text-xs" onClick={() => close(p.poll_id)}>Close</Button>}
              <Button variant="danger" className="!px-3 !py-1.5 text-xs" onClick={() => remove(p)}>Delete</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
