import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Card, Input, Select, Button, Alert, BLOOD_GROUPS } from '../components/ui.jsx';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', password: '', phone: '',
    registration_number: '', ssc_batch: '', blood_group: '', profession: '', institute: '',
    present_address: '', permanent_address: '',
  });
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register({ ...form, ssc_batch: form.ssc_batch ? Number(form.ssc_batch) : undefined });
      setOk(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  if (ok) {
    return (
      <div className="mx-auto max-w-md py-16">
        <Alert kind="success">
          Registration successful! Your account is <b>pending approval</b> by an administrator. You cannot log in until your membership is approved — please wait for the admin/authority decision.
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl py-8">
      <Card>
        <h1 className="text-2xl font-bold text-ink">Create your alumni account</h1>
        <p className="mb-4 text-sm text-ink-soft">All fields marked * are required.</p>
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2">
          <Input label="First name *" required value={form.first_name} onChange={set('first_name')} />
          <Input label="Last name *" required value={form.last_name} onChange={set('last_name')} />
          <Input label="Email *" type="email" required value={form.email} onChange={set('email')} />
          <Input label="Password * (min 8 chars)" type="password" required minLength={8} value={form.password} onChange={set('password')} />
          <Input label="Phone number" value={form.phone} onChange={set('phone')} />
          <Input label="SSC batch (year)" type="number" min="1960" max="2100" value={form.ssc_batch} onChange={set('ssc_batch')} />
          <Input label="Registration Number *" placeholder="Input your SSC Roll or Registration number" required maxLength={50} value={form.registration_number} onChange={set('registration_number')} />
          <Select label="Blood group" value={form.blood_group} onChange={set('blood_group')}>
            <option value="">— Select —</option>
            {BLOOD_GROUPS.map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
          <Input label="Profession" value={form.profession} onChange={set('profession')} />
          <Input label="Institute" value={form.institute} onChange={set('institute')} />
          <div className="sm:col-span-2">
            <Input label="Present Address *" placeholder="Your current residential address" required maxLength={255} value={form.present_address} onChange={set('present_address')} />
          </div>
          <div className="sm:col-span-2">
            <Input label="Permanent Address *" placeholder="Your permanent/home address" required maxLength={255} value={form.permanent_address} onChange={set('permanent_address')} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy} className="w-full">{busy ? 'Registering…' : 'Register'}</Button>
          </div>
        </form>
        <p className="mt-4 text-center text-sm text-ink-soft">
          Already registered? <Link className="text-moss hover:underline" to="/login">Login</Link>
        </p>
      </Card>
    </div>
  );
}
