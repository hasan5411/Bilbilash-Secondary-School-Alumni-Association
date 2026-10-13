import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { Card, Input, Button, Alert } from '../components/ui.jsx';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [devOtp, setDevOtp] = useState(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const res = await api.post('/api/auth/forgot-password', { email });
      setMsg(res.message);
      if (res.data?.dev_otp) setDevOtp(res.data.dev_otp);
      setSent(true);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-md py-10">
      <Card>
        <h1 className="text-2xl font-bold text-ink">Forgot password</h1>
        {!sent ? (
          <>
            <p className="mb-4 text-sm text-ink-soft">Enter your registered email and we will send you a 6-digit verification code.</p>
            {error && <Alert kind="error">{error}</Alert>}
            <form onSubmit={submit} className="mt-3 space-y-3">
              <Input label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              <Button type="submit" disabled={busy} className="w-full">{busy ? 'Sending…' : 'Send OTP'}</Button>
            </form>
          </>
        ) : (
          <>
            {msg && <Alert kind="success">{msg}</Alert>}
            {devOtp ? (
              <Alert kind="info">
                Dev code: <b>{devOtp}</b> — <button type="button" className="font-semibold text-moss underline" onClick={() => navigate('/reset-password', { state: { email, devOtp } })}>continue to reset →</button>
              </Alert>
            ) : (
              <p className="mt-3 text-sm text-ink-soft">
                Open your Gmail inbox (check Spam if needed), copy the 6-digit code, then continue.
              </p>
            )}
            <Button className="mt-3 w-full" onClick={() => navigate('/reset-password', { state: { email } })}>Continue to OTP verification →</Button>
          </>
        )}
        <p className="mt-4 text-center text-sm"><Link className="text-moss hover:underline" to="/login">Back to login</Link></p>
      </Card>
    </div>
  );
}
