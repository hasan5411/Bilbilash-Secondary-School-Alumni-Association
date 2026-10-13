import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { Card, Input, Button, Alert } from '../components/ui.jsx';

const RESEND_SECONDS = 60;

export default function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({
    email: location.state?.email || '',
    otp: location.state?.devOtp || '',
    password: '',
    confirm_password: '',
  });
  const [stage, setStage] = useState('otp'); // 'otp' -> 'new-password'
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(RESEND_SECONDS);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const verifyOtp = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const res = await api.post('/api/auth/verify-otp', { email: form.email, otp: form.otp });
      setMsg(res.message);
      setStage('new-password');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const resend = async () => {
    setError(''); setBusy(true);
    try {
      const res = await api.post('/api/auth/forgot-password', { email: form.email });
      setMsg(res.message);
      setResendIn(RESEND_SECONDS);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const submitNew = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm_password) { setError('Passwords do not match'); return; }
    setBusy(true);
    try {
      const res = await api.post('/api/auth/reset-password', form);
      setMsg(res.message);
      setStage('done');
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <h1 className="text-2xl font-bold text-ink">
          {stage === 'otp' ? 'Verify code' : stage === 'new-password' ? 'Set a new password' : 'Password reset'}
        </h1>
        {msg && <Alert kind="success">{msg}</Alert>}
        {error && <Alert kind="error">{error}</Alert>}

        {stage === 'otp' && (
          <form onSubmit={verifyOtp} className="mt-3 space-y-3">
            <p className="text-sm text-ink-soft">We sent a verification code to <b>{form.email}</b>.</p>
            <Input label="Email" type="email" required value={form.email} onChange={set('email')} />
            <Input label="6-digit code" required maxLength={6} inputMode="numeric" value={form.otp} onChange={set('otp')} />
            <Button type="submit" disabled={busy} className="w-full">{busy ? 'Verifying…' : 'Verify OTP'}</Button>
            <div className="text-center text-sm text-ink-soft">
              {resendIn > 0
                ? <>Resend available in <b>{resendIn}s</b></>
                : <button type="button" className="font-semibold text-moss hover:underline" onClick={resend} disabled={busy}>Resend OTP</button>}
            </div>
          </form>
        )}

        {stage === 'new-password' && (
          <form onSubmit={submitNew} className="mt-3 space-y-3">
            <Input label="New password (min 8 chars)" type="password" required minLength={8} value={form.password} onChange={set('password')} />
            <Input label="Confirm new password" type="password" required minLength={8} value={form.confirm_password} onChange={set('confirm_password')} />
            <Button type="submit" disabled={busy} className="w-full">{busy ? 'Resetting…' : 'Reset password'}</Button>
          </form>
        )}

        {stage === 'done' && (
          <Button className="mt-3 w-full" onClick={() => navigate('/login')}>Go to login</Button>
        )}

        <p className="mt-4 text-center text-sm"><Link className="text-moss hover:underline" to="/login">Back to login</Link></p>
      </Card>
    </div>
  );
}
