import { mediaUrl } from '../utils/format.js';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { Card, Input, Select, Button, Spinner, Alert, EmptyState, PageHeader, BLOOD_GROUPS } from '../components/ui.jsx';

export default function Directory() {
  const [form, setForm] = useState({ name: '', batch: '', profession: '', institute: '', blood_group: '' });
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const doSearch = async (e) => {
    if (e) e.preventDefault();
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      Object.entries(form).forEach(([k, v]) => { if (v) params.set(k === 'batch' ? 'batch' : k, v); });
      const res = await api.get(`/api/directory?${params.toString()}`);
      setResults(res.data.results);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { doSearch(); }, []);

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
          <Input label="Institute" value={form.institute} onChange={set('institute')} placeholder="e.g. BUET" />
          <div className="flex items-end"><Button type="submit" disabled={loading} className="w-full">{loading ? 'Searching…' : 'Search'}</Button></div>
        </form>
      </Card>

      {loading && <Spinner />}
      {error && <Alert kind="error">{error}</Alert>}
      {results && !loading && !error && (
        results.length === 0
          ? <EmptyState title="No alumni matched your search." hint="Try fewer filters." />
          : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((m) => (
                <Link key={m.user_id} to={`/directory/${m.user_id}`}>
                  <Card className="h-full transition hover:shadow-md">
                    <div className="flex items-center gap-3">
                      {m.profile_photo
                        ? <img src={mediaUrl(m.profile_photo)} alt="" className="h-11 w-11 rounded-full object-cover" />
                        : <div className="flex h-11 w-11 items-center justify-center rounded-full bg-forest/10 font-bold text-moss">{m.first_name?.[0]}{m.last_name?.[0]}</div>}
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
                    <p className="mt-3 text-sm text-ink-soft">{m.profession || 'Profession not set'}{m.institute ? ` · ${m.institute}` : ''}</p>
                  </Card>
                </Link>
              ))}
            </div>
          )
      )}
    </div>
  );
}
