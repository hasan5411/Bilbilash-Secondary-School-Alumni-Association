import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { Card, Spinner, Alert, EmptyState, PageHeader } from '../components/ui.jsx';

export default function MyEventRegistrations() {
  const [regs, setRegs] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/events/mine/registrations').then((r) => setRegs(r.data.registrations)).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <PageHeader title="My Event Registrations" />
      {error && <Alert kind="error">{error}</Alert>}
      {!regs && !error && <Spinner />}
      {regs && regs.length === 0 && <EmptyState title="You have not registered for any events." />}
      <div className="grid gap-4 md:grid-cols-2">
        {(regs || []).map((r) => (
          <Card key={r.event_id}>
            <h3 className="font-bold text-ink">{r.title}</h3>
            <p className="text-sm text-ink-soft">📅 {r.event_date}{r.start_time ? ` · ${r.start_time.slice(0, 5)}` : ''}{r.location ? ` · ${r.location}` : ''}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
