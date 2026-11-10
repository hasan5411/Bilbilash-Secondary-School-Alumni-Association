/**
 * paymentMethodsTest.js — four-method payment system (bKash / Nagad / Rocket / Bank).
 *
 * Covers the enhancement WITHOUT touching the money logic:
 *   A) GET /api/payments/providers lists exactly the four manual methods, each
 *      with the VERIFIED official Play Store / App Store pages and the verified
 *      Android package name — and never an invented deep link (app_url null).
 *   B) Bank transfer is reported as "not configured" (and refused by the API)
 *      until BANK_NAME + BANK_ACCOUNT_NAME + BANK_ACCOUNT_NUMBER are set; once
 *      configured it is served with the real details only.
 *   C) Manual submission still works for the mobile wallets (pending → admin
 *      review → approved) and monthly dues stay UNCHANGED until approval.
 *   D) Bank transfers use the same pending → review workflow and support a
 *      transfer reference + sender account number; they never touch monthly dues.
 *   E) Authorization and duplicate-reference protection are unchanged.
 *
 * Run twice for full coverage:
 *   node tests/paymentMethodsTest.js                       (bank NOT configured)
 *   BANK_NAME=... BANK_ACCOUNT_NAME=... BANK_ACCOUNT_NUMBER=... \
 *     node tests/paymentMethodsTest.js                     (bank configured)
 *
 * Requires: local PostgreSQL (node tests/pgServer.js). NEVER runs against a
 * remote DB (pgTestClient guard). Fixtures are prefixed `pmtest.` and removed.
 */
import 'dotenv/config';
import http from 'node:http';
import bcrypt from 'bcryptjs';

const stamp = Date.now();
const EMAIL = (tag) => `pmtest.${tag}.${stamp}@example.com`;
const PASSWORD = 'Pmtest1!pass';
const REG = (tag) => `PMT-${stamp}-${tag}`;
const TXN = (tag) => `PMT${stamp}${tag}`;

const now = new Date();
const THIS_MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`);

async function main() {
  const { openTestDb } = await import('./pgTestClient.js');
  const { createApp } = await import('../src/app.js');
  const { env } = await import('../src/config/env.js');

  const bankConfigured = Boolean(
    env.payments.bank.bankName && env.payments.bank.accountName && env.payments.bank.accountNumber
  );
  console.log(`[test] bank configured in this run: ${bankConfigured}`);

  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;

  async function call(method, p, { body, token } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${BASE}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch { /* fine */ }
    return { status: res.status, json, message: json?.message || '' };
  }

  async function callForm(p, fields, token) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) fd.append(k, String(v));
    const res = await fetch(`${BASE}${p}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    let json = null;
    try { json = await res.json(); } catch { /* fine */ }
    return { status: res.status, json, message: json?.message || '' };
  }

  let conn;
  try {
    conn = await openTestDb();

    section('Setup: fixtures (roles / users / contribution rate)');
    await conn.query(
      `INSERT INTO roles (role_name, description) VALUES
         ('VISITOR','x'),('MEMBER','x'),('ADMIN','x'),('AUTHORITY','x')
       ON CONFLICT DO NOTHING`
    );
    const hash = await bcrypt.hash(PASSWORD, 10);
    const mkUser = async (tag, role, reg) => {
      const [res] = await conn.query(
        `INSERT INTO users (role_id, first_name, last_name, email, password_hash, phone, registration_number, status, is_active, token_version)
         SELECT role_id, ?, 'PayTester', ?, ?, '01711111111', ?, 'approved', 1, 0
           FROM roles WHERE role_name = ? RETURNING user_id`,
        [tag, EMAIL(tag), hash, reg, role]
      );
      const id = Number(res.insertId);
      await conn.query(`INSERT INTO profiles (user_id, ssc_batch) VALUES (?, 2010)`, [id]);
      return id;
    };
    const memberId = await mkUser('member', 'MEMBER', REG('M'));
    await mkUser('admin', 'ADMIN', REG('A'));
    await mkUser('authority', 'AUTHORITY', REG('Y'));
    await conn.query(
      `INSERT INTO profiles (user_id, contribution_start_month) VALUES (?, ?)
       ON CONFLICT (user_id) DO UPDATE SET contribution_start_month = EXCLUDED.contribution_start_month`,
      [memberId, THIS_MONTH]
    );
    await conn.query(
      `INSERT INTO member_monthly_rates (user_id, amount, effective_month, source) VALUES (?, 50, ?, 'admin')`,
      [memberId, THIS_MONTH]
    );

    const login = async (email) => {
      const r = await call('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
      return r.json?.data?.token || null;
    };
    const memberToken = await login(EMAIL('member'));
    const adminToken = await login(EMAIL('admin'));
    const authorityToken = await login(EMAIL('authority'));
    check('fixture logins work', Boolean(memberToken && adminToken && authorityToken));

    // ── A) Providers ────────────────────────────────────────────────────
    section('A) GET /api/payments/providers — four verified methods');
    const provs = await call('GET', '/api/payments/providers', { token: memberToken });
    const list = provs.json?.data?.providers || [];
    check('providers -> 200 with four methods', provs.status === 200 && list.length === 4, `status ${provs.status} n=${list.length}`);
    check('keys are bkash/nagad/rocket/bank',
      ['bkash', 'nagad', 'rocket', 'bank'].every((k) => list.some((p) => p.key === k)),
      JSON.stringify(list.map((p) => p.key)));

    const EXPECTED = {
      bkash: { pkg: 'com.bKash.customerapp', play: 'https://play.google.com/store/apps/details?id=com.bKash.customerapp', ios: 'https://apps.apple.com/app/bkash/id1351183172' },
      nagad: { pkg: 'com.konasl.nagad', play: 'https://play.google.com/store/apps/details?id=com.konasl.nagad', ios: 'https://apps.apple.com/app/nagad/id1471844924' },
      rocket: { pkg: 'com.dbbl.mbs.apps.main', play: 'https://play.google.com/store/apps/details?id=com.dbbl.mbs.apps.main', ios: 'https://apps.apple.com/app/dbbl-rocket/id1194003397' },
    };
    for (const [key, want] of Object.entries(EXPECTED)) {
      const p = list.find((x) => x.key === key);
      check(`${key}: verified Android package`, p?.android_package === want.pkg, String(p?.android_package));
      check(`${key}: official Play Store listing`, p?.store_urls?.android === want.play, String(p?.store_urls?.android));
      check(`${key}: official App Store listing`, p?.store_urls?.ios === want.ios, String(p?.store_urls?.ios));
      check(`${key}: no invented deep link (app_url null)`, p?.app_url === null, String(p?.app_url));
    }
    check('no provider points at a third-party download site',
      list.every((p) => !p.store_urls || [p.store_urls.android, p.store_urls.ios].every((u) => !u || /^https:\/\/(play\.google\.com|apps\.apple\.com)\//.test(u))));
    const provsAnon = await call('GET', '/api/payments/providers');
    check('providers require auth (401 anon)', provsAnon.status === 401, `status ${provsAnon.status}`);

    // ── B) Bank configuration gate ──────────────────────────────────────
    section(`B) Bank transfer configuration (${bankConfigured ? 'configured' : 'NOT configured'})`);
    const bank = list.find((p) => p.key === 'bank');
    if (bankConfigured) {
      check('bank reports configured=true', bank?.configured === true, String(bank?.configured));
      check('bank serves the configured account number',
        bank?.bank?.account_number === env.payments.bank.accountNumber, String(bank?.bank?.account_number));
      check('bank serves the configured holder + bank name',
        bank?.bank?.account_name === env.payments.bank.accountName && bank?.bank?.name === env.payments.bank.bankName);
    } else {
      check('bank reports configured=false when unset', bank?.configured === false, String(bank?.configured));
      check('no bank details are invented when unset', bank?.bank === null, JSON.stringify(bank?.bank));
      const bankAttempt = await callForm('/api/payments/manual', {
        registration_number: REG('M'), payment_type: 'occasional', payment_method: 'bank',
        purpose: 'donation', amount: 250, transaction_id: TXN('BANKOFF'),
      }, memberToken);
      check('bank submission refused while unconfigured (400)', bankAttempt.status === 400, `status ${bankAttempt.status}`);
      check('refusal explains the missing configuration', /not configured/i.test(bankAttempt.message), bankAttempt.message);
    }

    // ── C) Mobile wallets: unchanged pending → review workflow ──────────
    section('C) Mobile wallets still submit → pending → review');
    const monthsBefore = await call('GET', '/api/payments/monthly-status', { token: memberToken });
    const paidBefore = (monthsBefore.json?.data?.months || []).find((m) => m.month === THIS_MONTH)?.paid;

    const nagad = await callForm('/api/payments/manual', {
      registration_number: REG('M'), payment_type: 'monthly', payment_method: 'nagad',
      amount: 50, billing_month: THIS_MONTH, transaction_id: TXN('NAGAD'), sender_number: '01711111111',
    }, memberToken);
    check('nagad monthly submit -> 201 pending', nagad.status === 201 && nagad.json?.data?.payment?.status === 'pending',
      `status ${nagad.status} ${nagad.message}`);
    const nagadId = Number(nagad.json?.data?.payment?.payment_id);

    const afterPending = await call('GET', '/api/payments/monthly-status', { token: memberToken });
    const paidWhilePending = (afterPending.json?.data?.months || []).find((m) => m.month === THIS_MONTH)?.paid;
    check('pending payment does NOT mark the month paid', paidBefore === false && paidWhilePending === false,
      `before=${paidBefore} pending=${paidWhilePending}`);

    const dupTxn = await callForm('/api/payments/manual', {
      registration_number: REG('M'), payment_type: 'occasional', payment_method: 'rocket',
      purpose: 'donation', amount: 100, transaction_id: TXN('NAGAD'),
    }, memberToken);
    check('duplicate reference across methods -> 409', dupTxn.status === 409, `status ${dupTxn.status}`);

    const selfReview = await call('PATCH', `/api/payments/${nagadId}/review`, { token: memberToken, body: { status: 'success' } });
    check('member cannot review own payment (403)', selfReview.status === 403, `status ${selfReview.status}`);

    const approve = await call('PATCH', `/api/payments/${nagadId}/review`, { token: authorityToken, body: { status: 'success', note: 'Nagad TrxID verified' } });
    check('authority approves nagad payment', approve.status === 200 && approve.json?.data?.payment?.status === 'success', `status ${approve.status}`);

    const afterApprove = await call('GET', '/api/payments/monthly-status', { token: memberToken });
    const paidAfter = (afterApprove.json?.data?.months || []).find((m) => m.month === THIS_MONTH)?.paid;
    check('approval settles the month (unchanged monthly rule)', paidAfter === true, String(paidAfter));
    const [[mpd]] = await conn.query(
      `SELECT COUNT(*) AS n FROM monthly_payment_details WHERE user_id = ? AND payment_month = ?`, [memberId, THIS_MONTH]);
    check('monthly_payment_details written exactly once', Number(mpd.n) === 1, `n=${mpd.n}`);

    const rocket = await callForm('/api/payments/manual', {
      registration_number: REG('M'), payment_type: 'occasional', payment_method: 'rocket',
      purpose: 'donation', amount: 300, transaction_id: TXN('ROCKET'),
    }, memberToken);
    check('rocket occasional submit -> 201 pending', rocket.status === 201 && rocket.json?.data?.payment?.status === 'pending',
      `status ${rocket.status} ${rocket.message}`);
    const rocketId = Number(rocket.json?.data?.payment?.payment_id);

    // ── D) Bank transfer: same workflow, no monthly impact ─────────────
    section(`D) Bank transfer ${bankConfigured ? 'submission + review' : '(skipped: not configured)'}`);
    if (bankConfigured) {
      const bankPay = await callForm('/api/payments/manual', {
        registration_number: REG('M'), payment_type: 'occasional', payment_method: 'bank',
        purpose: 'donation', amount: 250, transaction_id: TXN('BANK'),
        sender_number: '0123456789012', description: 'Bank transfer to association account',
      }, memberToken);
      check('bank transfer submit -> 201 pending', bankPay.status === 201 && bankPay.json?.data?.payment?.status === 'pending',
        `status ${bankPay.status} ${bankPay.message}`);
      check('bank payment stores method = bank', bankPay.json?.data?.payment?.payment_method === 'bank',
        String(bankPay.json?.data?.payment?.payment_method));
      const bankId = Number(bankPay.json?.data?.payment?.payment_id);

      const all = await call('GET', '/api/payments', { token: adminToken });
      const row = (all.json?.data?.payments || []).find((p) => Number(p.payment_id) === bankId);
      check('bank payment visible to admins with its reference',
        Boolean(row) && row.payment_method === 'bank' && row.transaction_id === TXN('BANK'),
        JSON.stringify(row && { method: row.payment_method, txn: row.transaction_id }));

      const [[mpdBeforeRow]] = await conn.query(
        `SELECT COUNT(*) AS n FROM monthly_payment_details WHERE user_id = ?`, [memberId]);
      const mpdBefore = Number(mpdBeforeRow.n);

      const bankApprove = await call('PATCH', `/api/payments/${bankId}/review`, { token: adminToken, body: { status: 'success', note: 'Bank reference verified' } });
      check('admin approves bank transfer', bankApprove.status === 200 && bankApprove.json?.data?.payment?.status === 'success', `status ${bankApprove.status}`);

      const [[mpdAfterRow]] = await conn.query(
        `SELECT COUNT(*) AS n FROM monthly_payment_details WHERE user_id = ?`, [memberId]);
      const mpdAfter = Number(mpdAfterRow.n);
      check('bank donation never touches monthly dues', mpdBefore === mpdAfter, `${mpdBefore} -> ${mpdAfter}`);

      const badSender = await callForm('/api/payments/manual', {
        registration_number: REG('M'), payment_type: 'occasional', payment_method: 'bank',
        purpose: 'donation', amount: 100, transaction_id: TXN('BANKBAD'), sender_number: 'not-an-account',
      }, memberToken);
      check('bank rejects an invalid sender account (400)', badSender.status === 400, `status ${badSender.status}`);
      check('bank sender error names the account number', /account number/i.test(badSender.message), badSender.message);
    }

    // ── E) Regression: wallet sender validation unchanged ──────────────
    section('E) Existing wallet validation unchanged');
    const badMobile = await callForm('/api/payments/manual', {
      registration_number: REG('M'), payment_type: 'occasional', payment_method: 'bkash',
      purpose: 'donation', amount: 100, transaction_id: TXN('BADSENDER'), sender_number: '12345',
    }, memberToken);
    check('wallet rejects an invalid sender mobile (400)', badMobile.status === 400, `status ${badMobile.status}`);
    const badTxn = await callForm('/api/payments/manual', {
      registration_number: REG('M'), payment_type: 'occasional', payment_method: 'bkash',
      purpose: 'donation', amount: 100, transaction_id: 'AB1',
    }, memberToken);
    check('wallet rejects a too-short Transaction ID (400)', badTxn.status === 400, `status ${badTxn.status}`);
    const testProvider = await callForm('/api/payments/manual', {
      registration_number: REG('M'), payment_type: 'occasional', payment_method: 'test',
      purpose: 'donation', amount: 100, transaction_id: TXN('TESTP'),
    }, memberToken);
    check('manual endpoint still rejects the gateway test provider (400)', testProvider.status === 400, `status ${testProvider.status}`);

    // rocket rejection path (unchanged)
    const reject = await call('PATCH', `/api/payments/${rocketId}/review`, { token: authorityToken, body: { status: 'rejected', note: 'No such TrxID' } });
    check('rejection still works', reject.status === 200 && reject.json?.data?.payment?.status === 'rejected', `status ${reject.status}`);
  } finally {
    if (conn) {
      await conn.query(`DELETE FROM users WHERE email LIKE ?`, [`pmtest.%`]);
      await conn.query(`DELETE FROM teachers WHERE name LIKE ?`, [`PMTEST-${stamp}%`]);
      await conn.end();
    }
    await new Promise((r) => server.close(r));
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`PAYMENT METHODS TEST RESULT: ${passed} passed, ${failed} failed`);
  if (failures.length) console.log(`\nFailures:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('paymentMethodsTest crashed:', err);
  process.exit(1);
});
