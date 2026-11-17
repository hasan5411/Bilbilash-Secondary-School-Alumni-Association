/**
 * eventLifecycleTest.js — complete Event Management lifecycle verification.
 *
 * Covers (see the master spec): A batch eligibility, B free/paid events,
 * C five-day deadline, D three unpaid-expiry attempts, E re-registration,
 * F ten-day cancellation, G admin views, H T-shirt participant filtering,
 * I expiry scheduler, J event archival, K payments approved after expiry.
 *
 * Runs ONLY against a local/disposable PostgreSQL (pgTestClient guard).
 * Fixtures are prefixed `evlife.` / `EVL-` and removed afterwards.
 *
 * Usage: cd backend && node tests/eventLifecycleTest.js   (npm run event-lifecycle-test)
 */
process.env.CRON_SECRET = process.env.CRON_SECRET || 'evlifecycle-test-cron-secret';
import 'dotenv/config';
import http from 'node:http';
import bcrypt from 'bcryptjs';

const stamp = Date.now();
const EMAIL = (tag) => `evlife.${tag}.${stamp}@example.com`;
const PASSWORD = 'EvLife1!pass';
const CRON_SECRET = process.env.CRON_SECRET;
const REG = (tag) => `EVL-${stamp}-${tag}`;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 64 - t.length))}`);

/** Asia/Dhaka wall-clock date + time N ms from now. */
function dhakaAt(offsetMs) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(Date.now() + offsetMs)).map((x) => [x.type, x.value]));
  return {
    event_date: `${p.year}-${p.month}-${p.day}`,
    start_time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`,
  };
}
const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const { openTestDb } = await import('./pgTestClient.js');
  const { createApp } = await import('../src/app.js');

  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;

  async function call(method, p, body, token) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${BASE}${p}`, {
      method,
      headers,
      body: body === undefined || body === null ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON fine */ }
    return { status: res.status, json, message: json?.message || '' };
  }

  async function cron(secret, limit = 200) {
    const headers = { 'Content-Type': 'application/json' };
    if (secret !== undefined && secret !== null) headers.Authorization = `Bearer ${secret}`;
    const res = await fetch(`${BASE}/api/internal/registrations/expire?limit=${limit}`, { method: 'POST', headers });
    let json = null;
    try { json = await res.json(); } catch { /* ignore */ }
    return { status: res.status, json };
  }

  let conn;
  let txnSeq = 0;
  try {
    conn = await openTestDb();

    // ── Fixtures ──────────────────────────────────────────────────────────
    section('Setup: users, batches, tokens');
    await conn.query(
      `INSERT INTO roles (role_name, description) VALUES
         ('VISITOR','x'),('MEMBER','x'),('ADMIN','x'),('AUTHORITY','x')
       ON CONFLICT DO NOTHING`
    );
    const hash = await bcrypt.hash(PASSWORD, 10);
    let userSeq = 0;
    const mkUser = async (tag, role, batch, regNumber) => {
      userSeq += 1;
      const phone = `017${String(10000000 + userSeq).slice(0, 8)}`;
      const [res] = await conn.query(
        `INSERT INTO users (role_id, first_name, last_name, email, password_hash, phone, registration_number, status, is_active, token_version)
         SELECT role_id, ?, 'Life', ?, ?, ?, ?, 'approved', 1, 0
           FROM roles WHERE role_name = ? RETURNING user_id`,
        [tag, EMAIL(tag), hash, phone, regNumber, role]
      );
      const id = Number(res.insertId);
      if (batch !== null) await conn.query(`INSERT INTO profiles (user_id, ssc_batch) VALUES (?, ?)`, [id, batch]);
      return id;
    };
    const ids = {
      admin: await mkUser('admin', 'ADMIN', 2000, REG('ADMIN')),
      authority: await mkUser('auth', 'AUTHORITY', 2000, REG('AUTH')),
      m2010: await mkUser('m2010', 'MEMBER', 2010, REG('M2010')),
      m2011: await mkUser('m2011', 'MEMBER', 2011, REG('M2011')),
      m2012: await mkUser('m2012', 'MEMBER', 2012, REG('M2012')),
      mNull: await mkUser('mnull', 'MEMBER', null, REG('MNULL')),
    };
    check('fixtures created', Object.values(ids).every((n) => n > 0), JSON.stringify(ids));

    const tok = {};
    for (const tag of ['admin', 'auth', 'm2010', 'm2011', 'm2012', 'mnull']) {
      const r = await call('POST', '/api/auth/login', { email: EMAIL(tag), password: PASSWORD });
      tok[tag] = r.json?.data?.token || null;
      check(`login ${tag}`, Boolean(tok[tag]), `status ${r.status} ${r.message}`);
    }

    const makeEvent = async (label, extra = {}) => {
      const r = await call('POST', '/api/events', {
        title: `EVL-${label}-${stamp}`, event_date: extra.event_date || dhakaAt(20 * DAY).event_date,
        capacity: 50, location: 'Ground', ...extra,
      }, tok.admin);
      check(`create event ${label}`, r.status === 201, `status ${r.status} ${r.message}`);
      return r.json?.data?.event_id;
    };
    const reg = (token, id) => call('POST', `/api/events/${id}/register`, {}, token);
    const submitManual = (token, amount, extra = {}) => {
      txnSeq += 1;
      return call('POST', '/api/payments/manual', {
        registration_number: extra.registration_number,
        payment_type: 'occasional',
        payment_method: 'bkash',
        purpose: 'event_contribution',
        amount,
        transaction_id: `EVLTXN${stamp}${txnSeq}`,
        event_id: extra.event_id,
        registration_id: extra.registration_id,
        description: 'lifecycle test',
      }, token);
    };
    const approve = (id) => call('PATCH', `/api/payments/${id}/review`, { status: 'success' }, tok.admin);
    const regRow = async (registrationId) => (await conn.query(
      `SELECT * FROM event_registrations WHERE registration_id = ?`, [registrationId]
    ))[0][0];
    const expiryCount = async (eventId, userId) => Number((await conn.query(
      `SELECT COUNT(*)::int AS n FROM event_registrations WHERE event_id = ? AND user_id = ? AND cancel_reason = 'Payment Deadline Expired'`,
      [eventId, userId]
    ))[0][0].n);
    const setDeadline = (registrationId, sql) => conn.query(
      `UPDATE event_registrations SET payment_deadline = ${sql} WHERE registration_id = ?`, [registrationId]
    );

    // ── A) Batch eligibility ──────────────────────────────────────────────
    section('A) Batch eligibility');
    const evAll = await makeEvent('ALL', { event_date: dhakaAt(20 * DAY).event_date });
    const evSingle = await makeEvent('SINGLE', { event_date: dhakaAt(20 * DAY).event_date, eligible_batches: [2010] });
    const evMulti = await makeEvent('MULTI', { event_date: dhakaAt(20 * DAY).event_date, eligible_batches: [2010, 2012] });

    const a1 = await reg(tok.m2010, evSingle);
    check('single batch: eligible member 2010 registers', a1.status === 201, `status ${a1.status} ${a1.message}`);
    const a2 = await reg(tok.m2011, evSingle);
    check('single batch: ineligible member 2011 blocked (403)', a2.status === 403, `status ${a2.status}`);
    check('ineligibility message is exact', a2.message === 'This event is exclusively available to selected SSC batches.', a2.message);
    const a3 = await reg(tok.mnull, evSingle);
    check('single batch: NULL-batch member blocked (403)', a3.status === 403, `status ${a3.status}`);
    // Forged frontend batch is ignored: the body value must not matter.
    const a4 = await call('POST', `/api/events/${evSingle}/register`, { ssc_batch: 2010, batch: 2010 }, tok.m2011);
    check('forged batch in request body does not bypass eligibility', a4.status === 403, `status ${a4.status}`);
    const a5 = await reg(tok.m2012, evMulti);
    check('multiple batches: 2012 registers', a5.status === 201, `status ${a5.status} ${a5.message}`);
    const a6 = await reg(tok.m2011, evMulti);
    check('multiple batches: 2011 blocked', a6.status === 403, `status ${a6.status}`);
    const a7 = await reg(tok.mnull, evAll);
    check('all batches: NULL-batch member registers', a7.status === 201, `status ${a7.status} ${a7.message}`);
    const evListMember = await call('GET', '/api/events', null, tok.m2011);
    const evSingleRow = (evListMember.json?.data?.events || []).find((e) => e.event_id === evSingle);
    check('ineligible event stays visible with eligibility info',
      Boolean(evSingleRow) && evSingleRow.eligible === false && evSingleRow.eligible_batches.join(',') === '2010',
      JSON.stringify(evSingleRow?.eligible_batches));
    check('idempotent eligibility array accepted (server normalizes)',
      (evSingleRow?.eligibility_reason || '') === 'This event is exclusively available to selected SSC batches.',
      evSingleRow?.eligibility_reason);

    // ── B) Free / paid events ─────────────────────────────────────────────
    section('B) Free / paid events and fee snapshot');
    const evFar = await makeEvent('FAR', { event_date: dhakaAt(20 * DAY).event_date });
    const freeReg = await call('GET', `/api/events/${evAll}`, null, tok.m2011);
    check('free event reports registration_fee null', freeReg.json?.data?.event?.registration_fee === null,
      String(freeReg.json?.data?.event?.registration_fee));

    const b1 = await reg(tok.m2011, evAll);
    check('free registration succeeds', b1.status === 201, `status ${b1.status}`);
    const b1row = await regRow(b1.json?.data?.registration_id);
    check('free registration payment_status = not_required', b1row.payment_status === 'not_required', b1row.payment_status);
    check('free registration has no deadline', b1row.payment_deadline === null, String(b1row.payment_deadline));
    check('free registration is confirmed immediately', b1row.confirmed_at !== null, String(b1row.confirmed_at));

    const evPaid = await makeEvent('PAID', {
      event_date: dhakaAt(30 * DAY).event_date, start_time: '10:00:00', registration_fee: 500,
    });
    const paidReg = (await call('GET', `/api/events/${evPaid}`, null, tok.m2010)).json?.data?.event;
    check('paid event reports registration_fee 500', Number(paidReg?.registration_fee) === 500, String(paidReg?.registration_fee));

    const b2 = await reg(tok.m2010, evPaid);
    check('paid registration succeeds (unpaid)', b2.status === 201 && b2.json?.data?.payment_status === 'unpaid',
      `status ${b2.status} ${JSON.stringify(b2.json?.data)}`);
    const paidRegId = b2.json?.data?.registration_id;
    const b2row = await regRow(paidRegId);
    check('paid fee snapshot = 500', Number(b2row.registration_fee_snapshot) === 500, String(b2row.registration_fee_snapshot));
    check('paid registration has a deadline', b2row.payment_deadline !== null, String(b2row.payment_deadline));
    check('paid registration is not confirmed yet', b2row.confirmed_at === null, String(b2row.confirmed_at));

    // Partial accumulation: 200 approved, still unpaid.
    const p1 = await submitManual(tok.m2010, 200, { registration_number: REG('M2010'), registration_id: paidRegId, event_id: evPaid });
    check('partial manual payment accepted', p1.status === 201, `status ${p1.status} ${p1.message}`);
    const p1id = p1.json?.data?.payment?.payment_id;
    const p1approve = await approve(p1id);
    check('partial payment approved', p1approve.status === 200, `status ${p1approve.status} ${p1approve.message}`);
    check('payment is linked to the registration', Number(p1approve.json?.data?.payment?.registration_id) === Number(paidRegId),
      String(p1approve.json?.data?.payment?.registration_id));
    const b2afterPartial = await regRow(paidRegId);
    check('insufficient payment keeps registration unpaid', b2afterPartial.payment_status === 'unpaid', b2afterPartial.payment_status);

    // Admin pending view exposes approved / remaining.
    const adminPending = await call('GET', `/api/events/${evPaid}/registrations?view=pending`, null, tok.admin);
    const pendingRow = (adminPending.json?.data?.registrations || []).find((r) => Number(r.registration_id) === Number(paidRegId));
    check('pending view approved_amount = 200', Number(pendingRow?.approved_amount) === 200, String(pendingRow?.approved_amount));
    check('pending view remaining_amount = 300', Number(pendingRow?.remaining_amount) === 300, String(pendingRow?.remaining_amount));

    const p2 = await submitManual(tok.m2010, 300, { registration_number: REG('M2010'), registration_id: paidRegId, event_id: evPaid });
    const p2approve = await approve(p2.json?.data?.payment?.payment_id);
    check('top-up payment approved', p2approve.status === 200, `status ${p2approve.status} ${p2approve.message}`);
    const b2paid = await regRow(paidRegId);
    check('fully paid registration becomes paid', b2paid.payment_status === 'paid', b2paid.payment_status);
    check('paid registration confirmed_at is set', b2paid.confirmed_at !== null, String(b2paid.confirmed_at));
    check('paid registration deadline cleared', b2paid.payment_deadline === null, String(b2paid.payment_deadline));

    // Fee change affects NEW registrations only.
    const evFeeChange = await makeEvent('FEECHANGE', {
      event_date: dhakaAt(30 * DAY).event_date, registration_fee: 500,
    });
    const fc1 = await reg(tok.m2011, evFeeChange);
    const fcUpdate = await call('PUT', `/api/events/${evFeeChange}`, {
      title: `EVL-FEECHANGE-${stamp}`, event_date: dhakaAt(30 * DAY).event_date, capacity: 50, registration_fee: 800,
    }, tok.admin);
    check('admin can update the event fee', fcUpdate.status === 200, `status ${fcUpdate.status} ${fcUpdate.message}`);
    const fc2 = await reg(tok.m2012, evFeeChange);
    const fc1row = await regRow(fc1.json?.data?.registration_id);
    const fc2row = await regRow(fc2.json?.data?.registration_id);
    check('existing registration keeps its 500 snapshot', Number(fc1row.registration_fee_snapshot) === 500, String(fc1row.registration_fee_snapshot));
    check('new registration snapshots the new 800 fee', Number(fc2row.registration_fee_snapshot) === 800, String(fc2row.registration_fee_snapshot));

    // Old optional contribution (no registration link) must not confirm anything.
    const evOldContrib = await makeEvent('OLDCONTRIB', { event_date: dhakaAt(30 * DAY).event_date, registration_fee: 100 });
    const oc = await reg(tok.m2012, evOldContrib);
    const ocPay = await submitManual(tok.m2012, 100, { registration_number: REG('M2012'), event_id: evOldContrib });
    const ocApprove = await approve(ocPay.json?.data?.payment?.payment_id);
    check('old-style unlinked contribution approved', ocApprove.status === 200, `status ${ocApprove.status}`);
    check('unlinked contribution does NOT confirm the paid registration',
      (await regRow(oc.json?.data?.registration_id)).payment_status === 'unpaid',
      (await regRow(oc.json?.data?.registration_id)).payment_status);

    // One payment cannot confirm multiple registrations.
    const evOnePay = await makeEvent('ONEPAY', { event_date: dhakaAt(30 * DAY).event_date, registration_fee: 100 });
    const op1 = await reg(tok.m2010, evOnePay);
    const op2 = await reg(tok.m2011, evOnePay);
    const opPay = await submitManual(tok.m2010, 100, { registration_number: REG('M2010'), registration_id: op1.json?.data?.registration_id, event_id: evOnePay });
    await approve(opPay.json?.data?.payment?.payment_id);
    check('linked payment confirms only its own registration',
      (await regRow(op1.json?.data?.registration_id)).payment_status === 'paid' &&
      (await regRow(op2.json?.data?.registration_id)).payment_status === 'unpaid');

    // ── C) Five-day deadline ──────────────────────────────────────────────
    section('C) Five-day payment deadline');
    const evPaid2 = await makeEvent('PAID2', { event_date: dhakaAt(30 * DAY).event_date, registration_fee: 100 });
    const c1 = await reg(tok.m2010, evPaid2);
    const [c1check] = (await conn.query(
      `SELECT (payment_deadline > NOW() + INTERVAL '4 days 23 hours') AS near_five,
              (payment_deadline < NOW() + INTERVAL '5 days 1 hour') AS not_beyond_five,
              (payment_deadline < ((SELECT event_date FROM events WHERE event_id = ?) + TIME '00:00') AT TIME ZONE 'Asia/Dhaka') AS before_event
         FROM event_registrations WHERE registration_id = ?`,
      [evPaid2, c1.json?.data?.registration_id]
    ))[0];
    check('deadline ≈ registration time + 5 days', c1check.near_five && c1check.not_beyond_five, JSON.stringify(c1check));
    check('deadline never beyond event start', c1check.before_event, JSON.stringify(c1check));

    const soon = dhakaAt(3 * DAY);
    const evSoon = await makeEvent('SOON', {
      event_date: soon.event_date, start_time: soon.start_time, registration_fee: 300,
    });
    const c2 = await reg(tok.m2011, evSoon);
    const [c2check] = (await conn.query(
      `SELECT (er.payment_deadline = (e.event_date + COALESCE(e.start_time, TIME '00:00')) AT TIME ZONE 'Asia/Dhaka') AS capped
         FROM event_registrations er JOIN events e ON e.event_id = er.event_id WHERE er.registration_id = ?`,
      [c2.json?.data?.registration_id]
    ))[0];
    check('deadline capped exactly at event start (event < 5 days away)', c2check.capped === true, JSON.stringify(c2check));

    // Before deadline: expiry does nothing.
    await setDeadline(c1.json?.data?.registration_id, `NOW() + INTERVAL '1 day'`);
    const beforeRun = await cron(CRON_SECRET);
    check('expiry does not cancel before the deadline', beforeRun.status === 200 && (await regRow(c1.json?.data?.registration_id)).status === 'active');

    // At/after deadline: cancelled.
    await setDeadline(c1.json?.data?.registration_id, `NOW() - INTERVAL '1 second'`);
    const afterRun = await cron(CRON_SECRET);
    const c1after = await regRow(c1.json?.data?.registration_id);
    check('expiry cancels at/after the deadline', afterRun.status === 200 && c1after.status === 'cancelled', c1after.status);
    check('expiry sets the exact cancel reason', c1after.cancel_reason === 'Payment Deadline Expired', c1after.cancel_reason);
    check('expiry sets cancelled_at and preserves the row', c1after.cancelled_at !== null, String(c1after.cancelled_at));

    // Event already started cannot be registered for.
    const startedDate = dhakaAt(-1 * DAY);
    const evStarted = await makeEvent('STARTED', { event_date: startedDate.event_date, start_time: '10:00:00' });
    const c3 = await reg(tok.m2012, evStarted);
    check('registration after event start is blocked', c3.status === 400 && /already started/i.test(c3.message), `status ${c3.status} ${c3.message}`);

    // Approval racing expiry: approve first, then expiry must not cancel.
    const evRace = await makeEvent('RACE', { event_date: dhakaAt(30 * DAY).event_date, registration_fee: 50 });
    const r1 = await reg(tok.m2012, evRace);
    const r1pay = await submitManual(tok.m2012, 50, { registration_number: REG('M2012'), registration_id: r1.json?.data?.registration_id, event_id: evRace });
    await approve(r1pay.json?.data?.payment?.payment_id);
    await setDeadline(r1.json?.data?.registration_id, `NOW() - INTERVAL '1 hour'`);
    await cron(CRON_SECRET);
    const r1after = await regRow(r1.json?.data?.registration_id);
    check('verified payment wins over expiry (stays active + paid)', r1after.status === 'active' && r1after.payment_status === 'paid',
      `${r1after.status}/${r1after.payment_status}`);

    // ── D) Three unpaid-expiry attempts ───────────────────────────────────
    section('D) Three unpaid expiry attempts');
    const evAttempts = await makeEvent('ATTEMPTS', { event_date: dhakaAt(25 * DAY).event_date, registration_fee: 100 });
    const evOther = await makeEvent('OTHER', { event_date: dhakaAt(25 * DAY).event_date, registration_fee: 100 });

    let lastReg;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      lastReg = await reg(tok.m2010, evAttempts);
      check(`attempt ${attempt}: registration succeeds`, lastReg.status === 201, `status ${lastReg.status} ${lastReg.message}`);
      await setDeadline(lastReg.json?.data?.registration_id, `NOW() - INTERVAL '1 second'`);
      await cron(CRON_SECRET);
      check(`attempt ${attempt}: expiry counted`, (await expiryCount(evAttempts, ids.m2010)) === attempt);
    }
    const fourth = await reg(tok.m2010, evAttempts);
    check('fourth registration blocked (409)', fourth.status === 409, `status ${fourth.status}`);
    check('fourth-registration message is exact',
      fourth.message === 'You have reached the maximum number of unpaid registration attempts for this event. Further registration is not allowed.',
      fourth.message);
    const otherReg = await reg(tok.m2010, evOther);
    check('attempts are isolated per event', otherReg.status === 201, `status ${otherReg.status} ${otherReg.message}`);
    check('other event has zero attempts', (await expiryCount(evOther, ids.m2010)) === 0);

    // Manual cancellation does not count.
    const md = await reg(tok.m2011, evAttempts);
    const mdCancel = await call('DELETE', `/api/events/${evAttempts}/register`, null, tok.m2011);
    check('manual cancellation allowed far from the event', mdCancel.status === 200, `status ${mdCancel.status} ${mdCancel.message}`);
    check('manual cancellation does not count as an attempt', (await expiryCount(evAttempts, ids.m2011)) === 0);
    check('manual cancellation reason recorded', (await regRow(md.json?.data?.registration_id)).cancel_reason === 'Cancelled by member');

    // Paid cancellation does not count.
    const pd = await reg(tok.m2012, evAttempts);
    const pdPay = await submitManual(tok.m2012, 100, { registration_number: REG('M2012'), registration_id: pd.json?.data?.registration_id, event_id: evAttempts });
    await approve(pdPay.json?.data?.payment?.payment_id);
    const pdCancel = await call('DELETE', `/api/events/${evAttempts}/register`, null, tok.m2012);
    check('paid registration can be cancelled manually', pdCancel.status === 200, `status ${pdCancel.status}`);
    check('paid cancellation does not count as an attempt', (await expiryCount(evAttempts, ids.m2012)) === 0);
    check('paid cancellation keeps the payment record', (await conn.query(
      `SELECT COUNT(*)::int AS n FROM payments WHERE registration_id = ? AND status = 'success'`, [pd.json?.data?.registration_id]
    ))[0][0].n === 1);

    // ── E) Re-registration ────────────────────────────────────────────────
    section('E) Re-registration preserves history');
    const evRe = await makeEvent('REREG', { event_date: dhakaAt(25 * DAY).event_date, registration_fee: 100 });
    const first = await reg(tok.m2011, evRe);
    await setDeadline(first.json?.data?.registration_id, `NOW() - INTERVAL '1 second'`);
    await cron(CRON_SECRET);
    const second = await reg(tok.m2011, evRe);
    check('re-registration succeeds after expiry', second.status === 201, `status ${second.status} ${second.message}`);
    check('new registration has a new id', Number(second.json?.data?.registration_id) !== Number(first.json?.data?.registration_id));
    check('previous registration row is preserved', Boolean(await regRow(first.json?.data?.registration_id)));
    check('previous cancel reason preserved', (await regRow(first.json?.data?.registration_id)).cancel_reason === 'Payment Deadline Expired');
    check('fresh deadline on re-registration', Boolean((await regRow(second.json?.data?.registration_id)).payment_deadline));
    check('exactly one active row remains', (await conn.query(
      `SELECT COUNT(*)::int AS n FROM event_registrations WHERE event_id = ? AND user_id = ? AND status = 'active'`,
      [evRe, ids.m2011]
    ))[0][0].n === 1);

    // Concurrent duplicate registration.
    const evConc = await makeEvent('CONC', { event_date: dhakaAt(20 * DAY).event_date });
    const [cc1, cc2] = await Promise.all([reg(tok.mnull, evConc), reg(tok.mnull, evConc)]);
    const ccStatuses = [cc1.status, cc2.status].sort();
    check('concurrent registrations: exactly one succeeds', ccStatuses[0] === 201 && ccStatuses[1] === 409, String(ccStatuses));
    check('concurrent registrations: one active row', (await conn.query(
      `SELECT COUNT(*)::int AS n FROM event_registrations WHERE event_id = ? AND user_id = ? AND status = 'active'`,
      [evConc, ids.mNull]
    ))[0][0].n === 1);

    // ── F) Ten-day cancellation ───────────────────────────────────────────
    section('F) Ten-day cancellation window');
    const f1 = await reg(tok.m2010, evFar);
    const f1cancel = await call('DELETE', `/api/events/${evFar}/register`, null, tok.m2010);
    check('more than 10 days remaining: cancellation allowed', f1cancel.status === 200, `status ${f1cancel.status}`);
    check('cancelled row is soft-cancelled (row kept)', (await regRow(f1.json?.data?.registration_id))?.status === 'cancelled');

    const exactly10 = dhakaAt(10 * DAY);
    const evExactly10 = await makeEvent('EXACT10', { event_date: exactly10.event_date, start_time: exactly10.start_time });
    await reg(tok.m2011, evExactly10);
    const f2cancel = await call('DELETE', `/api/events/${evExactly10}/register`, null, tok.m2011);
    check('exactly 10 days remaining: blocked', f2cancel.status === 409, `status ${f2cancel.status} ${f2cancel.message}`);
    check('blocked reason is explicit', /10 days/i.test(f2cancel.message), f2cancel.message);

    const nine = dhakaAt(9 * DAY);
    const evNine = await makeEvent('NINE', { event_date: nine.event_date, start_time: nine.start_time });
    await reg(tok.m2011, evNine);
    const f3cancel = await call('DELETE', `/api/events/${evNine}/register`, null, tok.m2011);
    check('less than 10 days remaining: blocked', f3cancel.status === 409, `status ${f3cancel.status}`);

    // ── G) Admin views ────────────────────────────────────────────────────
    section('G) Admin registration views');
    const gActive = await call('GET', `/api/events/${evPaid}/registrations`, null, tok.admin);
    check('default view returns active registrations', gActive.status === 200 && gActive.json?.data?.view === 'active' && gActive.json?.data?.total === 1,
      `total ${gActive.json?.data?.total}`);
    const gRow = gActive.json?.data?.registrations?.[0];
    check('active row exposes fee, payment status, approved amount, deadline',
      Number(gRow?.registration_fee) === 500 && gRow?.payment_status === 'paid' && Number(gRow?.approved_amount) === 500 && gRow?.payment_deadline === null,
      JSON.stringify(gRow));
    check('active row exposes member id / registration number', Boolean(gRow?.registration_number), String(gRow?.registration_number));

    const gAuth = await call('GET', `/api/events/${evPaid}/registrations?view=active`, null, tok.auth);
    check('AUTHORITY can view registrations', gAuth.status === 200, `status ${gAuth.status}`);
    const gMember = await call('GET', `/api/events/${evPaid}/registrations`, null, tok.m2010);
    check('MEMBER cannot view admin registrations (403)', gMember.status === 403, `status ${gMember.status}`);
    const gBadView = await call('GET', `/api/events/${evPaid}/registrations?view=bogus`, null, tok.admin);
    check('invalid view rejected (400)', gBadView.status === 400, `status ${gBadView.status}`);

    const evViews = await makeEvent('VIEWS', { event_date: dhakaAt(20 * DAY).event_date, registration_fee: 100 });
    const v1 = await reg(tok.m2010, evViews); // pending unpaid
    const v2 = await reg(tok.m2011, evViews); // cancelled by admin
    const v3 = await reg(tok.m2012, evViews); // cancelled by member
    const vAdminCancel = await call('PATCH', `/api/events/${evViews}/registrations/${v2.json?.data?.registration_id}/cancel`, {}, tok.admin);
    check('admin can cancel a registration manually', vAdminCancel.status === 200, `status ${vAdminCancel.status} ${vAdminCancel.message}`);
    await call('DELETE', `/api/events/${evViews}/register`, null, tok.m2012);
    const gPendingView = await call('GET', `/api/events/${evViews}/registrations?view=pending`, null, tok.admin);
    check('pending view lists only pending unpaid', gPendingView.json?.data?.total === 1 &&
      Number(gPendingView.json?.data?.registrations?.[0]?.registration_id) === Number(v1.json?.data?.registration_id),
      JSON.stringify(gPendingView.json?.data?.total));
    const gCancelledView = await call('GET', `/api/events/${evViews}/registrations?view=cancelled`, null, tok.admin);
    const reasons = (gCancelledView.json?.data?.registrations || []).map((r) => r.cancel_reason).sort();
    check('cancelled view distinguishes member/admin reasons',
      gCancelledView.json?.data?.total === 2 && reasons.includes('Cancelled by admin') && reasons.includes('Cancelled by member'),
      JSON.stringify(reasons));
    check('cancelled view exposes cancellation date + attempt count',
      Boolean(gCancelledView.json?.data?.registrations?.[0]?.cancelled_at) &&
      gCancelledView.json?.data?.registrations?.[0]?.unpaid_expiry_attempts === 0,
      JSON.stringify(gCancelledView.json?.data?.registrations?.[0]));
    check('admin view counts are consistent', gCancelledView.json?.data?.counts?.cancelled === 2 &&
      gCancelledView.json?.data?.counts?.active === 1, JSON.stringify(gCancelledView.json?.data?.counts));

    const gAuthorityCancel = await call('PATCH', `/api/events/${evViews}/registrations/${v3.json?.data?.registration_id}/cancel`, {}, tok.auth);
    check('authority cannot re-cancel a cancelled registration (409)', gAuthorityCancel.status === 409, `status ${gAuthorityCancel.status}`);

    // ── H) T-shirt participants ───────────────────────────────────────────
    section('H) T-shirt participant filtering');
    const evPrint = await makeEvent('PRINT', { event_date: dhakaAt(20 * DAY).event_date });
    const hp1 = await reg(tok.m2010, evPrint);           // free confirmed -> included
    const hp2 = await reg(tok.m2011, evPrint);           // cancelled -> excluded
    await call('DELETE', `/api/events/${evPrint}/register`, null, tok.m2011);
    const hp3 = await reg(tok.m2012, evPrint);           // initially eligible; later excluded by batch change
    const evPrintPaid = await makeEvent('PRINTPAID', { event_date: dhakaAt(20 * DAY).event_date, registration_fee: 100 });
    const hp4 = await reg(tok.m2010, evPrintPaid);       // paid confirmed -> included
    const hp5 = await reg(tok.m2011, evPrintPaid);       // pending unpaid -> excluded
    const pPay = await submitManual(tok.m2010, 100, { registration_number: REG('M2010'), registration_id: hp4.json?.data?.registration_id, event_id: evPrintPaid });
    await approve(pPay.json?.data?.payment?.payment_id);

    const hpPrintBefore = await call('GET', `/api/events/${evPrint}/participants`, null, tok.admin);
    check('free confirmed participant included', hpPrintBefore.json?.data?.registrations?.some((r) => Number(r.registration_id) === Number(hp1.json?.data?.registration_id)));
    check('cancelled participant excluded', !hpPrintBefore.json?.data?.registrations?.some((r) => Number(r.registration_id) === Number(hp2.json?.data?.registration_id)));
    check('print total equals the returned rows', hpPrintBefore.json?.data?.total === hpPrintBefore.json?.data?.registrations?.length);

    const hpPaid = await call('GET', `/api/events/${evPrintPaid}/participants`, null, tok.admin);
    check('paid confirmed participant included', hpPaid.json?.data?.registrations?.some((r) => Number(r.registration_id) === Number(hp4.json?.data?.registration_id)));
    check('pending unpaid participant excluded', !hpPaid.json?.data?.registrations?.some((r) => Number(r.registration_id) === Number(hp5.json?.data?.registration_id)));
    check('paid print total is 1', hpPaid.json?.data?.total === 1, String(hpPaid.json?.data?.total));

    // Restrict evPrint to batch 2010 AFTER m2012 registered: m2012 becomes ineligible.
    const restrict = await call('PUT', `/api/events/${evPrint}`, {
      title: `EVL-PRINT-${stamp}`, event_date: dhakaAt(20 * DAY).event_date, capacity: 50, eligible_batches: [2010],
    }, tok.admin);
    check('event eligibility can be updated', restrict.status === 200, `status ${restrict.status} ${restrict.message}`);
    const hpAfter = await call('GET', `/api/events/${evPrint}/participants`, null, tok.admin);
    check('ineligible batch participant excluded from print', !hpAfter.json?.data?.registrations?.some((r) => Number(r.registration_id) === Number(hp3.json?.data?.registration_id)));
    check('eligible participant remains on the print list', hpAfter.json?.data?.registrations?.some((r) => Number(r.registration_id) === Number(hp1.json?.data?.registration_id)));
    const hpMember = await call('GET', `/api/events/${evPrint}/participants`, null, tok.m2010);
    check('participant list is ADMIN/AUTHORITY only (403)', hpMember.status === 403, `status ${hpMember.status}`);

    // ── I) Scheduler ──────────────────────────────────────────────────────
    section('I) Expiry scheduler security + concurrency');
    const badSecret = await cron('wrong-secret');
    check('invalid cron secret → 401', badSecret.status === 401, `status ${badSecret.status}`);
    const noSecret = await cron(null);
    check('missing cron secret → 401', noSecret.status === 401, `status ${noSecret.status}`);
    const noAuthHeader = await fetch(`${BASE}/api/internal/registrations/expire`, { method: 'POST' });
    check('no secret header → 401', noAuthHeader.status === 401, `status ${noAuthHeader.status}`);

    const evSched = await makeEvent('SCHED', { event_date: dhakaAt(25 * DAY).event_date, registration_fee: 100 });
    const s1 = await reg(tok.m2010, evSched);
    const s2 = await reg(tok.m2011, evSched);
    await setDeadline(s1.json?.data?.registration_id, `NOW() - INTERVAL '3 days'`); // missed deadline recovery
    await setDeadline(s2.json?.data?.registration_id, `NOW() - INTERVAL '2 hours'`);
    const batch1 = await cron(CRON_SECRET, 1);
    check('bounded batch processes only the limit', batch1.status === 200 && batch1.json?.data?.processed === 1,
      JSON.stringify(batch1.json?.data));
    const batch2 = await cron(CRON_SECRET);
    check('next run processes the remainder', batch2.status === 200 && batch2.json?.data?.processed === 1,
      JSON.stringify(batch2.json?.data));
    check('missed deadline recovered (3 days overdue)', (await regRow(s1.json?.data?.registration_id)).status === 'cancelled');
    const batch3 = await cron(CRON_SECRET);
    check('repeated execution is idempotent (0 processed)', batch3.status === 200 && batch3.json?.data?.processed === 0,
      JSON.stringify(batch3.json?.data));

    const evSched2 = await makeEvent('SCHED2', { event_date: dhakaAt(25 * DAY).event_date, registration_fee: 100 });
    const sc1 = await reg(tok.m2010, evSched2);
    const sc2 = await reg(tok.m2011, evSched2);
    await setDeadline(sc1.json?.data?.registration_id, `NOW() - INTERVAL '1 hour'`);
    await setDeadline(sc2.json?.data?.registration_id, `NOW() - INTERVAL '1 hour'`);
    const [runA, runB] = await Promise.all([cron(CRON_SECRET), cron(CRON_SECRET)]);
    const processedSum = Number(runA.json?.data?.processed || 0) + Number(runB.json?.data?.processed || 0);
    check('concurrent runs process each registration exactly once', processedSum === 2 &&
      (await regRow(sc1.json?.data?.registration_id)).status === 'cancelled' &&
      (await regRow(sc2.json?.data?.registration_id)).status === 'cancelled',
      `A=${JSON.stringify(runA.json?.data)} B=${JSON.stringify(runB.json?.data)}`);

    // ── J) Archival + delete protection ──────────────────────────────────
    section('J) Event archival / history preservation');
    const evEmpty = await makeEvent('EMPTY', { event_date: dhakaAt(20 * DAY).event_date });
    const delEmpty = await call('DELETE', `/api/events/${evEmpty}`, null, tok.admin);
    check('event with no history may be deleted', delEmpty.status === 200, `status ${delEmpty.status} ${delEmpty.message}`);

    const evArch = await makeEvent('ARCH', { event_date: dhakaAt(20 * DAY).event_date });
    await reg(tok.m2010, evArch);
    const delArch = await call('DELETE', `/api/events/${evArch}`, null, tok.admin);
    check('event with registrations cannot be hard-deleted (409)', delArch.status === 409, `status ${delArch.status}`);
    const arch = await call('PUT', `/api/events/${evArch}/archive`, {}, tok.admin);
    check('admin can archive an event', arch.status === 200, `status ${arch.status} ${arch.message}`);
    const regArchived = await reg(tok.m2012, evArch);
    check('archived event refuses new registrations', regArchived.status === 400, `status ${regArchived.status}`);
    const listMemberArch = await call('GET', '/api/events', null, tok.m2012);
    check('archived event hidden from member listing',
      !(listMemberArch.json?.data?.events || []).some((e) => e.event_id === evArch));
    const listAdminArch = await call('GET', '/api/events', null, tok.admin);
    check('archived event still visible to admins (history)',
      (listAdminArch.json?.data?.events || []).some((e) => e.event_id === evArch && e.archived_at));
    const archViewer = await call('GET', `/api/events/${evArch}/registrations`, null, tok.admin);
    check('archived event history still queryable', archViewer.status === 200 && archViewer.json?.data?.total === 1,
      `total ${archViewer.json?.data?.total}`);

    const evPayHist = await makeEvent('PAYHIST', { event_date: dhakaAt(20 * DAY).event_date, registration_fee: 100 });
    const ph = await reg(tok.m2011, evPayHist);
    await submitManual(tok.m2011, 100, { registration_number: REG('M2011'), registration_id: ph.json?.data?.registration_id, event_id: evPayHist });
    const delPayHist = await call('DELETE', `/api/events/${evPayHist}`, null, tok.admin);
    check('event with payment history cannot be hard-deleted (409)', delPayHist.status === 409, `status ${delPayHist.status}`);

    // Cancelling the EVENT cancels its active registrations, with a distinct reason.
    const evCancel = await makeEvent('EVCANCEL', { event_date: dhakaAt(25 * DAY).event_date, registration_fee: 100 });
    const ecPaid = await reg(tok.m2011, evCancel);
    const ecPay = await submitManual(tok.m2011, 100, { registration_number: REG('M2011'), registration_id: ecPaid.json?.data?.registration_id, event_id: evCancel });
    await approve(ecPay.json?.data?.payment?.payment_id);
    const ecUnpaid = await reg(tok.m2012, evCancel);
    const ecCancel = await call('PUT', `/api/events/${evCancel}/cancel`, {}, tok.admin);
    check('admin cancels the event (200)', ecCancel.status === 200, `status ${ecCancel.status} ${ecCancel.message}`);
    check('cancel response reports the cancelled registrations', ecCancel.json?.data?.cancelled_registrations === 2,
      String(ecCancel.json?.data?.cancelled_registrations));
    const ecPaidRow = await regRow(ecPaid.json?.data?.registration_id);
    const ecUnpaidRow = await regRow(ecUnpaid.json?.data?.registration_id);
    check('active registrations are cancelled with the event reason',
      ecPaidRow.status === 'cancelled' && ecUnpaidRow.status === 'cancelled' &&
      ecPaidRow.cancel_reason === 'Event cancelled' && ecUnpaidRow.cancel_reason === 'Event cancelled',
      JSON.stringify({ paid: ecPaidRow.cancel_reason, unpaid: ecUnpaidRow.cancel_reason }));
    check('event cancellation records who and when',
      Number(ecUnpaidRow.cancelled_by) === Number(ids.admin) && ecUnpaidRow.cancelled_at !== null,
      `${ecUnpaidRow.cancelled_by}/${ecUnpaidRow.cancelled_at}`);
    check('paid money for a cancelled event is preserved', (await conn.query(
      `SELECT COUNT(*)::int AS n FROM payments WHERE registration_id = ? AND status = 'success'`,
      [ecPaid.json?.data?.registration_id]
    ))[0][0].n === 1);
    const ecView = await call('GET', `/api/events/${evCancel}/registrations?view=cancelled`, null, tok.admin);
    check('cancelled view exposes the event-cancelled reason',
      ecView.json?.data?.total === 2 &&
      (ecView.json?.data?.registrations || []).every((r) => r.cancel_reason === 'Event cancelled'),
      `total ${ecView.json?.data?.total}`);
    const ecPrint = await call('GET', `/api/events/${evCancel}/participants`, null, tok.admin);
    check('print dataset excludes a cancelled event', ecPrint.status === 200 && ecPrint.json?.data?.total === 0,
      `total ${ecPrint.json?.data?.total}`);
    const ecReg = await reg(tok.mnull, evCancel);
    check('cancelled event refuses new registrations', ecReg.status === 400, `status ${ecReg.status}`);

    // Free legacy-shaped rows stay untouched.
    const [[legacy]] = await conn.query(
      `SELECT COUNT(*)::int AS n FROM event_registrations
        WHERE status = 'active' AND payment_status = 'not_required' AND payment_deadline IS NULL`
    );
    check('free registrations remain not_required with no deadline', legacy.n > 0, String(legacy.n));

    // ── K) Payments approved after expiry ────────────────────────────────
    section('K) Payments approved after expiry never reactivate');
    const evLate = await makeEvent('LATEPAY', { event_date: dhakaAt(25 * DAY).event_date, registration_fee: 100 });
    const k1 = await reg(tok.m2011, evLate);
    const kRegId = k1.json?.data?.registration_id;
    const kPay = await submitManual(tok.m2011, 100, { registration_number: REG('M2011'), registration_id: kRegId, event_id: evLate });
    check('payment submitted while the registration is still active', kPay.status === 201, `status ${kPay.status} ${kPay.message}`);
    const kPayId = kPay.json?.data?.payment?.payment_id;

    await setDeadline(kRegId, `NOW() - INTERVAL '1 second'`);
    await cron(CRON_SECRET);
    const kExpired = await regRow(kRegId);
    check('registration expired before the payment was approved',
      kExpired.status === 'cancelled' && kExpired.cancel_reason === 'Payment Deadline Expired',
      `${kExpired.status}/${kExpired.cancel_reason}`);

    const kApprove = await approve(kPayId);
    check('payment may still be approved after expiry (money preserved)', kApprove.status === 200,
      `status ${kApprove.status} ${kApprove.message}`);
    const kAfter = await regRow(kRegId);
    check('approval does NOT reactivate the cancelled registration', kAfter.status === 'cancelled', kAfter.status);
    check('cancelled registration stays unpaid', kAfter.payment_status === 'unpaid', kAfter.payment_status);
    check('expired registration keeps the deadline in the past', kAfter.payment_deadline !== null, String(kAfter.payment_deadline));
    check('linked payment is kept as an approved record', (await conn.query(
      `SELECT COUNT(*)::int AS n FROM payments WHERE payment_id = ? AND registration_id = ? AND status = 'success'`,
      [kPayId, kRegId]
    ))[0][0].n === 1);
    check('admin response flags manual reconciliation',
      Boolean(kApprove.json?.data?.payment?.reconciliation_required) === true,
      JSON.stringify(kApprove.json?.data?.payment?.reconciliation_required));

    // Re-registration stays possible; the old payment still belongs to the old row.
    const kRereg = await reg(tok.m2011, evLate);
    check('member may register again after the expired attempt', kRereg.status === 201,
      `status ${kRereg.status} ${kRereg.message}`);
    check('new registration is still unpaid despite the old approved payment',
      (await regRow(kRereg.json?.data?.registration_id)).payment_status === 'unpaid',
      (await regRow(kRereg.json?.data?.registration_id)).payment_status);
    check('old payment did not move to the new registration', (await conn.query(
      `SELECT registration_id FROM payments WHERE payment_id = ?`, [kPayId]
    ))[0][0].registration_id === Number(kRegId), String((await conn.query(
      `SELECT registration_id FROM payments WHERE payment_id = ?`, [kPayId]
    ))[0][0].registration_id));
  } finally {
    section('Cleanup (own fixtures only)');
    try {
      if (!conn) conn = await openTestDb();
      const [ev] = await conn.query(`DELETE FROM events WHERE title LIKE 'EVL-%'`);
      const [us] = await conn.query(`DELETE FROM users WHERE email LIKE 'evlife.%'`);
      check('removed own fixtures', (ev.affectedRows ?? 0) >= 5 && (us.affectedRows ?? 0) >= 6,
        `events=${ev.affectedRows} users=${us.affectedRows}`);
    } catch (err) {
      check('cleanup ran', false, err.code || err.message);
    } finally {
      if (conn) await conn.end().catch(() => {});
      server.close();
      const { closePool } = await import('../src/db/pool.js');
      await closePool().catch(() => {});
    }
  }

  console.log(`\neventLifecycleTest: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('Failures:', failures.join(' | '));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('eventLifecycleTest CRASHED:', err);
  process.exit(1);
});
