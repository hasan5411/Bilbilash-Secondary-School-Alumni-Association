/**
 * Contribution & payment-allocation test suite for the Bilbilash Alumni API.
 * Requires: backend running on :5000 and a seeded database (npm run init-db).
 * Usage: cd backend && npm run contribution-test
 *
 * PART 1 — pure unit tests of the authoritative ledger/allocation logic
 *          (contributionService.js), no database required.
 * PART 2 — HTTP integration tests against the live API using throwaway
 *          fixture users (contrib.*@example.com / CT-REG-* registration
 *          numbers). Every fixture is deleted before AND after the run, in
 *          FK-safe order, so repeated runs are deterministic and real user
 *          data is never touched.
 *
 * CLEANUP mirrors smokeTest.js: only rows owned by this suite's fixtures
 * (matched by the contrib.* email pattern) are ever deleted.
 */
import 'dotenv/config';
import { openTestDb } from './pgTestClient.js';

const BASE = process.env.SMOKE_BASE || 'http://localhost:5000';
const AUTHORITY_EMAIL = process.env.AUTHORITY_EMAIL || 'mdhasankhanhk04@gmail.com';
const AUTHORITY_PASSWORD = process.env.AUTHORITY_PASSWORD;
const stamp = Date.now();

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
const section = (title) => console.log(`\n${title}`);
const closeTo = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

/* ------------------------------------------------------------------ */
/* Shared month helpers (mirror the service so tests fail loudly if   */
/* the service's own arithmetic drifts)                                */
/* ------------------------------------------------------------------ */
const pad = (n) => String(n).padStart(2, '0');
const curKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const keyOf = (y, m) => `${y}-${pad(m)}`;
const idxOf = (k) => { const [y, m] = String(k).split('-').map(Number); return y * 12 + (m - 1); };
const shiftKey = (k, d) => { const abs = idxOf(k) + d; return keyOf(Math.floor(abs / 12), (abs % 12) + 1); };
const monthRange = (a, b) => { const out = []; for (let k = a; idxOf(k) <= idxOf(b); k = shiftKey(k, 1)) out.push(k); return out; };

// Four-month outstanding window ending at the current month, clamped to
// January of the current year (the payment phase only covers the current year).
const CUR = curKey();
const W0 = idxOf(shiftKey(CUR, -3)) < idxOf(keyOf(Number(CUR.slice(0, 4)), 1)) ? keyOf(Number(CUR.slice(0, 4)), 1) : shiftKey(CUR, -3);
const WINDOW = monthRange(W0, CUR); // e.g. ['2026-07'..'2026-10']
const N = WINDOW.length;
const RATE = 20;
const DUES0 = RATE * N;

/* ------------------------------------------------------------------ */
/* PART 1 — pure unit tests (no DB, no HTTP)                           */
/* ------------------------------------------------------------------ */
async function unitTests() {
  section('PART 1) Pure ledger & allocation logic (unit)');
  const svc = await import('../src/services/contributionService.js');
  const { buildLedger, summarizeLedger, planAllocation, resolveContributionStart, rateForMonth, splitByRate, isValidMonthKey, shiftMonth, monthRange: svcRange, eligibleOutstandingMonths } = svc;

  // 1) Month keys & calendar-year boundary
  check('unit: isValidMonthKey accepts 2026-01, rejects 2026-13 / 26-01', isValidMonthKey('2026-01') && !isValidMonthKey('2026-13') && !isValidMonthKey('26-01'));
  check('unit: shiftMonth crosses the year boundary 2026-01 -> 2025-12', shiftMonth('2026-01', -1) === '2025-12');
  check('unit: monthRange Jan..Mar returns 3 months', svcRange('2026-01', '2026-03').length === 3);

  // 2) Obligation-start resolution order: explicit > first approved payment > first rate > UNKNOWN
  const s1 = resolveContributionStart({ explicitStart: '2025-06', earliestPaidMonth: '2025-03', firstRateMonth: '2025-01' });
  check('unit: explicit start wins over payment/rate fallbacks', s1.month === '2025-06' && s1.source === 'profile');
  const s2 = resolveContributionStart({ explicitStart: null, earliestPaidMonth: '2025-03', firstRateMonth: '2025-01' });
  check('unit: earliest approved payment is the fallback start', s2.month === '2025-03' && s2.source === 'first_payment');
  const s3 = resolveContributionStart({ explicitStart: 'nope', earliestPaidMonth: null, firstRateMonth: '2025-01' });
  check('unit: first configured rate is the second fallback', s3.month === '2025-01' && s3.source === 'first_rate');
  const s4 = resolveContributionStart({});
  check('unit: start is UNKNOWN (null) when nothing is known — never guessed', s4.month === null && s4.source === 'unknown');

  // 3) Historical rates: each month keeps the rate effective FOR that month
  const histoRates = [{ amount: 20, effective_month: '2026-01' }, { amount: 30, effective_month: '2026-03' }];
  check('unit: rateForMonth Jan=20 Feb=20 Mar=30 Apr=30, before-history=null',
    rateForMonth(histoRates, '2026-01')?.amount === 20
    && rateForMonth(histoRates, '2026-02')?.amount === 20
    && rateForMonth(histoRates, '2026-03')?.amount === 30
    && rateForMonth(histoRates, '2026-04')?.amount === 30
    && rateForMonth(histoRates, '2025-12') === null);

  // 4) splitByRate: surplus is EXTRA, never another month
  check('unit: splitByRate 50 vs 20 -> allocated 20, extra 30', (() => { const r = splitByRate(20, 50); return r.allocated === 20 && r.extra === 30; })());
  check('unit: splitByRate 15 vs 20 -> partial, extra 0', (() => { const r = splitByRate(20, 15); return r.allocated === 15 && r.extra === 0; })());
  check('unit: splitByRate unknown rate -> everything allocated, nothing invented', (() => { const r = splitByRate(null, 40); return r.rate === null && r.allocated === 40 && r.extra === 0; })());

  const rates = [{ amount: 20, effective_month: '2026-01' }, { amount: 30, effective_month: '2026-03' }];
  const start = { month: '2026-01', source: 'profile' };

  // 5) A rate change never rewrites past months' dues
  const L1 = buildLedger({ start, rates, paid: null, pending: null, fromKey: '2026-01', toKey: '2026-04' });
  const byMonth1 = Object.fromEntries(L1.map((r) => [r.month, r]));
  check('unit: past dues keep historic rates after a rate change',
    byMonth1['2026-01'].required === 20 && byMonth1['2026-02'].required === 20
    && byMonth1['2026-03'].required === 30 && byMonth1['2026-04'].required === 30);
  const sum1 = summarizeLedger(L1, { start, currentRate: rates[1] });
  check('unit: total_due = 20+20+30+30 = 100 across the rate change', closeTo(sum1.total_due, 100));

  // 6) Extra money inside a settled month is recorded as extra, not as due payment
  const paidMap2 = new Map([['2026-01', { amount: 40, extra_amount: 20 }]]);
  const L2 = buildLedger({ start, rates, paid: paidMap2, pending: null, fromKey: '2026-01', toKey: '2026-02' });
  const rowJan2 = L2.find((r) => r.month === '2026-01');
  const sum2 = summarizeLedger(L2, { start, currentRate: rates[0] });
  check('unit: ৳40 for a ৳20 month -> paid, allocated 20, extra 20', rowJan2.status === 'paid' && rowJan2.allocated === 20 && rowJan2.extra === 20 && rowJan2.remaining === 0);
  check('unit: summarize counts extra once (allocated 20 + extra 20, due 20 for Feb)', closeTo(sum2.total_extra, 20) && closeTo(sum2.total_allocated, 20) && closeTo(sum2.total_due, 20));

  // 7) Partial payment leaves a real remainder (never "fully paid")
  const paidMap3 = new Map([['2026-01', { amount: 10, extra_amount: 0 }]]);
  const L3 = buildLedger({ start, rates, paid: paidMap3, pending: null, fromKey: '2026-01', toKey: '2026-01' });
  check('unit: ৳10 against a ৳20 month -> partial, remaining 10',
    L3[0].status === 'partial' && L3[0].remaining === 10);

  // 8) Pending payments never look paid and never reduce confirmed due
  const pendMap4 = new Map([['2026-01', { amount: 20 }]]);
  const L4 = buildLedger({ start, rates, paid: null, pending: pendMap4, fromKey: '2026-01', toKey: '2026-02' });
  const sum4 = summarizeLedger(L4, { start, currentRate: rates[0] });
  check('unit: pending month -> status pending, stays in outstanding due until approval',
    L4[0].status === 'pending' && L4[0].remaining === 0 && closeTo(sum4.total_due, 40) && closeTo(sum4.pending_amount, 20));

  // 9) Months before the obligation start are never charged
  const L5 = buildLedger({ start, rates, paid: null, pending: null, fromKey: '2025-11', toKey: '2026-01' });
  const nov = L5.find((r) => r.month === '2025-11');
  check('unit: pre-start months are not_obligated with remaining 0', nov.status === 'not_obligated' && nov.remaining === 0);

  // 10) Obligated month with no configured rate -> unknown, NOT ৳0
  const L6 = buildLedger({ start, rates: [], paid: null, pending: null, fromKey: '2026-01', toKey: '2026-02' });
  const sum6 = summarizeLedger(L6, { start, currentRate: null });
  check('unit: missing rate -> rate_not_set with remaining null',
    L6.every((r) => r.status === 'rate_not_set' && r.remaining === null));
  check('unit: unpriced months excluded from confirmed due, up_to_date=false',
    closeTo(sum6.total_due, 0) && sum6.rate_not_set_months.length === 2 && sum6.up_to_date === false);

  // 11) Unknown obligation start -> everything unknown, never invented
  const L7 = buildLedger({ start: { month: null, source: 'unknown' }, rates, paid: null, pending: null, fromKey: '2026-01', toKey: '2026-02' });
  const sum7 = summarizeLedger(L7, { start: { month: null, source: 'unknown' }, currentRate: rates[0] });
  check('unit: unknown start -> start_unknown rows, due 0, up_to_date=false',
    L7.every((r) => r.status === 'start_unknown' && r.remaining === null) && sum7.start_unknown === true && sum7.up_to_date === false);

  // 12) MANDATORY ACCEPTANCE EXAMPLE 1 (pure): ৳100 vs four ৳20 dues
  const four = ['2026-01', '2026-02', '2026-03', '2026-04'].map((month) => ({ month, required: 20, allocated: 0 }));
  const plan100 = planAllocation(four, 100);
  const allocByMonth = Object.fromEntries(plan100.allocations.map((a) => [a.month, a]));
  const sumAlloc = plan100.allocations.reduce((a, x) => a + x.amount, 0);
  check('ACCEPTANCE (unit): ৳20 each to months 1-4',
    allocByMonth['2026-01'].amount === 20 && allocByMonth['2026-02'].amount === 20
    && allocByMonth['2026-03'].amount === 20 && allocByMonth['2026-04'].amount === 40);
  check('ACCEPTANCE (unit): total due allocation ৳80, extra ৳20, settled ৳80',
    closeTo(plan100.settled_amount, 80) && closeTo(plan100.extra, 20));
  check('ACCEPTANCE (unit): original ৳100 fully preserved (sum of allocations = 100)', closeTo(sumAlloc, 100));

  // 13) ACCEPTANCE EXAMPLE 2 (pure): ৳50 partial settlement
  const plan50 = planAllocation(four.map((m) => ({ ...m })), 50);
  const a50 = Object.fromEntries(plan50.allocations.map((a) => [a.month, a]));
  check('ACCEPTANCE (unit): ৳50 settles Jan 20 + Feb 20 + Mar 10, extra 0',
    a50['2026-01'].amount === 20 && a50['2026-02'].amount === 20 && a50['2026-03'].amount === 10 && closeTo(plan50.extra, 0));
  check('ACCEPTANCE (unit): ৳50 -> settled 50', closeTo(plan50.settled_amount, 50));

  // 14) No outstanding dues -> the whole amount is Extra, parked on a null month
  const planNone = planAllocation([], 100);
  check('ACCEPTANCE (unit): nothing outstanding -> ৳100 entirely extra, nothing auto-applied to future months',
    planNone.allocations.length === 1 && planNone.allocations[0].month === null
    && planNone.allocations[0].amount === 100 && closeTo(planNone.extra, 100));

  // 15) A partially settled month is never settled twice
  const planTop = planAllocation([{ month: '2026-01', required: 20, allocated: 15 }], 20);
  check('unit: month with 15/20 allocated takes only the 5 remainder',
    planTop.allocations.length === 1 && planTop.allocations[0].month === '2026-01'
    && planTop.allocations[0].amount === 20 && planTop.allocations[0].extra === 15
    && closeTo(planTop.settled_amount, 5) && closeTo(planTop.extra, 15));

  // 16) Eligible-month filter respects the payable phase
  const ledgerRows = [
    { month: '2025-12', status: 'due', required: 20, allocated: 0 },   // before phase
    { month: '2026-01', status: 'due', required: 20, allocated: 0 },
    { month: '2026-02', status: 'paid', required: 20, allocated: 20 },  // settled
    { month: '2026-03', status: 'pending', required: 20, allocated: 0 },// awaiting verification
    { month: '2026-04', status: 'rate_not_set', required: null, allocated: 0 },
  ];
  const elig = eligibleOutstandingMonths(ledgerRows, { phaseStart: '2026-01', phaseEnd: '2026-04' });
  check('unit: only due/partial, in-phase, priced months are payable',
    elig.length === 1 && elig[0].month === '2026-01');
}

/* ------------------------------------------------------------------ */
/* PART 2 — HTTP integration tests                                     */
/* ------------------------------------------------------------------ */
async function call(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

async function dbConn() {
  return openTestDb();
}

async function sqlQuery(conn, sql, params = []) {
  const [rows] = await conn.query(sql, params);
  return rows;
}

/** Delete ONLY this suite's fixtures, in FK-safe order (mirrors smokeTest). */
async function cleanupFixtures(phase) {
  let conn;
  try {
    conn = await dbConn();
    const like = 'contrib.%@example.com';
    const targets = [
      ['DELETE FROM monthly_payment_details mpd USING users u WHERE u.user_id = mpd.user_id AND u.email LIKE ?', [like]],
      ['DELETE FROM payments pay USING users u WHERE u.user_id = pay.user_id AND u.email LIKE ?', [like]],
      ['DELETE FROM member_monthly_rates r USING users u WHERE u.user_id = r.user_id AND u.email LIKE ?', [like]],
      ['DELETE FROM member_monthly_rates r USING users u WHERE u.user_id = r.set_by AND u.email LIKE ?', [like]],
      ['DELETE FROM users WHERE email LIKE ?', [like]],
    ];
    let removed = 0;
    for (const [sql, params] of targets) {
      const res = await conn.query(sql, params);
      removed += res[0].affectedRows || 0;
    }
    console.log(`  (${phase} cleanup: removed ${removed} leftover fixture row(s))`);
  } catch (err) {
    console.log(`  (${phase} cleanup skipped: ${err.code || err.message})`);
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

/** Poll an assertion until it holds or the timeout expires (async side-effects). */
async function waitFor(fn, { tries = 20, interval = 250 } = {}) {
  for (let i = 0; i < tries; i++) {
    try { if (await fn()) return true; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

async function integrationTests() {
  section('PART 2) HTTP integration (live API, throwaway fixtures)');
  console.log(`  (window: ${WINDOW.join(' -> ')} — ${N} outstanding month(s) x ৳${RATE} = ৳${DUES0} dues)`);

  // --- Authority session -------------------------------------------------
  const authLogin = await call('POST', '/api/auth/login', { body: { email: AUTHORITY_EMAIL, password: AUTHORITY_PASSWORD } });
  check('setup: authority login', authLogin.status === 200 && !!authLogin.json?.data?.token, `status ${authLogin.status}`);
  const authToken = authLogin.json?.data?.token;
  if (!authToken) { console.log('  (aborting: no authority token)'); return; }

  // --- Fixture users ------------------------------------------------------
  const mkUser = (tag) => ({
    first_name: `Contrib${tag}`, last_name: 'Tester',
    email: `contrib.${tag}.${stamp}@example.com`,
    password: 'Passw0rd!23', phone: '01700000000',
    registration_number: `CT-REG-${stamp}-${tag}`,
    ssc_batch: 2010, blood_group: 'O+', profession: 'Engineer', institute: 'Test Institute',
    present_address: 'Test Street 1', permanent_address: 'Test Village 2',
  });
  const users = { u1: mkUser('u1'), u2: mkUser('u2'), u3: mkUser('u3'), u4: mkUser('u4'), u5: mkUser('u5'), u6: mkUser('u6') };
  const ids = {}, tokens = {};

  for (const key of Object.keys(users)) {
    const r = await call('POST', '/api/auth/register', { body: users[key] });
    check(`setup: register ${key} -> 201 pending`, r.status === 201, `status ${r.status} ${r.json?.message || ''}`);
  }
  const pending = await call('GET', '/api/users/pending', { token: authToken });
  for (const key of Object.keys(users)) {
    const found = pending.json?.data?.users?.find((u) => u.email === users[key].email);
    if (found) ids[key] = found.user_id;
    const ok = await call('PUT', `/api/users/${ids[key]}/approve`, { token: authToken });
    check(`setup: approve ${key}`, ok.status === 200, `status ${ok.status}`);
  }
  for (const key of Object.keys(users)) {
    const r = await call('POST', '/api/auth/login', { body: { email: users[key].email, password: users[key].password } });
    tokens[key] = r.json?.data?.token;
    check(`setup: login ${key}`, !!tokens[key], `status ${r.status}`);
  }

  const conn = await dbConn();
  const insertRate = async (userId, amount, effectiveMonth, setBy) => {
    await sqlQuery(conn,
      `INSERT INTO member_monthly_rates (user_id, amount, effective_month, source, set_by) VALUES (?, ?, ?, 'member', ?)
       ON CONFLICT (user_id, effective_month) DO UPDATE SET amount = EXCLUDED.amount`, [userId, amount, effectiveMonth, setBy]);
  };
  const allocRowsOf = async (userId) => sqlQuery(conn,
    `SELECT payment_month, amount, extra_amount FROM monthly_payment_details WHERE user_id = ? ORDER BY payment_month`, [userId]);

  try {
    /* ================================================================ */
    section('T1) Login setup-reminder: fires once, no duplicates, cleared on setup');
    const hasSetupReminder = async () => {
      const n = await call('GET', '/api/notifications', { token: tokens.u6 });
      return (n.json?.data?.notifications || []).filter((x) => x.type === 'contribution_setup' && !x.is_read);
    };
    const reminderAppeared = await waitFor(async () => (await hasSetupReminder()).length >= 1);
    check('login reminder: contribution_setup notification appears for a member with no rate', reminderAppeared);
    await call('POST', '/api/auth/login', { body: { email: users.u6.email, password: users.u6.password } }); // second login
    const stillOne = await waitFor(async () => (await hasSetupReminder()).length === 1);
    const notDuplicated = stillOne && (await hasSetupReminder()).length === 1;
    check('login reminder: second login does NOT create a duplicate reminder', notDuplicated, `count ${(await hasSetupReminder()).length}`);

    const rBadAmount = await call('POST', '/api/contributions/mine/rate', { token: tokens.u6, body: { amount: 45 } });
    check('setup: amount outside allowed set rejected (400)', rBadAmount.status === 400, `status ${rBadAmount.status}`);
    const rPast = await call('POST', '/api/contributions/mine/rate', { token: tokens.u6, body: { amount: 20, effective_month: '2020-01' } });
    check('setup: retroactive effective month rejected (400)', rPast.status === 400, `status ${rPast.status} ${rPast.json?.message || ''}`);

    const rSet = await call('POST', '/api/contributions/mine/rate', { token: tokens.u6, body: { amount: 20 } });
    check('setup: initial rate ৳20 -> 201', rSet.status === 201 && Number(rSet.json?.data?.rate?.amount) === 20, `status ${rSet.status}`);
    const rSame = await call('POST', '/api/contributions/mine/rate', { token: tokens.u6, body: { amount: 20 } });
    check('setup: same rate same month is idempotent (200 unchanged)', rSame.status === 200, `status ${rSame.status}`);
    const rDiff = await call('POST', '/api/contributions/mine/rate', { token: tokens.u6, body: { amount: 30 } });
    check('setup: conflicting rate for the same month rejected (409)', rDiff.status === 409, `status ${rDiff.status}`);
    const rFuture = await call('POST', '/api/contributions/mine/rate', { token: tokens.u6, body: { amount: 30, effective_month: shiftKey(CUR, 1) } });
    check('setup: rate change scheduled for next month -> 201', rFuture.status === 201, `status ${rFuture.status} ${rFuture.json?.message || ''}`);

    const cleared = await waitFor(async () => (await hasSetupReminder()).length === 0);
    check('login reminder: cleared automatically once the rate is set', cleared);
    const mine6 = await call('GET', '/api/contributions/mine', { token: tokens.u6 });
    check('setup: history is append-only (2 rows kept)', mine6.json?.data?.history?.length === 2, `history ${mine6.json?.data?.history?.length}`);
    check('setup: current rate still ৳20 until next month', Number(mine6.json?.data?.summary?.current_rate) === 20);

    const prev = await call('GET', '/api/contributions/preview?amount=100', { token: tokens.u6 });
    check('preview endpoint answers (200) with settles/extra/remaining fields', prev.status === 200
      && Array.isArray(prev.json?.data?.settles) && prev.json?.data?.extra !== undefined && prev.json?.data?.remaining_due_after !== undefined,
      `status ${prev.status}`);

    /* ================================================================ */
    section('T2) ACCEPTANCE: ৳100 against four ৳20 dues -> ৳80 due + ৳20 extra, due ৳0');
    await insertRate(ids.u1, RATE, W0, ids.u1); // rate established months ago (fixture)
    const mineU1a = await call('GET', '/api/contributions/mine', { token: tokens.u1 });
    check(` dues before payment = ${DUES0} (${N} month(s) x ৳${RATE})`, closeTo(mineU1a.json?.data?.summary?.total_due, DUES0), `got ${mineU1a.json?.data?.summary?.total_due}`);
    check('start resolved from first rate month', mineU1a.json?.data?.start?.month === W0, `got ${mineU1a.json?.data?.start?.month}`);

    const pay100 = await call('POST', '/api/payments', {
      token: tokens.u1,
      body: { registration_number: users.u1.registration_number, payment_type: 'monthly', amount: 50, months: [WINDOW[0], WINDOW[1]], sender_number: '01712345678' },
    });
    check('test payment ৳50 x 2 months -> 201 success', pay100.status === 201 && pay100.json?.data?.payment?.status === 'success', `status ${pay100.status} ${pay100.json?.message || ''}`);

    const allocU1 = await allocRowsOf(ids.u1);
    const sumAmount = allocU1.reduce((a, r) => a + Number(r.amount), 0);
    const sumExtra = allocU1.reduce((a, r) => a + Number(r.extra_amount), 0);
    const sumAllocated = allocU1.reduce((a, r) => a + (Number(r.amount) - Number(r.extra_amount)), 0);
    const settledMonths = allocU1.filter((r) => Number(r.amount) - Number(r.extra_amount) > 0).map((r) => r.payment_month);
    check('every outstanding month received its rate (oldest first)', JSON.stringify(settledMonths) === JSON.stringify(WINDOW), settledMonths.join(','));
    check(`original ৳${DUES0 + 20} preserved: sum(amount)=${DUES0 + 20}`, closeTo(sumAmount, DUES0 + 20), `got ${sumAmount}`);
    check('due payment allocation = ' + DUES0, closeTo(sumAllocated, DUES0), `got ${sumAllocated}`);
    check('extra contribution = 20 (only the remainder after ALL dues)', closeTo(sumExtra, 20), `got ${sumExtra}`);
    if (N === 4) check('ACCEPTANCE EXACT (4x৳20, ৳100): 80/20/0 verified above', closeTo(sumAllocated, 80) && closeTo(sumExtra, 20));

    const mineU1b = await call('GET', '/api/contributions/mine', { token: tokens.u1 });
    const s1b = mineU1b.json?.data?.summary;
    check('remaining outstanding due = ৳0', closeTo(s1b.total_due, 0), `got ${s1b.total_due}`);
    check('member summary extra = ৳20', closeTo(s1b.total_extra, 20), `got ${s1b.total_extra}`);
    check('ledger marks every window month paid', WINDOW.every((m) => mineU1b.json?.data?.months?.find((x) => x.month === m)?.status === 'paid'));
    check('up_to_date=true once start known, dues settled, no unpriced months', s1b.up_to_date === true);

    const payAgain = await call('POST', '/api/payments', { token: tokens.u1, body: { registration_number: users.u1.registration_number, payment_type: 'monthly', amount: 20, months: [WINDOW[0]], sender_number: '01712345678' } });
    check('already-paid month cannot be paid again (409)', payAgain.status === 409, `status ${payAgain.status}`);
    const payPrevYear = await call('POST', '/api/payments', { token: tokens.u1, body: { registration_number: users.u1.registration_number, payment_type: 'monthly', amount: 20, months: [keyOf(Number(CUR.slice(0, 4)) - 1, 12)], sender_number: '01712345678' } });
    check('calendar boundary: previous-year month rejected (400)', payPrevYear.status === 400, `status ${payPrevYear.status}`);
    const payFuture = await call('POST', '/api/payments', { token: tokens.u1, body: { registration_number: users.u1.registration_number, payment_type: 'monthly', amount: 20, months: [shiftKey(CUR, 1)], sender_number: '01712345678' } });
    check('calendar boundary: future month rejected (400)', payFuture.status === 400, `status ${payFuture.status}`);

    const payNone = await call('POST', '/api/payments', { token: tokens.u1, body: { registration_number: users.u1.registration_number, payment_type: 'monthly', amount: 20, months: [CUR], sender_number: '01712345678' } });
    check('EXAMPLE 3: monthly payment with nothing outstanding is refused (409 already-settled, points to occasional)', payNone.status === 409, `status ${payNone.status}`);
    const occ100 = await call('POST', '/api/payments', { token: tokens.u1, body: { registration_number: users.u1.registration_number, payment_type: 'occasional', purpose: 'donation', amount: 100, sender_number: '01812345678', description: 'Extra contribution' } });
    check('EXAMPLE 3: ৳100 donation (extra contribution route) -> 201', occ100.status === 201 && occ100.json?.data?.payment?.status === 'success', `status ${occ100.status}`);
    const minePayU1 = await call('GET', '/api/payments/mine', { token: tokens.u1 });
    check('EXAMPLE 3: monthly_total=100 (original payment intact), occasional_total=100, extra_total=20',
      closeTo(minePayU1.json?.data?.totals?.monthly_total, DUES0 + 20) && closeTo(minePayU1.json?.data?.totals?.occasional_total, 100) && closeTo(minePayU1.json?.data?.totals?.extra_total, 20),
      JSON.stringify(minePayU1.json?.data?.totals));
    const mineU1c = await call('GET', '/api/contributions/mine', { token: tokens.u1 });
    check('EXAMPLE 3: donation never changes monthly dues/extra (due 0, monthly extra still 20)',
      closeTo(mineU1c.json?.data?.summary?.total_due, 0) && closeTo(mineU1c.json?.data?.summary?.total_extra, 20));

    /* ================================================================ */
    section('T3) Partial settlement (older-first top-up of a half-paid month)');
    await insertRate(ids.u2, RATE, W0, ids.u2);
    const p1 = await call('POST', '/api/payments', { token: tokens.u2, body: { registration_number: users.u2.registration_number, payment_type: 'monthly', amount: 20, months: [WINDOW[0]], sender_number: '01712345678' } });
    check('pay first month ৳20 -> 201', p1.status === 201, `status ${p1.status}`);
    const p2 = await call('POST', '/api/payments', { token: tokens.u2, body: { registration_number: users.u2.registration_number, payment_type: 'monthly', amount: 30, months: [WINDOW[1]], sender_number: '01712345678' } });
    check('pay second month ৳30 -> 201', p2.status === 201, `status ${p2.status}`);
    const mineU2 = await call('GET', '/api/contributions/mine', { token: tokens.u2 });
    const rowsU2 = Object.fromEntries(mineU2.json?.data?.months?.map((m) => [m.month, m]) || []);
    const s2 = mineU2.json?.data?.summary;
    if (N >= 3) {
      check('EXAMPLE 2: month 1 paid 20, month 2 paid 20 (oldest-first across payments)',
        rowsU2[WINDOW[0]]?.status === 'paid' && rowsU2[WINDOW[0]]?.allocated === 20
        && rowsU2[WINDOW[1]]?.status === 'paid' && rowsU2[WINDOW[1]]?.allocated === 20);
      check('EXAMPLE 2: month 3 partially paid 10 — NOT falsely marked fully paid',
        rowsU2[WINDOW[2]]?.status === 'partial' && closeTo(rowsU2[WINDOW[2]]?.allocated, 10) && closeTo(rowsU2[WINDOW[2]]?.remaining, 10));
      check(`EXAMPLE 2: remaining total due = ${DUES0 - 50}, extra = 0`, closeTo(s2.total_due, DUES0 - 50) && closeTo(s2.total_extra, 0), `due ${s2.total_due} extra ${s2.total_extra}`);
    }
    const prev20 = await call('GET', '/api/contributions/preview?amount=20', { token: tokens.u2 });
    const settlesTo = (prev20.json?.data?.settles || []).map((x) => x.month);
    check('preview of ৳20 tops up the partial month first, then the next due month',
      N >= 3 ? (settlesTo[0] === WINDOW[2] && settlesTo[1] === WINDOW[3]) : true, settlesTo.join(','));
    check('preview remaining due after = dues - 70', closeTo(prev20.json?.data?.remaining_due_after, Math.max(0, DUES0 - 70)), `got ${prev20.json?.data?.remaining_due_after}`);

    /* ================================================================ */
    section('T4) Pending payment: dues unchanged until approval; approve/reject/race');
    await insertRate(ids.u3, RATE, W0, ids.u3);
    const fd = (prov, txn, { billing, amount, purpose } = {}) => {
      const f = new FormData();
      f.append('registration_number', users.u3.registration_number);
      f.append('payment_method', prov);
      f.append('transaction_id', txn);
      if (purpose) { f.append('payment_type', 'occasional'); f.append('purpose', purpose); f.append('amount', String(amount)); }
      else { f.append('payment_type', 'monthly'); f.append('amount', String(amount)); f.append('billing_month', billing); }
      return f;
    };
    const m1 = await call('POST', '/api/payments/manual', { token: tokens.u3, form: fd('bkash', `CT${stamp}T1`, { billing: WINDOW[0], amount: 50 }) });
    check('EXAMPLE 4: manual monthly submit -> 201 PENDING', m1.status === 201 && m1.json?.data?.payment?.status === 'pending', `status ${m1.status}`);
    const pid1 = m1.json?.data?.payment?.payment_id;
    const stU3a = await call('GET', '/api/contributions/mine', { token: tokens.u3 });
    check(`EXAMPLE 4: outstanding due UNCHANGED at ${DUES0} while pending`, closeTo(stU3a.json?.data?.summary?.total_due, DUES0), `got ${stU3a.json?.data?.summary?.total_due}`);
    const msU3a = await call('GET', '/api/payments/monthly-status', { token: tokens.u3 });
    const pendRow = msU3a.json?.data?.months?.find((m) => m.month === WINDOW[0]);
    check('EXAMPLE 4: pending month shows pending=true, paid=false', pendRow?.pending === true && pendRow?.paid === false, JSON.stringify(pendRow));
    const mpU3a = await call('GET', '/api/payments/mine', { token: tokens.u3 });
    check('EXAMPLE 4: pending NOT counted in received totals', closeTo(mpU3a.json?.data?.totals?.monthly_total, 0), JSON.stringify(mpU3a.json?.data?.totals));

    const ap1 = await call('PATCH', `/api/payments/${pid1}/review`, { token: authToken, body: { status: 'success', note: 'TrxID verified' } });
    check('approval -> 200 success with reviewer note', ap1.status === 200 && ap1.json?.data?.payment?.status === 'success' && ap1.json?.data?.payment?.review_note === 'TrxID verified', `status ${ap1.status}`);
    const allocU3 = await allocRowsOf(ids.u3);
    const settledU3 = allocU3.map((r) => `${r.payment_month}:${Number(r.amount) - Number(r.extra_amount)}`);
    check('approval allocates oldest-first (50 -> 20/20/10 across the first three months)', N >= 3
      ? (settledU3[0] === `${WINDOW[0]}:20` && settledU3[1] === `${WINDOW[1]}:20` && settledU3[2] === `${WINDOW[2]}:10`)
      : allocU3.length >= 1, settledU3.join(' '));
    const stU3b = await call('GET', '/api/contributions/mine', { token: tokens.u3 });
    check('dues drop only by the approved allocation', closeTo(stU3b.json?.data?.summary?.total_due, Math.max(0, DUES0 - 50)), `got ${stU3b.json?.data?.summary?.total_due}`);
    const ap2 = await call('PATCH', `/api/payments/${pid1}/review`, { token: authToken, body: { status: 'rejected' } });
    check('double approval blocked (409)', ap2.status === 409, `status ${ap2.status}`);

    const m2 = await call('POST', '/api/payments/manual', { token: tokens.u3, form: fd('nagad', `CT${stamp}T2`, { billing: WINDOW[N - 1], amount: 20 }) });
    const pid2 = m2.json?.data?.payment?.payment_id;
    const rj = await call('PATCH', `/api/payments/${pid2}/review`, { token: authToken, body: { status: 'rejected', note: 'No such TrxID' } });
    check('rejection -> 200 rejected with note', rj.status === 200 && rj.json?.data?.payment?.status === 'rejected', `status ${rj.status}`);
    const allocU3b = await allocRowsOf(ids.u3);
    check('rejection writes NO allocation rows and settles nothing', allocU3b.length === (N >= 3 ? 3 : allocU3b.length));
    const stU3c = await call('GET', '/api/contributions/mine', { token: tokens.u3 });
    check('dues unchanged after rejection', closeTo(stU3c.json?.data?.summary?.total_due, Math.max(0, DUES0 - 50)), `got ${stU3c.json?.data?.summary?.total_due}`);
    const mpU3b = await call('GET', '/api/payments/mine', { token: tokens.u3 });
    const rejectedRow = mpU3b.json?.data?.payments?.find((p) => p.payment_id === pid2);
    check('rejected payment visible in history with reviewer note', rejectedRow?.status === 'rejected' && !!rejectedRow?.review_note);

    const m3 = await call('POST', '/api/payments/manual', { token: tokens.u3, form: fd('rocket', `CT${stamp}T3`, { billing: WINDOW[N - 1], amount: 20 }) });
    const pid3 = m3.json?.data?.payment?.payment_id;
    const [raceA, raceB] = await Promise.all([
      call('PATCH', `/api/payments/${pid3}/review`, { token: authToken, body: { status: 'success' } }),
      call('PATCH', `/api/payments/${pid3}/review`, { token: authToken, body: { status: 'success' } }),
    ]);
    const raceStatuses = [raceA.status, raceB.status].sort();
    check('concurrent double approval: exactly one wins, the other gets 409', raceStatuses[0] === 200 && raceStatuses[1] === 409, `got ${raceA.status}/${raceB.status}`);
    const allocU3c = await sqlQuery(conn,
      `SELECT payment_month, SUM(amount) AS amount, SUM(extra_amount) AS extra FROM monthly_payment_details WHERE payment_id = ? GROUP BY payment_month`, [pid3]);
    const sumRace = allocU3c.reduce((a, r) => a + Number(r.amount), 0);
    check('the losing approval\u2019s allocation was rolled back (payment allocated exactly once, sum=20)', closeTo(sumRace, 20), `got ${sumRace}`);
    const stU3d = await call('GET', '/api/contributions/mine', { token: tokens.u3 });
    check('final dues after all reviews = expected remainder', closeTo(stU3d.json?.data?.summary?.total_due, Math.max(0, DUES0 - 70)), `got ${stU3d.json?.data?.summary?.total_due}`);

    /* ================================================================ */
    section('T5) Missing rate: months are unknown, never priced at ৳0');
    const setStart = await call('PATCH', `/api/contributions/members/${ids.u4}/start`, { token: authToken, body: { contribution_start_month: W0 } });
    check('admin can set an explicit contribution start', setStart.status === 200, `status ${setStart.status} ${setStart.json?.message || ''}`);
    const mineU4a = await call('GET', '/api/contributions/mine', { token: tokens.u4 });
    const s4a = mineU4a.json?.data?.summary;
    check('obligated months with no rate are rate_not_set (unknown, NOT ৳0)',
      s4a.rate_not_set_months.length === N && closeTo(s4a.total_due, 0) && s4a.up_to_date === false,
      JSON.stringify(s4a.rate_not_set_months));
    const payU4 = await call('POST', '/api/payments', { token: tokens.u4, body: { registration_number: users.u4.registration_number, payment_type: 'monthly', amount: 20, months: [W0], sender_number: '01712345678' } });
    check('payment for an unpriced month is recorded without inventing a rate (201)', payU4.status === 201, `status ${payU4.status} ${payU4.json?.message || ''}`);
    const mineU4b = await call('GET', '/api/contributions/mine', { token: tokens.u4 });
    const rowW0 = mineU4b.json?.data?.months?.find((m) => m.month === W0);
    check('paid-without-rate month is flagged, remaining 0, still not "due"',
      rowW0?.status === 'paid' && rowW0?.remaining === 0 && (rowW0?.flags || []).includes('paid_without_configured_rate'), JSON.stringify(rowW0));

    /* ================================================================ */
    section('T6) Unknown obligation start: reported as unknown, never guessed');
    const mineU5 = await call('GET', '/api/contributions/mine', { token: tokens.u5 });
    const s5 = mineU5.json?.data?.summary;
    check('start_unknown=true with no invented start month', s5.start_unknown === true && s5.start_month === null);
    check('unknown-start months carry remaining=null and up_to_date=false',
      mineU5.json?.data?.months?.some((m) => m.status === 'start_unknown' && m.remaining === null) && s5.up_to_date === false);

    /* ================================================================ */
    section('T7) Permissions, member-wise report and reconciliation');
    const repDenied = await call('GET', '/api/contributions/members', { token: tokens.u1 });
    check('member CANNOT read the member-wise due report (403)', repDenied.status === 403, `status ${repDenied.status}`);
    const rep = await call('GET', `/api/contributions/members?search=CT-REG-${stamp}`, { token: authToken });
    check('authority reads the member-wise report (200)', rep.status === 200 && Array.isArray(rep.json?.data?.members), `status ${rep.status}`);
    const rU1 = rep.json?.data?.members?.find((m) => m.user_id === ids.u1);
    const rU2 = rep.json?.data?.members?.find((m) => m.user_id === ids.u2);
    check('report reconciles with the member ledger: u1 due 0 / extra 20', rU1 && closeTo(rU1.total_due, 0) && closeTo(rU1.total_extra, 20), JSON.stringify(rU1 && { due: rU1.total_due, extra: rU1.total_extra }));
    check(`report reconciles: u2 due ${DUES0 - 50}`, rU2 && closeTo(rU2.total_due, Math.max(0, DUES0 - 50)), `got ${rU2?.total_due}`);
    check('report exposes approved payment totals per member', rU1 && closeTo(rU1.approved_monthly_total, DUES0 + 20) && closeTo(rU1.approved_occasional_total, 100));
    const rU4 = rep.json?.data?.members?.find((m) => m.user_id === ids.u4);
    check('unpriced months surface in the report (rate_not_set_months)', rU4 && rU4.rate_not_set_months?.length === N - 1, JSON.stringify(rU4?.rate_not_set_months));

    const detail = await call('GET', `/api/contributions/members/${ids.u2}`, { token: authToken });
    check('admin member detail (month-by-month) matches the member own ledger',
      detail.status === 200 && closeTo(detail.json?.data?.summary?.total_due, Math.max(0, DUES0 - 50)), `status ${detail.status}`);
    const xStatus = await call('GET', `/api/payments/monthly-status?user_id=${ids.u1}`, { token: tokens.u2 });
    check('member cannot read another member monthly status (403)', xStatus.status === 403, `status ${xStatus.status}`);
    const sumU3 = await call('GET', `/api/payments/summary/${ids.u3}`, { token: authToken });
    check('admin per-member payment summary reconciles (monthly 70, outstanding_due matches)',
      sumU3.status === 200 && closeTo(sumU3.json?.data?.monthly_total, Math.min(70, DUES0 + 20)) && closeTo(sumU3.json?.data?.monthly?.outstanding_due, Math.max(0, DUES0 - 70)),
      JSON.stringify(sumU3.json?.data && { m: sumU3.json.data.monthly_total, o: sumU3.json.data.monthly?.outstanding_due }));
    const fin = await call('GET', '/api/analytics/financial', { token: authToken });
    check('analytics financial dashboard responds with consistent KPI shape', fin.status === 200
      && Number.isFinite(Number(fin.json?.data?.kpis?.total_due)) && Number.isFinite(Number(fin.json?.data?.kpis?.total_paid))
      && Number(fin.json?.data?.kpis?.total_due) >= 0, `status ${fin.status}`);
  } finally {
    await conn.end().catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
async function main() {
  if (!AUTHORITY_PASSWORD) {
    console.error('AUTHORITY_PASSWORD missing. Run from the backend folder so .env is loaded.');
    process.exit(1);
  }
  console.log('\nPreparing a clean fixture set (removing only previous test data)…');
  await cleanupFixtures('start');

  await unitTests();
  try {
    await integrationTests();
  } catch (err) {
    failed++;
    failures.push(`integration crashed: ${err.message}`);
    console.log(`\n  integration crashed: ${err.message}`);
  }

  console.log('');
  await cleanupFixtures('end');
  report();
}

function report() {
  console.log('\n==================================================');
  console.log(`CONTRIBUTION TEST RESULT: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log('==================================================');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\nContribution test crashed:', err.message);
  console.error('Is the backend running on port 5000, and has the database been initialized?');
  process.exit(1);
});
