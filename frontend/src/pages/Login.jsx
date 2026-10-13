import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Card, Input, Button, Alert } from '../components/ui.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const notice = location.state?.notice;
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(form.email, form.password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <h1 className="text-2xl font-bold text-ink">Welcome back</h1>
        <p className="mb-4 text-sm text-ink-soft">Log in to your alumni account.</p>
        {notice && !error && <Alert kind="info">{notice}</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={submit} className="mt-3 space-y-3">
          <Input label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Password" type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Logging in…' : 'Login'}</Button>
        </form>
        <div className="mt-4 flex justify-between text-sm">
          <Link className="text-moss hover:underline" to="/forgot-password">Forgot password?</Link>
          <Link className="text-moss hover:underline" to="/register">Create account</Link>
        </div>
      </Card>
    </div>
  );
}
