/**
 * otpDeliveryTest.js — regression for the production forgot-password OTP bug.
 *
 * PRODUCTION BUG (verified live 2026-10-15): Gmail SMTP from Render was
 * intermittent (a successful send took ~11s; failures surfaced after ~50s).
 * createPasswordReset() INSERTed the OTP row BEFORE sending, and on send
 * failure the row was left behind. As the NEWEST row it silently superseded
 * the last code that HAD reached the mailbox, so the user's genuine received
 * OTP was rejected with "Incorrect reset code" — the reported production
 * failure ("user enters the OTP received by email, nothing proceeds").
 *
 * This suite boots its OWN in-process app instance with SMTP pointed at a
 * closed port, so sendMail fails deterministically (ECONNREFUSED):
 *
 *   1. forgot-password fails FAST with "Could not send the reset email" and
 *      does NOT leave a live (usable) OTP row behind.  ← the actual fix
 *   2. verify-otp after a failed send says "No valid reset code" — BEFORE the
 *      fix this returned "Incorrect reset code (4 attempts left)", proving
 *      the never-delivered ghost row was live and authoritative.
 *   3. The 60s resend cooldown still counts the failed attempt (SMTP guard).
 *   4. Wrong code rejected; wrong email/OTP combination rejected; expired
 *      code rejected even when the code itself is correct.
 *   5. A valid OTP advances the existing password-reset endpoint, the
 *      password actually changes (new works, old does not).
 *
 * Requires: local embedded PostgreSQL running (node tests/pgServer.js) and
 * backend/.env pointing at it. NEVER runs against a remote DB (pgTestClient
 * guard). Usage: cd backend && node tests/otpDeliveryTest.js
 */
import 'dotenv/config';
import http from 'node:http';
import bcrypt from 'bcryptjs';

const stamp = Date.now();
const USER_A = `otp-delivery.a.${stamp}@example.com`;
const USER_B = `otp-delivery.b.${stamp}@example.com`;
const PASSWORD = 'Original1!pass';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`);

async function main() {
  // ── 1. Force SMTP into a configured-but-broken state BEFORE the app loads.
  // Claim a definitely-closed local port (bind, read port, close).
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const closedPort = probe.address().port;
  await new Promise((r) => probe.close(r));

  process.env.EMAIL_HOST = '127.0.0.1';
  process.env.EMAIL_PORT = String(closedPort);
  process.env.EMAIL_USER = 'smtp-broken@example.com';
  process.env.EMAIL_APP_PASSWORD = 'not-a-real-app-password';
  process.env.ALLOW_DEV_OTP = '0'; // dev-OTP escape hatch must stay closed

  // Import app + test DB only AFTER the env overrides (config/env.js is a
  // read-once singleton).
  const { openTestDb } = await import('./pgTestClient.js');
  const { createApp } = await import('../src/app.js');

  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;

  async function call(method, p, body) {
    const headers = body ? { 'Content-Type': 'application/json' } : {};
    const res = await fetch(`${BASE}${p}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON fine */ }
    return { status: res.status, json, message: json?.message || '' };
  }

  const registerBody = (email, regNo) => ({
    first_name: 'OTPDelivery',
    last_name: 'Test',
    email,
    password: PASSWORD,
    registration_number: regNo,
    ssc_batch: 2005,
    present_address: 'N/A',
    permanent_address: 'N/A',
  });

  const rowHash = await bcrypt.hash('123456', 10); // known code for direct rows

  let conn;
  try {
    section('A) Failed SMTP send must not leave a live OTP row (the fix)');
    const regA = await call('POST', '/api/auth/register', registerBody(USER_A, `OTPDLV-A-${stamp}`));
    check('register user A (pending)', regA.status === 201, `status ${regA.status}`);

    const t0 = Date.now();
    const forgot = await call('POST', '/api/auth/forgot-password', { email: USER_A });
    const forgotMs = Date.now() - t0;
    check('forgot-password fails fast on dead SMTP (≤15s)', forgot.status === 400 && forgotMs <= 15_000, `status ${forgot.status} in ${forgotMs}ms`);
    check('forgot-password reports delivery failure honestly', forgot.message === 'Could not send the reset email. Please try again shortly.', forgot.message);
    check('dev_otp never leaks when SMTP is configured', forgot.json?.data?.dev_otp === undefined, String(forgot.json?.data?.dev_otp));

    // THE REGRESSION: the never-delivered row must be unusable/authoritative-free.
    const verifyGhost = await call('POST', '/api/auth/verify-otp', { email: USER_A, otp: '000000' });
    check('after failed send: no valid code remains (no ghost row)',
      verifyGhost.status === 400 && verifyGhost.message === 'No valid reset code. Request a new one.',
      `status ${verifyGhost.status} "${verifyGhost.message}" (pre-fix: "Incorrect reset code (4 attempts left)")`);

    const cooldown = await call('POST', '/api/auth/forgot-password', { email: USER_A });
    check('resend cooldown still counts the failed attempt (409)',
      cooldown.status === 409 && /^Please wait \d+s/.test(cooldown.message),
      `status ${cooldown.status} "${cooldown.message}"`);

    section('B) Invalid / expired / mismatched codes are rejected');
    conn = await openTestDb();
    await conn.query(
      `INSERT INTO password_resets (user_id, otp_hash, expires_at) SELECT user_id, ?, NOW() + interval '5 minutes' FROM users WHERE email = ?`,
      [rowHash, USER_A]
    );

    const wrong = await call('POST', '/api/auth/verify-otp', { email: USER_A, otp: '654321' });
    check('wrong code rejected with attempt count',
      wrong.status === 400 && /^Incorrect reset code \(4 attempts left\)$/.test(wrong.message),
      `status ${wrong.status} "${wrong.message}"`);

    await conn.query(`UPDATE password_resets SET expires_at = NOW() - interval '1 minute' WHERE user_id = (SELECT user_id FROM users WHERE email = ?)`, [USER_A]);
    const expired = await call('POST', '/api/auth/verify-otp', { email: USER_A, otp: '123456' });
    check('expired code rejected even when the code itself is correct',
      expired.status === 400 && expired.message === 'This reset code has expired. Request a new one.',
      `status ${expired.status} "${expired.message}"`);

    const regB = await call('POST', '/api/auth/register', registerBody(USER_B, `OTPDLV-B-${stamp}`));
    check('register user B (pending)', regB.status === 201, `status ${regB.status}`);
    const combo = await call('POST', '/api/auth/verify-otp', { email: USER_B, otp: '123456' });
    check('wrong email/OTP combination rejected',
      combo.status === 400 && combo.message === 'No valid reset code. Request a new one.',
      `status ${combo.status} "${combo.message}"`);

    section('C) Valid OTP advances the existing password-reset endpoint');
    await conn.query(
      `INSERT INTO password_resets (user_id, otp_hash, expires_at) SELECT user_id, ?, NOW() + interval '5 minutes' FROM users WHERE email = ?`,
      [rowHash, USER_A]
    );
    const verify = await call('POST', '/api/auth/verify-otp', { email: USER_A, otp: '123456' });
    check('valid unexpired OTP verifies (200)', verify.status === 200, `status ${verify.status} "${verify.message}"`);

    const NEW_PASSWORD = 'BrandNew1!pass';
    const reset = await call('POST', '/api/auth/reset-password', {
      email: USER_A, otp: '123456', password: NEW_PASSWORD, confirm_password: NEW_PASSWORD,
    });
    check('reset-password accepts the verified OTP (200)', reset.status === 200, `status ${reset.status} "${reset.message}"`);

    const reuse = await call('POST', '/api/auth/reset-password', {
      email: USER_A, otp: '123456', password: 'Another1!pass', confirm_password: 'Another1!pass',
    });
    check('OTP is single-use (reuse rejected)', reuse.status === 400, `status ${reuse.status} "${reuse.message}"`);

    await conn.query(`UPDATE users SET status = 'approved', is_active = 1 WHERE email = ?`, [USER_A]);
    const loginNew = await call('POST', '/api/auth/login', { email: USER_A, password: NEW_PASSWORD });
    check('login works with the NEW password', loginNew.status === 200 && Boolean(loginNew.json?.data?.token), `status ${loginNew.status}`);
    const loginOld = await call('POST', '/api/auth/login', { email: USER_A, password: PASSWORD });
    check('login fails with the OLD password', loginOld.status === 401, `status ${loginOld.status}`);
  } finally {
    section('D) Cleanup (own fixtures only)');
    try {
      if (!conn) conn = await openTestDb();
      const [mine] = await conn.query(`SELECT user_id FROM users WHERE email LIKE 'otp-delivery.%'`);
      const ids = mine.map((r) => r.user_id);
      await conn.query(`DELETE FROM profiles WHERE user_id IN (SELECT user_id FROM users WHERE email LIKE 'otp-delivery.%')`);
      const [res] = await conn.query(`DELETE FROM users WHERE email LIKE 'otp-delivery.%'`, []);
      check('removed own fixtures', (res.affectedRows ?? 0) >= 2, `users affected=${res.affectedRows}`);
      if (ids.length) {
        const [left] = await conn.query(`SELECT COUNT(*)::int AS n FROM password_resets WHERE user_id IN (${ids.map(() => '?').join(',')})`, ids);
        check('password_resets followed their users (FK cascade)', left[0]?.n === 0, `rows left=${left[0]?.n}`);
      }
    } catch (err) {
      check('cleanup ran', false, err.code || err.message);
    } finally {
      if (conn) await conn.end().catch(() => {});
      server.close();
      // Do not let an orphaned pool hold the process open.
      const { closePool } = await import('../src/db/pool.js');
      await closePool().catch(() => {});
    }
  }

  console.log(`\notpDeliveryTest: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('Failures:', failures.join(' | '));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('otpDeliveryTest CRASHED:', err);
  process.exit(1);
});
