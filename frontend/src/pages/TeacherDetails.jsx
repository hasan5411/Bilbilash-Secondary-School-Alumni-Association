import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { Card, Spinner, Alert, EmptyState } from '../components/ui.jsx';
import TeacherPhoto from '../components/TeacherPhoto.jsx';

export default function TeacherDetails() {
  const { id } = useParams();
  const [teacher, setTeacher] = useState(null);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setNotFound(false); setTeacher(null);
    api.get(`/api/teachers/${id}`)
      .then((r) => { if (!cancelled) setTeacher(r.data.teacher); })
      .catch((e) => { if (!cancelled) (e.message === 'Teacher not found' ? setNotFound(true) : setError(e.message)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <Spinner />;

  if (notFound) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState title="Teacher not found." hint="This teacher may have been removed from the directory." />
        <div className="mt-4 text-center">
          <Link to="/teachers" className="text-sm font-semibold text-moss hover:underline">← Back to Teacher Directory</Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl">
        <Alert kind="error">{error}</Alert>
        <div className="mt-4 text-center">
          <Link to="/teachers" className="text-sm font-semibold text-moss hover:underline">← Back to Teacher Directory</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/teachers" className="mb-4 inline-block text-sm font-semibold text-moss hover:underline">
        ← Back to Teacher Directory
      </Link>
      <Card>
        <div className="flex flex-col gap-5 sm:flex-row">
          <TeacherPhoto teacher={teacher} className="h-56 w-full shrink-0 rounded-xl text-7xl sm:w-48" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-ink">{teacher.name}</h1>
            <p className="mt-1 text-ink-soft">
              {[teacher.subject, teacher.designation].filter(Boolean).join(' · ') || 'Teacher'}
            </p>
            {teacher.institution && <p className="mt-1 text-sm text-ink-soft">{teacher.institution}</p>}
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-ink-soft">Subject</dt><dd className="font-semibold text-ink">{teacher.subject || '—'}</dd></div>
              <div><dt className="text-ink-soft">Designation</dt><dd className="font-semibold text-ink">{teacher.designation || '—'}</dd></div>
              <div><dt className="text-ink-soft">Institution</dt><dd className="font-semibold text-ink">{teacher.institution || '—'}</dd></div>
              <div><dt className="text-ink-soft">Added to directory</dt><dd className="font-semibold text-ink">{teacher.created_at ? new Date(teacher.created_at).toLocaleDateString() : '—'}</dd></div>
            </dl>
          </div>
        </div>
        {teacher.description && (
          <div className="mt-5">
            <h2 className="mb-1 text-sm font-semibold text-ink">About</h2>
            <p className="whitespace-pre-wrap rounded-lg bg-mint p-4 text-sm text-ink-soft">{teacher.description}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
