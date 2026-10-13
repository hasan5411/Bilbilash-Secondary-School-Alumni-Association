import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { Card, Spinner, Alert, EmptyState, PageHeader, Badge } from '../components/ui.jsx';

export default function MyApplications() {
  const [apps, setApps] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/jobs/mine/applications').then((r) => setApps(r.data.applications)).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <PageHeader title="My Job Applications" />
      {error && <Alert kind="error">{error}</Alert>}
      {!apps && !error && <Spinner />}
      {apps && apps.length === 0 && <EmptyState title="You have not applied to any jobs yet." hint="Browse the Job Board." />}
      <div className="space-y-3">
        {(apps || []).map((a) => (
          <Card key={a.application_id} className="flex items-center justify-between">
            <div>
              <Link to={`/jobs/${a.job_id}`} className="font-semibold text-ink hover:text-moss">{a.title}</Link>
              <p className="text-sm text-ink-soft">{a.company}</p>
              <p className="mt-1 text-xs text-ink-soft">Applied {new Date(a.created_at).toLocaleDateString()}</p>
            </div>
            <Badge value={a.status} />
          </Card>
        ))}
      </div>
    </div>
  );
}
