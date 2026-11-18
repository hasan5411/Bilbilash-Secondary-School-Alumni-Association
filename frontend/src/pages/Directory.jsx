import Avatar from '../components/Avatar.jsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { Card, Input, Select, Button, Spinner, Alert, EmptyState, PageHeader, BLOOD_GROUPS } from '../components/ui.jsx';

const PAGE_SIZE = 24;

const isStudent = (profession) => (profession || '').trim().toLowerCase() === 'student';

/** Students show their education (university, else college); everyone shows institute. */
function affiliation(m) {
  if (!isStudent(m.profession)) return (m.institute || '').trim();
  return (m.university || '').trim() || (m.college || '').trim() || (m.institute || '').trim();
}

export default function Directory() {
  const [form, setForm] = useState({ name: '', batch: '', profession: '', institute: '', address: '', blood_group: '' });
  const [results, setResults] = useState(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const searchSeq = useRef(0);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef(null);

  const buildParams = (offset) => {
    const params = new URLSearchParams();
    Object.entries(form).forEach(([k, v]) => { if (v) params.set(k, v); });
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    return params;
  };

  const doSearch = async (e) => {
    if (e) e.preventDefault();
    const seq = ++searchSeq.current;
    loadingMoreRef.current = false;
    setLoading(true); setError(''); setResults(null); setTotal(0); setHasMore(false);
    try {
      const res = await api.get(`/api/directory?${buildParams(0).toString()}`);
      if (seq !== searchSeq.current) return;
      setResults(res.data.results);
      setTotal(res.data.total ?? res.data.results.length);
      setHasMore(!!res.data.has_more);
    } catch (err) {
      if (seq === searchSeq.current) setError(err.message);
    } finally {
      if (seq === searchSeq.current) setLoading(false);
    }
  };

  // Append the next page; stale responses from an old search are dropped.
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    const seq = searchSeq.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const res = await api.get(`/api/directory?${buildParams(results?.length || 0).toString()}`);
      if (seq !== searchSeq.current) return;
      setResults((prev) => {
        const seen = new Set((prev || []).map((r) => r.user_id));
        return [...(prev || []), ...res.data.results.filter((r) => !seen.has(r.user_id))];
      });
      setTotal(res.data.total ?? 0);
      setHasMore(!!res.data.has_more);
    } catch (err) {
      if (seq === searchSeq.current) setError(err.message);
    } finally {
      loadingMoreRef.current = false;
      if (seq === searchSeq.current) setLoadingMore(false);
    }
  }, [hasMore, results, form]);

  useEffect(() => { doSearch(); }, []);

  // Pull the next batch a little before the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading || loadingMore) return undefined;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((entry) => entry.isIntersecting)) loadMore(); },
      { rootMargin: '300px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, loadMore]);

  return (
    <div>
      <PageHeader title="Alumni Directory" subtitle="Search approved alumni. Contact details stay private." />
      <Card className="mb-5">
        <form onSubmit={doSearch} className="grid gap-3 sm:grid-cols-3">
          <Input label="Name" value={form.name} onChange={set('name')} placeholder="e.g. Hasan" />
          <Input label="SSC batch (year)" type="number" value={form.batch} onChange={set('batch')} placeholder="e.g. 2015" />
          <Select label="Blood group" value={form.blood_group} onChange={set('blood_group')}>
            <option value="">— Any —</option>
            {BLOOD_GROUPS.map((b) => <option key={b}>{b}</option>)}
          </Select>
          <Input label="Profession" value={form.profession} onChange={set('profession')} placeholder="e.g. Engineer" />
          <Input
            label="Institute / Company / College / University"
            value={form.institute}
            onChange={set('institute')}
            placeholder="e.g. BUET, Unilever"
          />
          <Input
            label="Address (present)"
            value={form.address}
            onChange={set('address')}
            placeholder="e.g. Dhanmondi, Dhaka"
          />
          <div className="flex items-end"><Button type="submit" disabled={loading} className="w-full">{loading ? 'Searching…' : 'Search'}</Button></div>
        </form>
      </Card>

      {loading && <Spinner />}
      {error && <Alert kind="error">{error}</Alert>}
      {results && results.length === 0 && !loading && !error && (
        <EmptyState title="No alumni matched your search." hint="Try fewer filters." />
      )}
      {results && results.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((m) => {
              const detail = affiliation(m);
              return (
              <Link key={m.user_id} to={`/directory/${m.user_id}`}>
                <Card className="h-full transition hover:shadow-md">
                  <div className="flex items-center gap-3">
                    <Avatar name={`${m.first_name || ''} ${m.last_name || ''}`} photoRef={m.profile_photo} className="h-11 w-11" />
                    <div>
                      <div className="font-semibold text-ink">{m.first_name} {m.last_name}</div>
                      <div className="text-xs text-ink-soft">SSC {m.ssc_batch ?? '—'}</div>
                    </div>
                    {m.blood_group && (
                      <div className="ml-auto flex flex-col items-center">
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-600">{m.blood_group}</span>
                        {!!m.active_donor && <span className="mt-0.5 whitespace-nowrap text-[10px] font-medium text-red-500">🩸 Active Donor</span>}
                      </div>
                    )}
                  </div>
                  <p className="mt-3 text-sm text-ink-soft">{m.profession || 'Profession not set'}{detail ? ` · ${detail}` : ''}</p>
                </Card>
              </Link>
              );
            })}
          </div>
          {hasMore ? (
            <div ref={sentinelRef} className="flex justify-center py-6">
              {loadingMore
                ? <Spinner />
                : <span className="text-sm text-ink-soft">Scroll to load more ({results.length} of {total})</span>}
            </div>
          ) : (
            <p className="py-4 text-center text-xs text-ink-soft">Showing all {total} member(s).</p>
          )}
        </>
      )}
    </div>
  );
}
