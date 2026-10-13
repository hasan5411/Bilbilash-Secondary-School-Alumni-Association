import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { Card, Button, Spinner, Alert, EmptyState, PageHeader, Badge } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Events() {
  const { user, isMember } = useAuth();
  const [events, setEvents] = useState(null);
  const [mine, setMine] = useState({});
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [evRes, regRes] = await Promise.all([
        api.get('/api/events'),
        api.get('/api/events/mine/registrations').catch(() => ({ data: { registrations: [] } })),
      ]);
      setEvents(evRes.data.events);
      const map = {};
      regRes.data.registrations.forEach((r) => { map[r.event_id] = true; });
      setMine(map);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (eventId, action) => {
    setMsg(null);
    try {
      const res = action === 'register'
        ? await api.post(`/api/events/${eventId}/register`)
        : await api.del(`/api/events/${eventId}/register`);
      setMsg({ kind: 'success', text: res.message });
      load();
    } catch (e) { setMsg({ kind: 'error', text: e.message }); }
  };

  return (
    <div>
      <PageHeader title="Events" subtitle="Reunions, seminars, and community gatherings.">
        <Link to="/my-registrations" className="text-sm font-semibold text-moss hover:underline">My registrations →</Link>
      </PageHeader>

      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      {loading && <Spinner />}
      {events && events.length === 0 && <EmptyState title="No upcoming events." />}

      <div className="grid gap-4 md:grid-cols-2">
        {(events || []).map((ev) => {
          const isFull = ev.registration_count >= ev.capacity;
          const registered = mine[ev.event_id];
          return (
            <Card key={ev.event_id}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-ink">{ev.title}</h3>
                  <p className="text-sm text-ink-soft">📅 {ev.event_date}{ev.start_time ? ` · 🕒 ${ev.start_time.slice(0, 5)}` : ''}{ev.location ? ` · 📍 ${ev.location}` : ''}</p>
                </div>
                <Badge value={ev.status} />
              </div>
              {ev.description && <p className="mt-2 line-clamp-2 text-sm text-ink-soft">{ev.description}</p>}
              <div className="mt-3 flex items-center justify-between">
                <span className={`text-xs font-semibold ${isFull ? 'text-red-500' : 'text-ink-soft'}`}>
                  {ev.registration_count}/{ev.capacity} registered{isFull ? ' · FULL' : ''}
                </span>
                {isMember && !['cancelled', 'completed'].includes(ev.status) && (
                  registered
                    ? <Button variant="outline" onClick={() => act(ev.event_id, 'unregister')}>Cancel registration</Button>
                    : <Button onClick={() => act(ev.event_id, 'register')} disabled={isFull}>{isFull ? 'Full' : 'Register'}</Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
