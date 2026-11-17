import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { Spinner, Alert, EmptyState } from '../components/ui.jsx';

export default function Notices() {
  const [notices, setNotices] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/notices')
      .then((r) => setNotices(r.data.notices))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="mx-auto max-w-4xl">
      {/* Header — restrained, with a single green accent rule. */}
      <header className="mb-8 border-b border-line pb-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="h-[3px] w-8 rounded-full bg-forest" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-moss">Announcements</span>
          </div>
          {notices && notices.length > 0 && (
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
              {notices.length} {notices.length === 1 ? 'notice' : 'notices'}
            </span>
          )}
        </div>
        <h1 className="mt-3 text-[26px] font-semibold leading-tight tracking-tight text-forest sm:text-3xl">Noticeboard</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">Official announcements from the association.</p>
      </header>

      {error && <Alert kind="error">{error}</Alert>}
      {!notices && !error && <Spinner />}
      {notices && notices.length === 0 && <EmptyState title="No notices published yet." />}

      {notices && notices.length > 0 && (
        <ol className="space-y-3.5">
          {notices.map((n) => {
            const when = n.published_at || n.created_at;
            return (
              <li key={n.notice_id}>
                <article className="group rounded-2xl border border-l-[3px] border-line border-l-moss bg-white px-5 py-5 shadow-[0_1px_2px_rgba(15,76,58,0.05)] transition duration-200 ease-out hover:-translate-y-0.5 hover:border-l-forest hover:shadow-[0_10px_28px_-16px_rgba(15,76,58,0.45)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:px-6">
                  <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                    <h2 className="min-w-0 break-words text-[17px] font-semibold leading-snug tracking-[-0.01em] text-ink transition-colors duration-200 group-hover:text-forest motion-reduce:transition-none sm:text-lg">
                      {n.title}
                    </h2>
                    <time
                      dateTime={when}
                      className="shrink-0 self-start whitespace-nowrap rounded-md bg-mint px-2.5 py-1 text-[11px] font-medium tracking-wide text-moss tabular-nums"
                    >
                      {new Date(when).toLocaleDateString()}
                    </time>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-7 text-ink-soft">{n.body}</p>
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
