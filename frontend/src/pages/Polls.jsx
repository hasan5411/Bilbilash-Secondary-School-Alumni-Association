import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { Card, Input, Button, Spinner, Alert, EmptyState, PageHeader } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Polls() {
  const { isAdmin } = useAuth();
  const [polls, setPolls] = useState(null);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState('');
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get('/api/polls'); setPolls(r.data.polls); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const res = await api.post('/api/polls', { question, options });
      setMsg({ kind: 'success', text: res.message });
      setQuestion(''); setOptions('');
      load();
    } catch (err) { setMsg({ kind: 'error', text: err.message }); }
    finally { setBusy(false); }
  };

  const vote = async (pollId, optionId) => {
    setMsg(null);
    try { await api.post(`/api/polls/${pollId}/vote`, { option_id: optionId }); load(); }
    catch (e) { setMsg({ kind: 'error', text: e.message }); }
  };

  const close = async (pollId) => {
    try { await api.put(`/api/polls/${pollId}/close`); load(); }
    catch (e) { alert(e.message); }
  };

  return (
    <div>
      <PageHeader title="Community Polls" subtitle="One vote per member per poll." />

      {isAdmin && (
        <Card className="mb-5">
          <h3 className="mb-3 font-bold text-ink">Create a poll</h3>
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
          <form onSubmit={create} className="mt-2 space-y-3">
            <Input label="Question *" required value={question} onChange={(e) => setQuestion(e.target.value)} />
            <Input label="Options * (separate with |)" required value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Yes | No | Maybe" />
            <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create poll'}</Button>
          </form>
        </Card>
      )}

      {loading && <Spinner />}
      {error && <Alert kind="error">{error}</Alert>}
      {polls && polls.length === 0 && <EmptyState title="No polls open right now." />}

      <div className="space-y-4">
        {(polls || []).map((p) => {
          const total = p.options.reduce((s, o) => s + o.votes, 0);
          return (
            <Card key={p.poll_id}>
              <div className="flex items-start justify-between">
                <h3 className="font-bold text-ink">{p.question}</h3>
                <span className={`text-xs font-semibold ${p.status === 'open' ? 'text-emerald-600' : 'text-ink-soft'}`}>{p.status.toUpperCase()}</span>
              </div>
              <div className="mt-3 space-y-2">
                {p.options.map((o) => {
                  const pct = total ? Math.round((o.votes / total) * 100) : 0;
                  const mine = p.my_vote_option_id === o.option_id;
                  return (
                    <div key={o.option_id}>
                      <button
                        disabled={p.status !== 'open' || p.my_vote_option_id}
                        onClick={() => vote(p.poll_id, o.option_id)}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition disabled:cursor-default ${mine ? 'border-forest bg-forest/10 font-semibold' : 'border-line hover:border-forest/40'}`}>
                        <div className="flex justify-between">
                          <span>{o.option_text} {mine && '✓'}</span>
                          <span className="text-xs text-ink-soft">{o.votes} vote(s) · {pct}%</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full rounded bg-mist">
                          <div className="h-1.5 rounded bg-forest" style={{ width: `${pct}%` }} />
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 text-xs text-ink-soft">{total} total vote(s)</div>
              {isAdmin && p.status === 'open' && (
                <Button variant="ghost" className="mt-2 !px-2 !py-1 text-xs" onClick={() => close(p.poll_id)}>Close poll</Button>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
