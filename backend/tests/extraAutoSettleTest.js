/**
 * Extra-contribution month-end settlement tests (contributionService.applyExtraSettlements).
 * Usage: cd backend && npm run extra-settle-test
 *
 * Every scenario runs on throwaway fixtures (extra.*@example.com) and calls the
 * service with an EXPLICIT userIds list, so a run can never settle a real
 * member's extra-contribution pool. `now` is injected, so the calendar cases
 * (last day vs. not) are deterministic regardless of today's date.
 *
 * CLEANUP removes only rows owned by this suite's fixtures (audit row first —
 * audit_logs has no user FK — then the users, which cascade payments,
 * monthly_payment_details, rates and notifications).
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { openTestDb } from './pgTestClient.js';

const stamp = Date.now();
const BASE = process.env.SMOKE_BASE || 'http://localhost:5000';
const EMAIL_LIKE = 'extra.%@example.com';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
const section = (title) => console.log(`\n${title}`);
const closeTo = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

// Fixed, injectable timeline: 2026 is not a leap year, so Feb 28 is the last
// day of February. The service is key-based, so these keys are valid regardless
// of the real current date.
const JAN = '2026-01';
const FEB = '2026-02';
const MAR = '2026-03';
const END_FEB = new Date(2026, 1, 28); // Feb 28, 2026 — last day of February
const BEFORE_END_FEB = new Date(2026, 1, 27); // Feb 27 — not the last day
const END_MAR = new Date(2026, 2, 31); // Mar 31 — last day of March

async function cleanupFixtures(phase) {
  let conn;
  try {
    conn = await openTestDb();
    const [auditRes] = await conn.query(
      `DELETE FROM audit_logs
        WHERE action = 'extra_contribution_settled'
          AND entity_id IN (SELECT user_id FROM users WHERE email LIKE ?)`,
      [EMAIL_LIKE]
    );
    const [userRes] = await conn.query('DELETE FROM users WHERE email LIKE ?', [EMAIL_LIKE]);
    console.log(`  (${phase} cleanup: ${auditRes.affectedRows || 0} audit row(s), ${userRes.affectedRows || 0} fixture user(s))`);
  } catch (err) {
    console.log(`  (${phase} cleanup skipped: ${err.code || err.message})`);
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

async function main() {
  const svc = await import('../src/services/contributionService.js');
  const { applyExtraSettlements } = svc;
  const { env } = await import('../src/config/env.js');

  await cleanupFixtures('pre-run');
  const conn = await openTestDb();

  const [[{ role_id: memberRoleId }]] = await conn.query(
    "SELECT role_id FROM roles WHERE role_name = 'MEMBER' LIMIT 1"
  );

  /** Create one throwaway member and return its user_id. */
  const mkUser = async (tag) => {
    const email = `extra.${tag}.${stamp}@example.com`;
    const [res] = await conn.query(
      `INSERT INTO users (role_id, first_name, last_name, email, password_hash, phone, status, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 'approved', 1) RETURNING user_id`,
      [memberRoleId, `Extra${tag}`, 'Tester', email, crypto.randomBytes(16).toString('hex'), '01700000000']
    );
    return Number(res.insertId);
  };

  /** Insert an approved monthly payment plus its allocation rows. */
  const mkMonthlyPayment = async (userId, tag, { billingMonth, amount, monthRows, status = 'success' }) => {
    const txn = `EXTRA-${stamp}-${tag}`.slice(0, 64);
    const [pay] = await conn.query(
      `INSERT INTO payments (user_id, payment_type, amount, payment_method, transaction_id, billing_month, status)
       VALUES (?, 'monthly', ?, 'test', ?, ?, ?) RETURNING payment_id`,
      [userId, amount, txn, billingMonth, status]
    );
    const paymentId = Number(pay.insertId);
    for (const r of monthRows) {
      await conn.query(
        `INSERT INTO monthly_payment_details (payment_id, user_id, payment_month, amount, extra_amount)
         VALUES (?, ?, ?, ?, ?)`,
        [paymentId, userId, r.month, r.amount, r.extra || 0]
      );
    }
    return paymentId;
  };

  const addRate = async (userId, amount, effectiveMonth) => {
    await conn.query(
      `INSERT INTO member_monthly_rates (user_id, amount, effective_month, source)
       VALUES (?, ?, ?, 'member')`,
      [userId, amount, effectiveMonth]
    );
  };

  const rowsOf = async (userId) => {
    const [rows] = await conn.query(
      `SELECT id, payment_id, payment_month, amount, extra_amount
         FROM monthly_payment_details WHERE user_id = ? ORDER BY payment_month, id`,
      [userId]
    );
    return rows.map((r) => ({
      id: Number(r.id), payment_id: Number(r.payment_id), month: r.payment_month,
      amount: Number(r.amount), extra: Number(r.extra_amount),
    }));
  };
  const totalsOf = async (paymentId) => {
    const [[row]] = await conn.query(
      `SELECT COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(extra_amount), 0) AS extra
         FROM monthly_payment_details WHERE payment_id = ?`,
      [paymentId]
    );
    return { amount: Number(row.amount), extra: Number(row.extra) };
  };

  try {
    /* ================================================================ */
    section('A) Users case: Jan paid ৳120 on a ৳50 rate (extra ৳70) -> Feb settles by ৳50 on Feb 28, ৳20 stays extra');
    const a = await mkUser('a');
    await addRate(a, 50, JAN);
    const aPay = await mkMonthlyPayment(a, 'a1', { billingMonth: JAN, amount: 120, monthRows: [{ month: JAN, amount: 120, extra: 70 }] });

    const repA = await applyExtraSettlements({ now: END_FEB, userIds: [a] });
    check('report: eligible_to = Feb 2026 on the last day of February', repA.eligible_to === FEB, `got ${repA.eligible_to}`);
    check('report: exactly one settlement, Feb by ৳50', repA.settled.length === 1
      && repA.settled[0].user_id === a && repA.settled[0].month === FEB && closeTo(repA.settled[0].amount, 50),
      JSON.stringify(repA.settled));

    let rowsA = await rowsOf(a);
    const janA = rowsA.find((r) => r.month === JAN);
    const febA = rowsA.find((r) => r.month === FEB);
    check('Feb has a ৳50 allocation, no extra', !!febA && closeTo(febA.amount, 50) && closeTo(febA.extra, 0));
    check('Jan keeps its exact ৳50 allocation (amount ৳70, extra ৳20)', !!janA && closeTo(janA.amount, 70) && closeTo(janA.extra, 20));
    check('Feb allocation belongs to the SAME payment (money re-labelled, not re-received)', febA?.payment_id === aPay);
    check('৳20 remains as extra contribution', closeTo(rowsA.reduce((s, r) => s + r.extra, 0), 20));

    const payTotalsA = await totalsOf(aPay);
    check('payment total unchanged (৳120) after the transfer', closeTo(payTotalsA.amount, 120), `got ${payTotalsA.amount}`);

    const [[notifA]] = await conn.query(
      `SELECT title, message, type FROM notifications
        WHERE recipient_id = ? AND type = 'contribution_updated' ORDER BY notification_id DESC LIMIT 1`,
      [a]
    );
    check('member notified: "settled ... Feb 2026"',
      !!notifA && /settled/i.test(notifA.title) && /Feb 2026/.test(notifA.message) && /50/.test(notifA.message),
      notifA ? `${notifA.title} — ${notifA.message}` : 'no notification');

    const [[auditA]] = await conn.query(
      `SELECT details FROM audit_logs
        WHERE action = 'extra_contribution_settled' AND entity = 'user' AND entity_id = ? LIMIT 1`,
      [a]
    );
    check('audit row recorded for the settlement', !!auditA && auditA.details?.month === FEB, JSON.stringify(auditA?.details || null));

    const repA2 = await applyExtraSettlements({ now: END_FEB, userIds: [a] });
    check('idempotent: a second run same day settles nothing', repA2.settled.length === 0, JSON.stringify(repA2.settled));
    const rowsA2 = await rowsOf(a);
    check('idempotent: no duplicate rows, totals unchanged', rowsA2.length === 2
      && closeTo(rowsA2.reduce((s, r) => s + r.amount, 0), 120));

    /* ================================================================ */
    section('B) Nothing settles before the month\'s last day');
    const b = await mkUser('b');
    await addRate(b, 50, JAN);
    await mkMonthlyPayment(b, 'b1', { billingMonth: JAN, amount: 120, monthRows: [{ month: JAN, amount: 120, extra: 70 }] });
    const repB = await applyExtraSettlements({ now: BEFORE_END_FEB, userIds: [b] });
    check('report: eligible_to = Jan 2026 on Feb 27', repB.eligible_to === JAN, `got ${repB.eligible_to}`);
    check('Feb is NOT settled before its last day', repB.settled.length === 0, JSON.stringify(repB.settled));
    const rowsB = await rowsOf(b);
    check('pool untouched (৳70 extra, no Feb row)', rowsB.length === 1 && closeTo(rowsB[0].extra, 70));

    /* ================================================================ */
    section('C) A month is never settled partially');
    const c = await mkUser('c');
    await addRate(c, 50, JAN);
    await addRate(c, 100, FEB);
    await mkMonthlyPayment(c, 'c1', { billingMonth: JAN, amount: 120, monthRows: [{ month: JAN, amount: 120, extra: 70 }] });
    const repC = await applyExtraSettlements({ now: END_FEB, userIds: [c] });
    check('pool ৳70 vs Feb due ৳100 -> nothing settled', repC.settled.length === 0, JSON.stringify(repC.settled));
    check('extra ৳70 stays available', (await rowsOf(c)).reduce((s, r) => s + r.extra, 0) === 70);

    /* ================================================================ */
    section('D) Oldest-first waterfall across several months');
    const d = await mkUser('d');
    await addRate(d, 50, JAN);
    await addRate(d, 30, FEB);
    await addRate(d, 30, MAR);
    await mkMonthlyPayment(d, 'd1', { billingMonth: JAN, amount: 120, monthRows: [{ month: JAN, amount: 120, extra: 70 }] });
    const repD = await applyExtraSettlements({ now: END_MAR, userIds: [d] });
    check('৳70 settles Feb ৳30 then Mar ৳30, in that order',
      repD.settled.length === 2 && repD.settled[0].month === FEB && repD.settled[1].month === MAR
      && closeTo(repD.settled[0].amount, 30) && closeTo(repD.settled[1].amount, 30),
      JSON.stringify(repD.settled));
    const rowsD = await rowsOf(d);
    check('৳10 remains extra after both settlements',
      closeTo(rowsD.reduce((s, r) => s + r.extra, 0), 10));

    /* ================================================================ */
    section('E) Waterfall stops at the first month it cannot cover');
    const e = await mkUser('e');
    await addRate(e, 50, JAN);
    await addRate(e, 30, FEB);
    await addRate(e, 50, MAR);
    await mkMonthlyPayment(e, 'e1', { billingMonth: JAN, amount: 120, monthRows: [{ month: JAN, amount: 120, extra: 70 }] });
    const repE = await applyExtraSettlements({ now: END_MAR, userIds: [e] });
    check('Feb ৳30 settles; Mar ৳50 is skipped (pool left ৳40)',
      repE.settled.length === 1 && repE.settled[0].month === FEB,
      JSON.stringify(repE.settled));
    const rowsE = await rowsOf(e);
    check('৳40 remains extra; Mar has no allocation', !rowsE.some((r) => r.month === MAR)
      && closeTo(rowsE.reduce((s, r) => s + r.extra, 0), 40));

    /* ================================================================ */
    section('F) Leftover ৳20 settles once the monthly contribution becomes ৳20');
    const f = await mkUser('f');
    await addRate(f, 50, JAN);
    await mkMonthlyPayment(f, 'f1', { billingMonth: JAN, amount: 120, monthRows: [{ month: JAN, amount: 120, extra: 70 }] });
    await applyExtraSettlements({ now: END_FEB, userIds: [f] }); // Feb settled, ৳20 left over
    await addRate(f, 20, MAR); // member updates the monthly contribution to ৳20
    const repF = await applyExtraSettlements({ now: END_MAR, userIds: [f] });
    check('Mar settles by ৳20 from the leftover at Mar 31',
      repF.settled.length === 1 && repF.settled[0].month === MAR && closeTo(repF.settled[0].amount, 20),
      JSON.stringify(repF.settled));
    const rowsF = await rowsOf(f);
    check('extra pool is now ৳0, Mar fully allocated', closeTo(rowsF.reduce((s, r) => s + r.extra, 0), 0)
      && closeTo(rowsF.find((r) => r.month === MAR)?.amount, 20));

    /* ================================================================ */
    section('G) A month with a payment awaiting verification is not settled');
    const g = await mkUser('g');
    await addRate(g, 50, JAN);
    await mkMonthlyPayment(g, 'g1', { billingMonth: JAN, amount: 120, monthRows: [{ month: JAN, amount: 120, extra: 70 }] });
    await mkMonthlyPayment(g, 'g2', {
      billingMonth: FEB, amount: 50, status: 'pending',
      monthRows: [] // pending payments write no allocation rows
    });
    const repG = await applyExtraSettlements({ now: END_FEB, userIds: [g] });
    check('pending Feb is skipped', repG.settled.length === 0, JSON.stringify(repG.settled));
    const rowsG = await rowsOf(g);
    check('pool untouched while Feb is pending, no Feb allocation written',
      rowsG.length === 1 && closeTo(rowsG[0].extra, 70));

    /* ================================================================ */
    section('H) Internal endpoint guard (no settlement is triggered without the secret)');
    try {
      const res = await fetch(`${BASE}/api/internal/contributions/apply-extra`, {
        method: 'POST',
        headers: env.cronSecret ? { 'x-cron-secret': `${crypto.randomBytes(8).toString('hex')}-wrong` } : {},
        signal: AbortSignal.timeout(3000),
      });
      const expected = env.cronSecret ? 401 : 503;
      check(`endpoint rejects the request (${expected}) without re-running the batch`,
        res.status === expected, `status ${res.status}`);
    } catch (err) {
      console.log(`  SKIP  endpoint guard not tested (server unreachable: ${err.code || err.message})`);
    }
  } finally {
    await conn.end().catch(() => {});
    await cleanupFixtures('post-run');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log('Failures:'); failures.forEach((f) => console.log(`  - ${f}`)); process.exitCode = 1; }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
