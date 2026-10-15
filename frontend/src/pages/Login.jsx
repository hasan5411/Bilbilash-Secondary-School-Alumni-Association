import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Card, Input, Button, Alert } from '../components/ui.jsx';

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.8 17.8 0 0 1-3.2 4.2" />
      <path d="M6.7 6.7C3.6 8.6 2 12 2 12s3.5 7 10 7a10.7 10.7 0 0 0 4.3-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const notice = location.state?.notice;
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
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
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Password</span>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full rounded-lg border border-line bg-white px-3 py-2 pr-10 text-sm outline-none focus:border-forest focus:ring-2 focus:ring-forest/20 [&::-ms-reveal]:hidden"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-ink-soft hover:text-ink"
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </label>
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
