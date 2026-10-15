/**
 * otpFlowTest.js — full password-reset contract tests with a MOCK email API.
 *
 * The production outage (2026-10-15): Render Free blocks outbound SMTP
 * (ports 25/465/587 — render.com/docs/free), so Gmail SMTP from the app
 * failed with ETIMEDOUT / ENETUNREACH on :465 and forgot-password answered
 * 400. Production now delivers the OTP through an email provider's HTTPS API
 * (port 443). This suite mocks that API locally (never sends a real email,
 * never touches production — pgTestClient refuses remote databases) and runs
 * the ten required scenarios:
 *
 *   1. Registered email + successful delivery (OTP parsed from the mocked
 *      API request, then verify → reset → login with the new password).
 *   2. Provider failure (500 / 401 / 429) → honest 400, "sent" never claimed.
 *   3. A delivered OTP SURVIVES a later failed delivery (ghost-row regression:
 *      pre-fix the failed row superseded the real code with "Incorrect reset
 *      code").
 *   4. Unknown email (enumeration-safe, no API call) + invalid payloads (422).
 *   5. Correct OTP verification.  6. Incorrect OTP.  7. Expired OTP.
 *   8. OTP replay, attempt cap, resend cooldown (409), login brute-force 429.
 *   9. Password reset + login with the new password (old fails).
 *  10. Database outage (child process, refused DATABASE_URL → 503) and
 *      unexpected provider errors (socket crash, timeout/silence, garbage 2xx).
 *
 * Retry contract under test: one bounded retry on network/timeout/5xx/429,
 * NO retry on 4xx (delta of mock requests == 2 or == 1 respectively).
 *
 * Usage: cd backend && node tests/otpFlowTest.js   (needs tests/pgServer.js)
 */
import 'dotenv/config';
import http from 'node:http';
import { spawn } from 'node:child_process';
import bcrypt from 'bcryptjs';

const stamp = Date.now();
const users = {
  a: `otp-flow.a.${stamp}@example.com`,
  b: `otp-flow.b.${stamp}@example.com`,
  c: `otp-flow.c.${stamp}@example.com`,
  d: `otp-flow.d.${stamp}@example.com`,
  e: `otp-flow.e.${stamp}@example.com`,
};
const PASSWORD = 'Original1!pass';
const SEND_FAIL_MSG = 'Could not send the reset email. Please try again shortly.';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`);

// ── Mock provider API (what the email service will call over port 443) ──────
const mockState = { mode: 'ok', requests: [], count: 0 };
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    mockState.requests.push({ url: req.url, headers: req.headers, body: raw });
    mockState.count += 1;
    const send = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    switch (mockState.mode) {
      case 'ok': send(201, { id: 'mock-id' }); break;
      case 'fail500': send(500, { message: 'Internal server error' }); break;
      case 'fail401': send(401, { message: 'invalid api key' }); break;
      case 'fail429': send(429, { message: 'rate limited' }); break;
      case 'flaky': send(mockState.count % 2 === 1 ? 500 : 201, mockState.count % 2 === 1 ? { message: 'boom' } : { id: 'mock-id' }); break;
      case 'crash': res.socket.destroy(); break;
      case 'hang': break; // never respond — client must hit its timeout
      case 'garbage200': res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('not-json{'); break;
      default: send(500, { message: 'unknown mock mode' });
    }
  });
});
const setMode = (m) => { mockState.mode = m; mockState.count = 0; };
const delta = (before) => mockState.requests.length - before;

async function main() {
  // ── Configure the API transport BEFORE the app loads (config/env.js is a
  //    read-once singleton). Point it at the local mock; disable SMTP entirely
  //    so no real email can ever leave this process.
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const mockPort = mock.address().port;

  process.env.EMAIL_PROVIDER = 'resend';
  process.env.EMAIL_API_KEY = 'test-api-key-not-a-real-secret';
  process.env.EMAIL_FROM = 'Bilbilash Alumni <otp-test@example.com>';
  process.env.EMAIL_PROVIDER_BASE_URL = `http://127.0.0.1:${mockPort}`;
  process.env.EMAIL_PROVIDER_TIMEOUT_MS = '1200';
  process.env.EMAIL_HOST = '';
  process.env.EMAIL_PORT = '';
  process.env.EMAIL_USER = '';
  process.env.EMAIL_APP_PASSWORD = '';
  process.env.ALLOW_DEV_OTP = '0'; // dev-OTP escape hatch must stay closed

  const { openTestDb } = await import('./pgTestClient.js');
  const { createApp } = await import('../src/app.js');

  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;

  async function call(method, p, body) {
    const t0 = Date.now();
    const headers = body ? { 'Content-Type': 'application/json' } : {};
    const res = await fetch(`${BASE}${p}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON fine */ }
    return {
      status: res.status,
      json,
      message: json?.message || '',
      ms: Date.now() - t0,
      retryAfter: res.headers.get('retry-after'),
    };
  }

  const registerBody = (email, regNo) => ({
    first_name: 'OTPFlow',
    last_name: 'Test',
    email,
    password: PASSWORD,
    registration_number: regNo,
    ssc_batch: 2006,
    present_address: 'N/A',
    permanent_address: 'N/A',
  });

  let conn;
  const backdateCooldown = async (email) => {
    await conn.query(
      `UPDATE password_resets SET created_at = NOW() - interval '70 seconds'
        WHERE user_id = (SELECT user_id FROM users WHERE email = ?)`,
      [email]
    );
  };
  const approve = async (email) => {
    await conn.query(`UPDATE users SET status = 'approved', is_active = 1 WHERE email = ?`, [email]);
  };

  try {
    conn = await openTestDb();

    section('A) Registered email + successful API delivery + reset + login');
    setMode('ok');
    for (const [k, regNo] of [['a', 'OTPFLOW-A'], ['b', 'OTPFLOW-B'], ['c', 'OTPFLOW-C'], ['d', 'OTPFLOW-D'], ['e', 'OTPFLOW-E']]) {
      const r = await call('POST', '/api/auth/register', registerBody(users[k], `${regNo}-${stamp}`));
      check(`register user ${k.toUpperCase()} (pending)`, r.status === 201, `status ${r.status} "${r.message}"`);
    }

    let mk = mockState.requests.length;
    const forgotA = await call('POST', '/api/auth/forgot-password', { email: users.a });
    check('forgot-password → 200 with the exact message the frontend renders',
      forgotA.status === 200 && forgotA.message === 'If an account exists for this email, a verification code has been sent.',
      `status ${forgotA.status} "${forgotA.message}"`);
    check('dev_otp never leaks in the API response',
      forgotA.json?.data?.dev_otp === undefined && !JSON.stringify(forgotA.json || {}).includes('dev_otp'),
      String(forgotA.json?.data?.dev_otp));
    check('delivery went through the HTTPS API (one request, Bearer auth, /emails endpoint)',
      delta(mk) === 1 && mockState.requests[mk]?.url === '/emails'
        && mockState.requests[mk]?.headers?.authorization === 'Bearer test-api-key-not-a-real-secret',
      `delta=${delta(mk)} url=${mockState.requests[mk]?.url}`);

    // Parse the OTP out of the mocked request — the only way the test learns
    // the code. NEVER logged, only used for the calls below.
    const sent = mockState.requests[mk] ? JSON.parse(mockState.requests[mk].body) : {};
    const otpMatch = String(sent.text || '').match(/code is: (\d{6})/);
    const otpA = otpMatch ? otpMatch[1] : null;
    check('email payload: verified sender, recipient, subject, 6-digit code inside',
      sent.from === 'Bilbilash Alumni <otp-test@example.com>'
        && Array.isArray(sent.to) && sent.to[0] === users.a
        && sent.subject === 'Bilbilash Alumni - Password Reset OTP'
        && Boolean(otpA),
      `to=${JSON.stringify(sent.to)} subject=${sent.subject} hasCode=${Boolean(otpA)}`);
    check('API response never contains the OTP value',
      otpA && !JSON.stringify(forgotA.json || {}).includes(otpA), 'OTP found in response body');

    const wrong = await call('POST', '/api/auth/verify-otp', { email: users.a, otp: otpA === '654321' ? '654322' : '654321' });
    check('incorrect OTP rejected with remaining attempts',
      wrong.status === 400 && /^Incorrect reset code \(4 attempts left\)$/.test(wrong.message),
      `status ${wrong.status} "${wrong.message}"`);

    const verify = await call('POST', '/api/auth/verify-otp', { email: users.a, otp: otpA });
    check('correct OTP verifies (200)', verify.status === 200, `status ${verify.status} "${verify.message}"`);

    const NEW_PASSWORD = 'BrandNew1!pass';
    const reset = await call('POST', '/api/auth/reset-password', {
      email: users.a, otp: otpA, password: NEW_PASSWORD, confirm_password: NEW_PASSWORD,
    });
    check('reset-password accepts the verified OTP (200)', reset.status === 200, `status ${reset.status} "${reset.message}"`);

    const replay = await call('POST', '/api/auth/reset-password', {
      email: users.a, otp: otpA, password: 'Another1!pass', confirm_password: 'Another1!pass',
    });
    check('OTP replay rejected (single-use)',
      replay.status === 400 && replay.message === 'No valid reset code. Request a new one.',
      `status ${replay.status} "${replay.message}"`);

    await approve(users.a);
    const loginNew = await call('POST', '/api/auth/login', { email: users.a, password: NEW_PASSWORD });
    check('login works with the NEW password', loginNew.status === 200 && Boolean(loginNew.json?.data?.token), `status ${loginNew.status}`);
    const loginOld = await call('POST', '/api/auth/login', { email: users.a, password: PASSWORD });
    check('login fails with the OLD password', loginOld.status === 401, `status ${loginOld.status}`);

    section('B) Provider failure → honest 400 + bounded retry policy');
    setMode('fail500');
    mk = mockState.requests.length;
    const f500 = await call('POST', '/api/auth/forgot-password', { email: users.b });
    check('HTTP 500 → honest 400, success never claimed',
      f500.status === 400 && f500.message === SEND_FAIL_MSG,
      `status ${f500.status} "${f500.message}"`);
    check('5xx retried exactly once (2 API requests)', delta(mk) === 2, `delta=${delta(mk)}`);
    check('dev_otp absent on failure', f500.json?.data?.dev_otp === undefined, String(f500.json?.data?.dev_otp));

    const ghostB = await call('POST', '/api/auth/verify-otp', { email: users.b, otp: '123456' });
    check('failed delivery left NO live OTP row (no ghost row)',
      ghostB.status === 400 && ghostB.message === 'No valid reset code. Request a new one.',
      `status ${ghostB.status} "${ghostB.message}" (pre-fix: "Incorrect reset code (4 attempts left)")`);

    const cooldownB = await call('POST', '/api/auth/forgot-password', { email: users.b });
    check('resend cooldown counts the failed attempt (409)',
      cooldownB.status === 409 && /^Please wait \d+s/.test(cooldownB.message),
      `status ${cooldownB.status} "${cooldownB.message}"`);

    setMode('fail401');
    await backdateCooldown(users.b);
    mk = mockState.requests.length;
    const f401 = await call('POST', '/api/auth/forgot-password', { email: users.b });
    check('HTTP 401 → honest 400 with NO retry (a bad key will not fix itself)',
      f401.status === 400 && f401.message === SEND_FAIL_MSG && delta(mk) === 1,
      `status ${f401.status} delta=${delta(mk)}`);

    setMode('fail429');
    await backdateCooldown(users.b);
    mk = mockState.requests.length;
    const f429 = await call('POST', '/api/auth/forgot-password', { email: users.b });
    check('HTTP 429 from provider → honest 400 after one retry',
      f429.status === 400 && f429.message === SEND_FAIL_MSG && delta(mk) === 2,
      `status ${f429.status} delta=${delta(mk)}`);

    setMode('flaky');
    await backdateCooldown(users.b);
    mk = mockState.requests.length;
    const fFlaky = await call('POST', '/api/auth/forgot-password', { email: users.b });
    check('transient 500 then 201 → retry succeeds, user gets 200',
      fFlaky.status === 200 && delta(mk) === 2,
      `status ${fFlaky.status} delta=${delta(mk)}`);
    const otpBMatch = mockState.requests.length
      ? String(JSON.parse(mockState.requests[mockState.requests.length - 1].body).text || '').match(/code is: (\d{6})/) : null;

    section('C) Delivered OTP must SURVIVE a later delivery failure');
    setMode('ok');
    mk = mockState.requests.length;
    const forgotC1 = await call('POST', '/api/auth/forgot-password', { email: users.c });
    check('first delivery succeeds (200)', forgotC1.status === 200, `status ${forgotC1.status}`);
    const otpC = (() => {
      const last = mockState.requests[mockState.requests.length - 1];
      const m = String(JSON.parse(last.body).text || '').match(/code is: (\d{6})/);
      return m ? m[1] : null;
    })();
    check('OTP captured from the successful delivery', Boolean(otpC), 'no code in mocked request');

    setMode('fail500');
    await backdateCooldown(users.c);
    const forgotC2 = await call('POST', '/api/auth/forgot-password', { email: users.c });
    check('later resend fails honestly (400)', forgotC2.status === 400 && forgotC2.message === SEND_FAIL_MSG,
      `status ${forgotC2.status} "${forgotC2.message}"`);

    const verifyC = await call('POST', '/api/auth/verify-otp', { email: users.c, otp: otpC });
    check('THE REGRESSION: delivered OTP still verifies after a failed resend',
      verifyC.status === 200,
      `status ${verifyC.status} "${verifyC.message}" (pre-fix: "Incorrect reset code (4 attempts left)")`);

    const resetC = await call('POST', '/api/auth/reset-password', {
      email: users.c, otp: otpC, password: 'Survivor1!pass', confirm_password: 'Survivor1!pass',
    });
    check('and it completes the reset end-to-end', resetC.status === 200, `status ${resetC.status} "${resetC.message}"`);
    await approve(users.c);
    const loginC = await call('POST', '/api/auth/login', { email: users.c, password: 'Survivor1!pass' });
    check('login with the survived-reset password', loginC.status === 200 && Boolean(loginC.json?.data?.token), `status ${loginC.status}`);
    void otpBMatch;

    section('D) Expired, brute-forced, and mismatched codes');
    setMode('ok');
    await call('POST', '/api/auth/forgot-password', { email: users.d });
    const otpD1 = (() => {
      const m = String(JSON.parse(mockState.requests[mockState.requests.length - 1].body).text || '').match(/code is: (\d{6})/);
      return m ? m[1] : null;
    })();
    await conn.query(
      `UPDATE password_resets SET expires_at = NOW() - interval '1 minute'
        WHERE user_id = (SELECT user_id FROM users WHERE email = ?)`,
      [users.d]
    );
    const expiredD = await call('POST', '/api/auth/verify-otp', { email: users.d, otp: otpD1 });
    check('expired code rejected even when the code itself is correct',
      expiredD.status === 400 && expiredD.message === 'This reset code has expired. Request a new one.',
      `status ${expiredD.status} "${expiredD.message}"`);

    await backdateCooldown(users.d);
    await call('POST', '/api/auth/forgot-password', { email: users.d });
    const otpD2 = (() => {
      const m = String(JSON.parse(mockState.requests[mockState.requests.length - 1].body).text || '').match(/code is: (\d{6})/);
      return m ? m[1] : null;
    })();
    const wrongOtp = otpD2 === '654321' ? '654322' : '654321';
    const mismatch = await call('POST', '/api/auth/verify-otp', { email: users.d, otp: wrongOtp });
    check('wrong code for this user rejected (4 attempts left)',
      mismatch.status === 400 && mismatch.message === 'Incorrect reset code (4 attempts left)',
      `status ${mismatch.status} "${mismatch.message}"`);
    let bruteMsg = '';
    for (let i = 0; i < 4; i += 1) {
      const r = await call('POST', '/api/auth/verify-otp', { email: users.d, otp: wrongOtp });
      bruteMsg = r.message;
      if (r.message === 'Too many incorrect attempts. Request a new code.') break;
      if (r.status !== 400 || !/\(\d+ attempts? left\)$/.test(r.message)) {
        bruteMsg = `${r.status} "${r.message}"`;
        break;
      }
    }
    const locked = await call('POST', '/api/auth/verify-otp', { email: users.d, otp: otpD2 });
    check('5 wrong attempts lock the code — even the CORRECT code now rejected',
      locked.status === 400 && locked.message === 'Too many incorrect attempts. Request a new code.',
      `status ${locked.status} "${locked.message}" (last wrong: ${bruteMsg})`);

    section('E) Unknown email + invalid payloads');
    setMode('ok');
    mk = mockState.requests.length;
    const unknown = await call('POST', '/api/auth/forgot-password', { email: `nobody.${stamp}@example.com` });
    const known = forgotA; // identical wording from section A
    check('unknown email → 200 with IDENTICAL wording (enumeration-safe)',
      unknown.status === 200 && unknown.message === known.message,
      `status ${unknown.status} "${unknown.message}"`);
    check('unknown email → provider API never called', delta(mk) === 0, `delta=${delta(mk)}`);
    check('unknown email → no dev_otp', unknown.json?.data?.dev_otp === undefined, String(unknown.json?.data?.dev_otp));

    const noEmail = await call('POST', '/api/auth/forgot-password', {});
    check('missing email → 422', noEmail.status === 422 && /email is required/.test(noEmail.message),
      `status ${noEmail.status} "${noEmail.message}"`);
    const badEmail = await call('POST', '/api/auth/forgot-password', { email: 'not-an-email' });
    check('malformed email → 422', badEmail.status === 422 && /valid email/.test(badEmail.message),
      `status ${badEmail.status} "${badEmail.message}"`);
    const shortOtp = await call('POST', '/api/auth/verify-otp', { email: users.a, otp: '12345' });
    check('5-digit OTP payload → 422', shortOtp.status === 422, `status ${shortOtp.status} "${shortOtp.message}"`);
    const longOtp = await call('POST', '/api/auth/verify-otp', { email: users.a, otp: '1234567' });
    check('7-digit OTP payload → 422', longOtp.status === 422, `status ${longOtp.status} "${longOtp.message}"`);
    const mismatchPw = await call('POST', '/api/auth/reset-password', {
      email: users.a, otp: '123456', password: 'Mismatch1!pass', confirm_password: 'Mismatch2!pass',
    });
    check('confirm-password mismatch → 400', mismatchPw.status === 400 && mismatchPw.message === 'Passwords do not match',
      `status ${mismatchPw.status} "${mismatchPw.message}"`);
    const verifyUnknown = await call('POST', '/api/auth/verify-otp', { email: `ghost.${stamp}@example.com`, otp: '123456' });
    check('verify for unknown email → 400 (no oracle)',
      verifyUnknown.status === 400 && verifyUnknown.message === 'No valid reset code for this email',
      `status ${verifyUnknown.status} "${verifyUnknown.message}"`);

    section('F) Rate limiting (login brute force)');
    let saw429 = false;
    let lastStatus = 0;
    for (let i = 0; i < 10 && !saw429; i += 1) {
      const r = await call('POST', '/api/auth/login', { email: users.a, password: 'WrongPass99!' });
      lastStatus = r.status;
      if (r.status === 429) {
        saw429 = true;
        check('repeated wrong passwords → 429 with Retry-After',
          Boolean(r.retryAfter) && r.message === 'Too many failed attempts. Please wait a few minutes before trying again.',
          `status ${r.status} retry-after=${r.retryAfter} "${r.message}"`);
      } else if (r.status !== 401) {
        break;
      }
    }
    check('brute-force budget trips within 10 attempts', saw429, `lastStatus=${lastStatus}`);
    const afterLock = await call('POST', '/api/auth/login', { email: users.a, password: 'BrandNew1!pass' });
    check('correct password still works while the budget is exhausted (no owner lockout)',
      afterLock.status === 200 && Boolean(afterLock.json?.data?.token), `status ${afterLock.status}`);

    section('G) Unexpected provider errors (crash / silence / garbage)');
    setMode('crash');
    mk = mockState.requests.length;
    const fCrash = await call('POST', '/api/auth/forgot-password', { email: users.e });
    check('socket crash → honest 400 (both attempts hit the API)',
      fCrash.status === 400 && fCrash.message === SEND_FAIL_MSG && delta(mk) === 2,
      `status ${fCrash.status} delta=${delta(mk)}`);

    setMode('hang');
    mk = mockState.requests.length;
    await backdateCooldown(users.e);
    const fHang = await call('POST', '/api/auth/forgot-password', { email: users.e });
    check('provider silence → timeout-bounded honest 400',
      fHang.status === 400 && fHang.message === SEND_FAIL_MSG && fHang.ms >= 1000 && fHang.ms <= 8000 && delta(mk) === 2,
      `status ${fHang.status} ms=${fHang.ms} delta=${delta(mk)}`);

    const verifyE = await call('POST', '/api/auth/verify-otp', { email: users.e, otp: '000000' });
    check('provider crash/silence left no live OTP row',
      verifyE.status === 400 && verifyE.message === 'No valid reset code. Request a new one.',
      `status ${verifyE.status} "${verifyE.message}"`);

    setMode('garbage200');
    mk = mockState.requests.length;
    await backdateCooldown(users.e);
    const fGarbage = await call('POST', '/api/auth/forgot-password', { email: users.e });
    check('2xx with unparseable body still counts as delivered (HTTP status is the contract)',
      fGarbage.status === 200 && delta(mk) === 1, `status ${fGarbage.status} delta=${delta(mk)}`);

    const health = await call('GET', '/api/health');
    check('server healthy after every provider failure mode',
      health.status === 200 && health.json?.data?.status === 'ok',
      `status ${health.status} ${health.json?.data?.status}`);

    section('H) Database outage (child process, refused DATABASE_URL)');
    const childResult = await runDbOutageChild();
    if (childResult) {
      check('forgot-password during DB outage → 503 with actionable message',
        childResult.forgot?.status === 503
          && String(childResult.forgot?.body?.message || '').startsWith('Database is unavailable'),
        JSON.stringify(childResult.forgot));
      const leaky = /postgres:\/\//i.test(JSON.stringify(childResult.forgot?.body || {}))
        || /55432|supabase\.co|password=/i.test(JSON.stringify(childResult.forgot?.body || {}));
      check('DB outage response leaks no connection details', !leaky, 'connection string found in response body');
      check('health during outage → 200 degraded (not a crash)',
        childResult.health?.status === 200 && childResult.health?.body?.data?.status === 'degraded',
        JSON.stringify(childResult.health));
    } else {
      check('database-outage child process produced a result', false, 'no CHILD_RESULT line');
    }

    section('I) Provider payload contracts + config-error paths (children)');
    // Resend is exercised end-to-end above; the other two supported providers
    // and the misconfiguration paths run in child processes because config/env.js
    // is a read-once singleton per process.
    for (const provider of ['resend', 'brevo', 'sendgrid']) {
      const r = await runProviderContractChild(provider);
      if (!r || !r.send) {
        check(`${provider}: contract child produced a result`, false, JSON.stringify(r));
        continue;
      }
      const b = r.payload?.body || {};
      const h = r.payload?.headers || {};
      const common = r.send.sent === true && r.send.transport === 'api' && r.payload?.url;
      if (provider === 'resend') {
        check('resend payload: full From string, string[] to, text, Bearer auth',
          common && r.send.provider === 'resend' && r.send.messageId === 'mock-id'
            && b.from === 'Bilbilash Alumni <no-reply@example.com>'
            && Array.isArray(b.to) && b.to[0] === 'recipient@example.com'
            && b.subject === 'Subj' && b.text === 'Body text'
            && h.authorization === 'Bearer contract-test-key' && r.payload.url === '/emails',
          JSON.stringify({ b, h, send: r.send }));
      } else if (provider === 'brevo') {
        check('brevo payload: bare sender.email, recipient objects, textContent, api-key header',
          common && r.send.provider === 'brevo' && r.send.messageId === 'msg-id'
            && b.sender?.email === 'no-reply@example.com' && !('from' in b)
            && b.to?.[0]?.email === 'recipient@example.com'
            && b.subject === 'Subj' && b.textContent === 'Body text'
            && h.apiKey === 'contract-test-key' && r.payload.url === '/v3/smtp/email',
          JSON.stringify({ b, h, send: r.send }));
      } else {
        check('sendgrid payload: bare from.email, personalizations, content[], Bearer auth',
          common && r.send.provider === 'sendgrid' && r.send.messageId === null
            && b.from?.email === 'no-reply@example.com'
            && b.personalizations?.[0]?.to?.[0]?.email === 'recipient@example.com'
            && b.subject === 'Subj'
            && b.content?.[0]?.type === 'text/plain' && b.content?.[0]?.value === 'Body text'
            && h.authorization === 'Bearer contract-test-key' && r.payload.url === '/v3/mail/send',
          JSON.stringify({ b, h, send: r.send }));
      }
    }

    const missingKey = await runSendOutcomeChild({ EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: '', EMAIL_FROM: '' });
    check('provider chosen but key/from missing → honest failure, never a fake success',
      missingKey && missingKey.sent === false && missingKey.reason === 'provider_missing_credentials',
      JSON.stringify(missingKey));

    const badProvider = await runBootFailureChild('postmark');
    check('misspelled EMAIL_PROVIDER refuses to boot with an actionable message',
      badProvider && badProvider.code === 1 && /not supported/.test(badProvider.stderr || ''),
      JSON.stringify({ code: badProvider?.code, stderr: String(badProvider?.stderr || '').slice(0, 200) }));
  } finally {
    section('Cleanup (own fixtures only)');
    try {
      if (!conn) conn = await openTestDb();
      const [mine] = await conn.query(`SELECT user_id FROM users WHERE email LIKE 'otp-flow.%'`);
      const ids = mine.map((r) => r.user_id);
      await conn.query(`DELETE FROM profiles WHERE user_id IN (SELECT user_id FROM users WHERE email LIKE 'otp-flow.%')`);
      const [res] = await conn.query(`DELETE FROM users WHERE email LIKE 'otp-flow.%'`);
      check('removed own fixtures', (res.affectedRows ?? 0) >= 5, `users affected=${res.affectedRows}`);
      if (ids.length) {
        const [left] = await conn.query(
          `SELECT COUNT(*)::int AS n FROM password_resets WHERE user_id IN (${ids.map(() => '?').join(',')})`, ids);
        check('password_resets followed their users (FK cascade)', left[0]?.n === 0, `rows left=${left[0]?.n}`);
      }
    } catch (err) {
      check('cleanup ran', false, err.code || err.message);
    } finally {
      if (conn) await conn.end().catch(() => {});
      mock.close();
      server.close();
      const { closePool } = await import('../src/db/pool.js');
      await closePool().catch(() => {});
    }
  }

  console.log(`\notpFlowTest: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('Failures:', failures.join(' | '));
    process.exit(1);
  }
  process.exit(0);
}

/**
 * Scenario 10 (DB failure): boot a throwaway app instance whose DATABASE_URL
 * points at a closed port and record what /forgot-password and /api/health
 * answer. Runs in a CHILD PROCESS because config/env.js is a read-once
 * singleton per process. The child prints one JSON line; connection details
 * never reach the test output.
 */
function runDbOutageChild() {
  const appUrl = new URL('../src/app.js', import.meta.url).href;
  const script = `
import http from 'node:http';
const { createApp } = await import(${JSON.stringify(appUrl)});
const server = http.createServer(createApp());
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const f = await fetch(base + '/api/auth/forgot-password', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'db-outage-probe@example.com' }),
});
const fbody = await f.json().catch(() => null);
const h = await fetch(base + '/api/health');
const hbody = await h.json().catch(() => null);
console.log('CHILD_RESULT ' + JSON.stringify({ forgot: { status: f.status, body: fbody }, health: { status: h.status, body: hbody } }));
server.close();
process.exit(0);
`;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: {
        ...process.env,
        DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:1/bilbilash_outage_probe',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(null); }, 30_000);
    child.on('close', () => {
      clearTimeout(timer);
      const line = out.split('\n').find((l) => l.startsWith('CHILD_RESULT '));
      if (!line) console.error('[db-outage child stderr]', err.slice(0, 500));
      resolve(line ? JSON.parse(line.slice('CHILD_RESULT '.length)) : null);
    });
  });
}

/** Run a module-eval child (node --input-type=module -e) and collect its outcome. */
function runNodeEval(script, envOverrides = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, ...envOverrides },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(null); }, 30_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

const parseLine = (stdout, prefix) => {
  const line = String(stdout || '').split('\n').find((l) => l.startsWith(prefix));
  return line ? JSON.parse(line.slice(prefix.length)) : null;
};

/**
 * Send one email through sendEmail() against a throwaway local mock and return
 * both the send outcome and the exact HTTP payload the provider would have
 * received (headers + body). The child picks its own mock port.
 */
function runProviderContractChild(provider) {
  const svcUrl = new URL('../src/services/emailService.js', import.meta.url).href;
  const script = `
import http from 'node:http';
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'mock-id', messageId: 'msg-id' }));
    console.log('PAYLOAD_RESULT ' + JSON.stringify({
      url: req.url,
      headers: { authorization: req.headers.authorization || null, apiKey: req.headers['api-key'] || null },
      body: JSON.parse(raw),
    }));
    mock.close();
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
process.env.EMAIL_PROVIDER_BASE_URL = 'http://127.0.0.1:' + mock.address().port;
const { sendEmail } = await import(${JSON.stringify(svcUrl)});
const out = await sendEmail({ to: 'recipient@example.com', subject: 'Subj', text: 'Body text' });
console.log('SEND_RESULT ' + JSON.stringify(out));
setTimeout(() => process.exit(0), 200);
`;
  return runNodeEval(script, {
    EMAIL_PROVIDER: provider,
    EMAIL_API_KEY: 'contract-test-key',
    EMAIL_FROM: 'Bilbilash Alumni <no-reply@example.com>',
    EMAIL_PROVIDER_TIMEOUT_MS: '5000',
  }).then((r) => r && ({
    send: parseLine(r.stdout, 'SEND_RESULT '),
    payload: parseLine(r.stdout, 'PAYLOAD_RESULT '),
  }));
}

/** Direct sendEmail() outcome with custom env (e.g. provider without a key). */
function runSendOutcomeChild(envOverrides) {
  const svcUrl = new URL('../src/services/emailService.js', import.meta.url).href;
  const script = `
const { sendEmail } = await import(${JSON.stringify(svcUrl)});
const out = await sendEmail({ to: 'recipient@example.com', subject: 'Subj', text: 'Body text' });
console.log('SEND_RESULT ' + JSON.stringify(out));
process.exit(0);
`;
  return runNodeEval(script, envOverrides)
    .then((r) => r && parseLine(r.stdout, 'SEND_RESULT '));
}

/** Boot env.js with a given EMAIL_PROVIDER; expect exit code 1 + message on stderr. */
function runBootFailureChild(provider) {
  const envUrl = new URL('../src/config/env.js', import.meta.url).href;
  const script = `await import(${JSON.stringify(envUrl)}); console.log('SHOULD_NOT_REACH');`;
  return runNodeEval(script, { EMAIL_PROVIDER: provider });
}

main().catch((err) => {
  console.error('otpFlowTest CRASHED:', err);
  process.exit(1);
});
