import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { Card, Button, Spinner, Alert, EmptyState, PageHeader } from '../../components/ui.jsx';

const fmtDateTime = (d) =>
  d
    ? new Date(String(d).replace(' ', 'T')).toLocaleString('en-US', {
        day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : '—';

export default function PollsManage() {
  const [polls, setPolls] = useState(null);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [voters, setVoters] = useState({});

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
    try {
      const res = await api.del(`/api/polls/${p.poll_id}`);
      setMsg({ kind: 'success', text: res.message });
      if (openId === p.poll_id) setOpenId(null);
      setVoters((prev) => {
        const next = { ...prev };
        delete next[p.poll_id];
        return next;
      });
      load();
    } catch (e) { setMsg({ kind: 'error', text: e.message }); }
  };

  const toggleVoters = async (p) => {
    if (openId === p.poll_id) { setOpenId(null); return; }
    setOpenId(p.poll_id);
    if (voters[p.poll_id]?.data) return;
    setVoters((prev) => ({ ...prev, [p.poll_id]: { loading: true } }));
    try {
      const r = await api.get(`/api/polls/${p.poll_id}/voters`);
      setVoters((prev) => ({ ...prev, [p.poll_id]: { data: r.data } }));
    } catch (e) {
      setVoters((prev) => ({ ...prev, [p.poll_id]: { error: e.message } }));
    }
  };

  return (
    <div>
      <PageHeader title="Manage Polls" subtitle="Open polls accept one vote per member. See who voted, close a poll, or delete it." />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      {!polls && !error && <Spinner />}
      {polls && polls.length === 0 && <EmptyState title="No polls yet. Create one from the Polls page." />}
      <div className="space-y-3">
        {(polls || []).map((p) => {
          const total = p.options.reduce((s, o) => s + Number(o.votes || 0), 0);
          const v = voters[p.poll_id];
          return (
            <Card key={p.poll_id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-bold text-ink">{p.question}</h3>
                  <p className="text-xs text-ink-soft">
                    {p.status.toUpperCase()} · {total} vote(s) · {p.options.map((o) => `${o.option_text}: ${o.votes}`).join(' · ')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" className="!px-3 !py-1.5 text-xs" onClick={() => toggleVoters(p)}>
                    {openId === p.poll_id ? 'Hide voters' : `View voters (${total})`}
                  </Button>
                  {p.status === 'open' && <Button variant="outline" className="!px-3 !py-1.5 text-xs" onClick={() => close(p.poll_id)}>Close</Button>}
                  <Button variant="danger" className="!px-3 !py-1.5 text-xs" onClick={() => remove(p)}>Delete</Button>
                </div>
              </div>

              {openId === p.poll_id && (
                <div className="mt-3 border-t border-line pt-3">
                  {v?.loading && <Spinner />}
                  {v?.error && <Alert kind="error">{v.error}</Alert>}
                  {v?.data && (v.data.voters.length === 0 ? (
                    <p className="text-sm text-ink-soft">No votes yet.</p>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-soft">
                              <th className="py-2 pr-3">Member</th>
                              <th className="py-2 pr-3">Vote</th>
                              <th className="py-2">Voted at</th>
                            </tr>
                          </thead>
                          <tbody>
                            {v.data.voters.map((row) => (
                              <tr key={row.user_id} className="border-b border-line/60 last:border-0">
                                <td className="py-2 pr-3">
                                  {`${row.first_name || ''} ${row.last_name || ''}`.trim() || `Member #${row.user_id}`}
                                </td>
                                <td className="py-2 pr-3">{row.option_text}</td>
                                <td className="py-2 text-ink-soft">{fmtDateTime(row.created_at)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="mt-2 text-xs text-ink-soft">{v.data.total} member(s) voted.</p>
                    </>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
