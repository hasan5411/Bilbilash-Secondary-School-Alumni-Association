import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { Card, Input, Spinner, Alert, EmptyState, PageHeader } from '../components/ui.jsx';
import TeacherPhoto from '../components/TeacherPhoto.jsx';

export default function Teachers() {
  const [teachers, setTeachers] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    api.get('/api/teachers')
      .then((r) => setTeachers(r.data.teachers))
      .catch((e) => setError(e.message));
  }, []);

  // Client-side search over the fetched list; GET /api/teachers already returns everything needed.
  const query = q.trim().toLowerCase();
  const visible = useMemo(() => {
    const list = teachers || [];
    if (!query) return list;
    return list.filter((t) =>
      [t.name, t.subject, t.designation, t.institution].some((v) => String(v || '').toLowerCase().includes(query))
    );
  }, [teachers, query]);

  return (
    <div>
      <PageHeader title="Teacher Directory" subtitle="Honoring our respected teachers." />
      <div className="mb-5 max-w-md">
        <Input
          type="search"
          placeholder="Search teachers..."
          aria-label="Search teachers"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {!teachers && !error && <Spinner />}
      {teachers && teachers.length === 0 && <EmptyState title="No teachers listed yet." />}
      {teachers && teachers.length > 0 && visible.length === 0 && (
        <EmptyState title="No teachers found." hint="Try a different name, subject, designation or institution." />
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((t) => (
          <Link key={t.teacher_id} to={`/teachers/${t.teacher_id}`} className="group block">
            <Card className="flex h-full flex-row gap-4 transition group-hover:border-forest/50 group-hover:shadow-md">
              <TeacherPhoto teacher={t} className="h-auto min-h-40 w-2/5 shrink-0 self-stretch rounded-lg text-5xl" />
              <div className="flex min-w-0 flex-1 flex-col">
                <h2 className="font-bold text-ink">{t.name}</h2>
                <p className="text-sm text-ink-soft">{[t.subject, t.designation].filter(Boolean).join(' · ')}</p>
                {t.institution && <p className="mt-1 text-xs text-ink-soft">{t.institution}</p>}
                {t.description && <p className="mt-2 line-clamp-2 text-sm text-ink-soft">{t.description}</p>}
                <span className="mt-auto pt-3 text-sm font-semibold text-moss">View Profile →</span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
