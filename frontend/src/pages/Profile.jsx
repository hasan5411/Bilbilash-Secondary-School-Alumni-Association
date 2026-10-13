import { mediaUrl } from '../utils/format.js';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { Card, Input, Select, Textarea, Button, Spinner, Alert, PageHeader, BLOOD_GROUPS } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { completionColor } from '../utils/completion.js';

const taka = (n) => `৳${Number(n).toLocaleString('en-US')}`;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (key) => {
  const [y, m] = String(key).split('-').map(Number);
  return `${MONTH_NAMES[(m || 1) - 1]} ${y}`;
};
const curKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const shiftKey = (key, delta) => {
  const [y, m] = String(key).split('-').map(Number);
  const abs = y * 12 + (m - 1) + delta;
  return `${Math.floor(abs / 12)}-${String((abs % 12) + 1).padStart(2, '0')}`;
};

/**
 * Monthly Contribution card — THE member-facing surface for the authoritative
 * contribution service (/api/contributions/mine). Shows the configured rate
 * (or the exact "Monthly Contribution Not Set" state), lets the member set or
 * update it in any calendar month with an explicit effective month, and shows
 * the dues/extra/pending summary. Month-by-month detail and rate history live
 * on the Payments page instead. No amount is ever invented here: unknown
 * rates and unknown start months are shown as such.
 */
function ContributionCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [amount, setAmount] = useState('');
  const [effective, setEffective] = useState(curKey());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = () => api.get('/api/contributions/mine')
    .then((r) => {
      setData(r.data);
      setAmount(r.data.summary?.current_rate != null ? String(r.data.summary.current_rate) : '');
      setError('');
    })
    .catch((e) => {
      // Contribution API requires an approved MEMBER+ account — visitors simply
      // don't get the card instead of seeing a scary error.
      if (/permission|approved|role/i.test(e.message || '')) setDenied(true);
      else setError(e.message || 'Could not load contribution data.');
    });

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (window.location.hash === '#contribution') {
      document.getElementById('contribution')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [data]);

  if (denied) return null;

  const summary = data?.summary;
  const configured = !!data?.configured;
  const allowed = data?.allowed_amounts || [20, 30, 50, 100];
  const effectiveOptions = Array.from({ length: 13 }, (_, i) => shiftKey(curKey(), i));

  const submitRate = async (e) => {
    e.preventDefault();
    if (!amount) return setMsg({ kind: 'error', text: 'Choose a monthly contribution amount.' });
    setBusy(true); setMsg(null);
    try {
      const res = await api.post('/api/contributions/mine/rate', {
        amount: Number(amount), effective_month: effective,
      });
      setMsg({ kind: 'success', text: res.message });
      await load();
    } catch (err) { setMsg({ kind: 'error', text: err.message }); }
    finally { setBusy(false); }
  };

  return (
    <Card className="mt-4" >
      <div id="contribution" className="scroll-mt-24">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-bold text-ink">Monthly Contribution</h2>
            <p className="text-xs text-ink-soft">Used to calculate your monthly dues. Changes take effect from an explicit month — past months keep their historical rates.</p>
          </div>
          {configured && summary?.current_rate != null && (
            <div className="rounded-lg bg-forest/10 px-3 py-1.5 text-right">
              <div className="text-lg font-black text-moss">{taka(summary.current_rate)}</div>
              <div className="text-[11px] text-ink-soft">
                effective {summary.current_rate_effective_month ? monthLabel(summary.current_rate_effective_month) : monthLabel(curKey())}
              </div>
            </div>
          )}
        </div>

        {!configured && (
          <Alert kind="info">
            <b>Monthly Contribution Not Set.</b> Please set your monthly contribution amount to enable accurate
            monthly payment and due calculations.
          </Alert>
        )}
        {msg && <div className="mt-3"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
        {error && <div className="mt-3"><Alert kind="error">{error}</Alert></div>}

        {/* ---- set / update ---- */}
        <form onSubmit={submitRate} className="mt-4 rounded-lg bg-mint p-3">
          <span className="mb-1 block text-sm font-medium text-ink">
            {configured ? 'Update monthly contribution' : 'Set monthly contribution'}
          </span>
          <div className="flex flex-wrap gap-2">
            {allowed.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAmount(String(a))}
                className={`rounded-lg border px-4 py-2 text-sm font-bold transition ${
                  amount === String(a) ? 'border-forest bg-forest text-white' : 'border-line bg-white text-ink hover:border-forest/50'
                }`}
              >
                {taka(a)}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="w-44">
              <Select label="Effective from" value={effective} onChange={(e) => setEffective(e.target.value)}>
                {effectiveOptions.map((k) => <option key={k} value={k}>{monthLabel(k)}</option>)}
              </Select>
            </div>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : configured ? 'Update contribution' : 'Set contribution'}</Button>
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            {configured
              ? 'A new history record is created for the effective month — previous months and their dues are never rewritten.'
              : 'Effective month can never be in the past, so no historical month is ever charged retroactively.'}
          </p>
        </form>

        {/* ---- obligation start + summary ---- */}
        {summary && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-mint p-2.5">
              <div className="text-[11px] uppercase tracking-wide text-ink-soft">Outstanding due</div>
              <div className="font-black text-ink">{summary.start_unknown ? '—' : taka(summary.total_due)}</div>
              <div className="text-[11px] text-ink-soft">{summary.due_month_count} month(s)</div>
            </div>
            <div className="rounded-lg bg-mint p-2.5">
              <div className="text-[11px] uppercase tracking-wide text-ink-soft">Extra contributed</div>
              <div className="font-black text-ink">{taka(summary.total_extra)}</div>
              <div className="text-[11px] text-ink-soft">above dues</div>
            </div>
            <div className="rounded-lg bg-mint p-2.5">
              <div className="text-[11px] uppercase tracking-wide text-ink-soft">Awaiting verification</div>
              <div className="font-black text-ink">{taka(summary.pending_amount)}</div>
              <div className="text-[11px] text-ink-soft">not counted as paid</div>
            </div>
            <div className="rounded-lg bg-mint p-2.5">
              <div className="text-[11px] uppercase tracking-wide text-ink-soft">Contribution start</div>
              <div className="font-black text-ink">{summary.start_month ? monthLabel(summary.start_month) : 'Unknown'}</div>
              <div className="text-[11px] text-ink-soft">
                {summary.start_unknown ? 'not guessed — ask an admin' : `source: ${String(summary.start_source).replace(/_/g, ' ')}`}
              </div>
            </div>
          </div>
        )}
        {summary?.start_unknown && (
          <div className="mt-3"><Alert kind="info">Your contribution start month is unknown, so dues are reported as unknown instead of being guessed. An administrator can set it.</Alert></div>
        )}
        {summary?.rate_not_set_months?.length > 0 && (
          <div className="mt-3"><Alert kind="info">
            <b>Rate not set</b> for {summary.rate_not_set_months.map(monthLabel).join(', ')} — these months are excluded from the money total until a rate is configured.
          </Alert></div>
        )}

      </div>
    </Card>
  );
}

/**
 * Profile Completion — compact indicator at the top of the Profile page.
 * The percentage is always computed by the backend from SAVED profile data
 * and arrives with every profile GET/PUT response (`profile_completion`), so
 * it refreshes on page load and immediately after a successful save without
 * any extra API call. Contains only: label, percentage, progress bar.
 * Returns null when no percentage is available (no required fields configured).
 */
function CompletionIndicator({ percent }) {
  if (percent == null || !Number.isFinite(Number(percent))) return null;
  const value = Math.max(0, Math.min(100, Math.round(Number(percent))));
  const color = completionColor(value);
  return (
    <div className="mb-4" data-testid="profile-completion">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink">Profile Completion</span>
        <span className="text-sm font-bold" style={{ color }} data-testid="profile-completion-percent">{value}%</span>
      </div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-label="Profile completion"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${value}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export default function Profile() {
  const { refreshUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(null);
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    api.get('/api/profile')
      .then((r) => {
        setProfile(r.data.profile);
        setForm({
          first_name: r.data.profile.first_name, last_name: r.data.profile.last_name,
          phone: r.data.profile.phone || '', registration_number: r.data.profile.registration_number || '',
          ssc_batch: r.data.profile.ssc_batch || '',
          blood_group: r.data.profile.blood_group || '', active_donor: r.data.profile.active_donor ? 'yes' : 'no', profession: r.data.profile.profession || '',
          institute: r.data.profile.institute || '', present_address: r.data.profile.present_address || '',
          permanent_address: r.data.profile.permanent_address || '', bio: r.data.profile.bio || '',
          facebook_url: r.data.profile.facebook_url || '',
        });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v ?? ''));
      // active_donor needs an explicit 'true'/'false' — FormData strings would
      // otherwise serialize 'yes'/'no' which the backend validator rejects.
      fd.set('active_donor', form.active_donor === 'yes' ? 'true' : 'false');
      if (file) fd.append('image', file);
      const res = await api.putForm('/api/profile', fd);
      setProfile(res.data.profile);
      setMsg({ kind: 'success', text: res.message });
      refreshUser();
    } catch (err) { setMsg({ kind: 'error', text: err.message }); }
    finally { setBusy(false); }
  };

  if (loading) return <Spinner />;
  if (error) return <Alert kind="error">{error}</Alert>;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="My Account" subtitle="Update your personal information." />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <Card className="mt-3">
        <CompletionIndicator percent={profile.profile_completion} />
        <div className="mb-4 flex items-center gap-4">
          {profile.profile_photo
            ? <img src={mediaUrl(profile.profile_photo)} alt="" className="h-16 w-16 rounded-full object-cover" />
            : <div className="flex h-16 w-16 items-center justify-center rounded-full bg-forest/10 text-xl font-black text-moss">{profile.first_name[0]}{profile.last_name[0]}</div>}
          <div>
            <div className="font-bold text-ink">{profile.first_name} {profile.last_name}</div>
            <div className="text-sm text-ink-soft">{profile.email}</div>
            <div className="text-xs text-ink-soft">Role: {profile.role} · Status: {profile.status}</div>
          </div>
          {profile.blood_group && (
            <div className="flex flex-col items-center">
              <span className="rounded-full bg-red-50 px-3 py-1 font-bold text-red-600">{profile.blood_group}</span>
              {!!profile.active_donor && <span className="mt-0.5 whitespace-nowrap text-[11px] font-medium text-red-500">🩸 Active Donor</span>}
            </div>
          )}
        </div>

        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Input label="First name *" required value={form.first_name} onChange={set('first_name')} />
          <Input label="Last name *" required value={form.last_name} onChange={set('last_name')} />
          <Input label="Phone" value={form.phone} onChange={set('phone')} />
          <Input label="Registration Number *" placeholder="Your academic registration number" required maxLength={50} value={form.registration_number} onChange={set('registration_number')} />
          <Input label="SSC batch" type="number" value={form.ssc_batch} onChange={set('ssc_batch')} />
          <Select label="Blood group" value={form.blood_group} onChange={set('blood_group')}>
            <option value="">— Select —</option>
            {BLOOD_GROUPS.map((b) => <option key={b}>{b}</option>)}
          </Select>
          <Select label="Active Blood Donor" value={form.active_donor} onChange={set('active_donor')}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </Select>
          <Input label="Profession" value={form.profession} onChange={set('profession')} />
          <Input label="Institute" value={form.institute} onChange={set('institute')} />
          <Input label="Present Address *" placeholder="Your current residential address" required maxLength={255} value={form.present_address} onChange={set('present_address')} />
          <Input label="Permanent Address *" placeholder="Your permanent/home address" required maxLength={255} value={form.permanent_address} onChange={set('permanent_address')} />
          <div className="sm:col-span-2"><Textarea label="Bio" value={form.bio} onChange={set('bio')} /></div>
          <div className="sm:col-span-2">
            <Input
              label="Facebook Profile Link (optional)"
              type="url"
              placeholder="https://www.facebook.com/your.username"
              maxLength={255}
              value={form.facebook_url}
              onChange={set('facebook_url')}
            />
            <p className="mt-1 text-xs text-ink-soft">Shown on your public profile. Leave empty to hide the Facebook button.</p>
          </div>
          <div className="sm:col-span-2">
            <span className="mb-1 block text-sm font-medium text-ink">Profile photo (JPG/PNG/WEBP/GIF, max 3 MB)</span>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => setFile(e.target.files[0])}
              className="rounded-lg border border-line px-3 py-2 text-sm" />
          </div>
          <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button></div>
        </form>
      </Card>

      <ContributionCard />
    </div>
  );
}
