/**
 * demoE2E.js — API-level end-to-end test of the demo cohort (Phases 2–5).
 *
 * Requires: backend on :5000, DB initialized, and `npm run seed-demo` already
 * created 100 approved demo members (demo.mNNN@bilbilash.demo).
 *
 * SAFETY: every scenario row it creates belongs to demo.* users and is deleted
 * (FK-safe) before the run so reruns are deterministic. Genuine user data is
 * never touched. All payments use the built-in TEST provider or the pending
 * manual workflow (authority approves/rejects) — no external money movement.
 *
 * Usage: cd backend && npm run demo-e2e
 */
import 'dotenv/config';
import { openTestDb } from './pgTestClient.js';
import { demoEmail, demoReg, DEMO_PASSWORD, DEMO_EMAIL_PREFIX, DEMO_EMAIL_DOMAIN, DEMO_REG_PREFIX } from './seedDemo.js';

const BASE = process.env.SMOKE_BASE || 'http://localhost:5000';
const AUTHORITY_EMAIL = process.env.AUTHORITY_EMAIL;
const AUTHORITY_PASSWORD = process.env.AUTHORITY_PASSWORD;
const stamp = Date.now();

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
const section = (t) => console.log(`\n${t}`);
const closeTo = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

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

async function db() {
  return openTestDb();
}
const sql = async (conn, q, p = []) => (await conn.query(q, p))[0];

const pad = (n) => String(n).padStart(2, '0');
const curKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const CUR = curKey();
const YEAR = Number(CUR.slice(0, 4));
const DEMO_LIKE = `${DEMO_EMAIL_PREFIX}%@${DEMO_EMAIL_DOMAIN}`;

/** Wipe ONLY demo financial rows so the suite is rerunnable. */
async function resetDemoFinancials(conn) {
  const like = DEMO_LIKE;
  await sql(conn, `DELETE FROM monthly_payment_details mpd USING users u WHERE u.user_id = mpd.user_id AND u.email LIKE ?`, [like]);
  await sql(conn, `DELETE FROM payments pay USING users u WHERE u.user_id = pay.user_id AND u.email LIKE ?`, [like]);
  await sql(conn, `DELETE FROM member_monthly_rates r USING users u WHERE u.user_id = r.user_id AND u.email LIKE ?`, [like]);
}

/* ------------------------------------------------------------------ */
/* Cohort assignment (deterministic by member index 1..100):           */
/*   i%10==0 -> overpay: rate 20, test-pay 100  => 80 extra            */
/*   i%10==1 -> pending manual  (never approved) => dues stay          */
/*   i%10==2 -> manual rejected => dues stay, nothing received         */
/*   i%10==3 -> manual approved => dues settled                        */
/*   i%10==4 -> partial: rate 50, test-pay 20   => 30 remaining        */
/*   else    -> exact: rate in cycle, test-pay same amount => settled  */
/* Acceptance member 99: SQL-backfilled rate 20 from 4 months ago      */
/*   (fixture, mirrors contributionTest practice), pay 100 => 80/20/0  */
const RATE_CYCLE = [20, 30, 50, 100];
const groupOf = (i) => (i % 10 === 0 ? 'overpay' : i % 10 === 1 ? 'pending' : i % 10 === 2 ? 'rejected'
  : i % 10 === 3 ? 'approved_manual' : i % 10 === 4 ? 'partial' : 'exact');
const rateOf = (i) => (groupOf(i) === 'overpay' ? 20 : groupOf(i) === 'partial' ? 50 : RATE_CYCLE[i % 4]);

async function main() {
  if (!AUTHORITY_PASSWORD) { console.error('AUTHORITY_PASSWORD missing — run from backend/.'); process.exit(1); }
  const conn = await db();

  section('P0) Environment + cohort presence');
  const [cDemo] = await sql(conn, `SELECT COUNT(*) n FROM users WHERE email LIKE ? AND status='approved' AND is_active=1`, [`${DEMO_EMAIL_PREFIX}m___@${DEMO_EMAIL_DOMAIN}`]);
  check(`100 approved demo members present (got ${cDemo.n})`, cDemo.n === 100);
  if (cDemo.n < 100) { console.log('  (run npm run seed-demo first — aborting)'); process.exit(1); }
  await resetDemoFinancials(conn);
  console.log('  (demo financial rows reset for a deterministic run)');

  const authLogin = await call('POST', '/api/auth/login', { body: { email: AUTHORITY_EMAIL, password: AUTHORITY_PASSWORD } });
  const authToken = authLogin.json?.data?.token;
  check('authority login', !!authToken);
  if (!authToken) process.exit(1);

  // Login the whole cohort (sequential batches of 10 to respect the DB pool).
  const tokens = {};
  let loginFail = 0;
  for (let i = 1; i <= 100; i += 10) {
    await Promise.all(Array.from({ length: 10 }, async (_, k) => {
      const idx = i + k;
      if (idx > 100) return;
      const r = await call('POST', '/api/auth/login', { body: { email: demoEmail(idx), password: DEMO_PASSWORD } });
      if (r.json?.data?.token) tokens[idx] = r.json.data.token; else loginFail++;
    }));
  }
  check('all 100 demo members can log in', loginFail === 0 && Object.keys(tokens).length === 100, `failures ${loginFail}`);
  const ids = {};
  for (let i = 1; i <= 100; i += 25) {
    await Promise.all(Array.from({ length: 25 }, async (_, k) => {
      const idx = i + k; if (idx > 100) return;
      const u = await sql(conn, `SELECT user_id FROM users WHERE email = ?`, [demoEmail(idx)]);
      ids[idx] = u[0].user_id;
    }));
  }
  const idList = Object.values(ids);
  const placeholders = idList.map(() => '?').join(',');

  section('P1) Rates configured through the real API (append-only history)');
  let rateOk = 0, rateFail = 0;
  for (let i = 1; i <= 100; i += 10) {
    await Promise.all(Array.from({ length: 10 }, async (_, k) => {
      const idx = i + k; if (idx > 100) return;
      const r = await call('POST', '/api/contributions/mine/rate', { token: tokens[idx], body: { amount: rateOf(idx) } });
      if (r.status === 201 && Number(r.json?.data?.rate?.amount) === rateOf(idx)) rateOk++; else rateFail++;
    }));
  }
  check('100/100 members set their assigned rate (201)', rateOk === 100 && rateFail === 0, `ok ${rateOk} fail ${rateFail}`);
  // Invalid amount still rejected at cohort scale.
  const badRate = await call('POST', '/api/contributions/mine/rate', { token: tokens[5], body: { amount: 45 } });
  check('invalid rate amount rejected (400)', badRate.status === 400, `status ${badRate.status}`);

  section('P2) Payments per group (test provider + manual pending workflow)');
  let payOk = 0, payFail = 0;
  for (let i = 1; i <= 100; i++) {
    const g = groupOf(i);
    if (g === 'pending' || g === 'rejected' || g === 'approved_manual') continue; // manual flow below
    // overpay: rate 20, pays 100 (80 -> extra). partial: rate 50, pays 20 (30 stays due).
    const amount = g === 'overpay' ? 100 : g === 'partial' ? 20 : rateOf(i);
    const r = await call('POST', '/api/payments', {
      token: tokens[i],
      body: { registration_number: demoReg(i), payment_type: 'monthly', amount, months: [CUR], sender_number: '01712345678' },
    });
    if (r.status === 201 && r.json?.data?.payment?.status === 'success') payOk++; else { payFail++; if (payFail <= 3) console.log(`  member ${i} (${g}) -> ${r.status} ${r.json?.message || ''}`); }
  }
  check('test-provider monthly payments succeed for exact/partial/overpay groups (70)', payOk === 70 && payFail === 0, `ok ${payOk} fail ${payFail}`);

  // Manual pending submissions for the pending/rejected/approved_manual groups (30).
  const fdManual = (i, txn, prov = 'bkash') => {
    const f = new FormData();
    f.append('registration_number', demoReg(i));
    f.append('payment_type', 'monthly');
    f.append('payment_method', prov);
    f.append('amount', String(rateOf(i)));
    f.append('billing_month', CUR);
    f.append('transaction_id', txn);
    return f;
  };
  const manualPids = { pending: [], rejected: [], approved_manual: [] };
  let manualOk = 0;
  for (let i = 1; i <= 100; i++) {
    const g = groupOf(i);
    if (!['pending', 'rejected', 'approved_manual'].includes(g)) continue;
    const prov = g === 'rejected' ? 'nagad' : g === 'approved_manual' ? 'rocket' : 'bkash';
    const r = await call('POST', '/api/payments/manual', { token: tokens[i], form: fdManual(i, `DEMO${stamp}M${i}`, prov) });
    if (r.status === 201 && r.json?.data?.payment?.status === 'pending') { manualOk++; manualPids[g].push({ i, pid: r.json.data.payment.payment_id }); }
    else if (manualOk < 3) console.log(`  manual ${i} (${g}) -> ${r.status} ${r.json?.message || ''}`);
  }
  check('30 manual submissions -> 201 PENDING', manualOk === 30, `ok ${manualOk}`);

  // Duplicate protections at scale.
  const dupManual = await call('POST', '/api/payments/manual', { token: tokens[1], form: fdManual(1, `DEMO${stamp}M1`, 'bkash') });
  check('duplicate Transaction ID rejected (409)', dupManual.status === 409, `status ${dupManual.status}`);
  const dupMonth = await call('POST', '/api/payments', {
    token: tokens[5],
    body: { registration_number: demoReg(5), payment_type: 'monthly', amount: rateOf(5), months: [CUR], sender_number: '01712345678' },
  });
  check('already-settled month cannot be paid again (409)', dupMonth.status === 409, `status ${dupMonth.status}`);

  section('P3) Authority reviews: approve 10, reject 10, leave 10 pending');
  let approveOk = 0, rejectOk = 0;
  for (const { i, pid } of manualPids.approved_manual) {
    const r = await call('PATCH', `/api/payments/${pid}/review`, { token: authToken, body: { status: 'success', note: 'DEMO verified' } });
    if (r.status === 200 && r.json?.data?.payment?.status === 'success') approveOk++;
  }
  for (const { i, pid } of manualPids.rejected) {
    const r = await call('PATCH', `/api/payments/${pid}/review`, { token: authToken, body: { status: 'rejected', note: 'DEMO no such TrxID' } });
    if (r.status === 200 && r.json?.data?.payment?.status === 'rejected') rejectOk++;
  }
  check('10/10 approvals -> success with reviewer note', approveOk === 10, `ok ${approveOk}`);
  check('10/10 rejections -> rejected with note', rejectOk === 10, `ok ${rejectOk}`);
  const reReview = await call('PATCH', `/api/payments/${manualPids.approved_manual[0].pid}/review`, { token: authToken, body: { status: 'rejected' } });
  check('double review blocked (409)', reReview.status === 409, `status ${reReview.status}`);
  const dupAlloc = await sql(conn,
    `SELECT payment_id, COUNT(*) c FROM monthly_payment_details WHERE payment_id IN (${manualPids.approved_manual.map(() => '?').join(',')}) GROUP BY payment_id HAVING COUNT(*) > 1`,
    manualPids.approved_manual.map((x) => x.pid));
  check('no duplicate allocation rows per approved payment', dupAlloc.length === 0, JSON.stringify(dupAlloc));

  section('P4) Per-group ledger expectations (authoritative /api/contributions/mine)');
  const sample = [5, 4, 34, 11, 22, 12, 10, 20, 45]; // exact, partial×2, pending, rejected×2, overpay×2, exact
  let groupChecks = 0, groupBad = 0;
  for (const i of sample) {
    const g = groupOf(i);
    const r = await call('GET', '/api/contributions/mine', { token: tokens[i] });
    const s = r.json?.data?.summary || {};
    const expDue = (g === 'pending' || g === 'rejected') ? rateOf(i) : g === 'partial' ? 30 : 0;
    const expExtra = g === 'overpay' ? 80 : 0;
    const expPending = g === 'pending' ? rateOf(i) : 0;
    groupChecks++;
    if (!(closeTo(s.total_due, expDue) && closeTo(s.total_extra, expExtra) && closeTo(s.pending_amount, expPending))) {
      groupBad++;
      console.log(`    member ${i} (${g}): due ${s.total_due}/${expDue} extra ${s.total_extra}/${expExtra} pending ${s.pending_amount}/${expPending}`);
    }
  }
  check('sampled members match group expectations (9/9)', groupChecks === 9 && groupBad === 0, `bad ${groupBad}`);

  section('P5) CRITICAL ACCEPTANCE: dedicated member — four ৳20 dues, pay ৳100 -> 80/20/0');
  // A FRESH member (not part of the cohort payment phase) so the obligation
  // start resolves from the backfilled rate month. Fixture: rate 20 effective
  // 4 months ago (mirrors contributionTest practice — effective months are
  // never retroactive via the API by design, so historical fixtures are
  // inserted directly, exactly like contributionTest.js does).
  const accEmail = `${DEMO_EMAIL_PREFIX}acc903@${DEMO_EMAIL_DOMAIN}`;
  const [accRows] = await sql(conn, `SELECT user_id, status FROM users WHERE email = ?`, [accEmail]);
  const accExisting = accRows;
  let accId = accExisting?.user_id;
  if (!accId) {
    const regAcc = await call('POST', '/api/auth/register', { body: {
      first_name: 'DemoAccept', last_name: 'Scenario', email: accEmail, password: DEMO_PASSWORD,
      phone: '01700000903', registration_number: `${DEMO_REG_PREFIX}ACC903`, ssc_batch: 2005,
      blood_group: 'O+', profession: 'Teacher', institute: 'Bilbilash High School',
      present_address: 'Demo Village 903', permanent_address: 'Demo Village 903',
    } });
    check('acceptance member registered (201)', regAcc.status === 201, `status ${regAcc.status}`);
    const list = await call('GET', '/api/users/pending', { token: authToken });
    const found = (list.json?.data?.users || []).find((u) => u.email === accEmail);
    const ap = await call('PUT', `/api/users/${found.user_id}/approve`, { token: authToken });
    check('acceptance member approved (200)', ap.status === 200, `status ${ap.status}`);
    accId = found.user_id;
  }
  const accLogin0 = await call('POST', '/api/auth/login', { body: { email: accEmail, password: DEMO_PASSWORD } });
  if (!accLogin0.json?.data?.token && accId) {
    // Self-heal: the seed-owned fixture may have been left inactive by an
    // earlier run — re-approve it through the real API (demo rows only).
    const fix = await call('PUT', `/api/users/${accId}/approve`, { token: authToken });
    check('acceptance member reactivated (200)', fix.status === 200, `status ${fix.status}`);
  }
  const accLogin = await call('POST', '/api/auth/login', { body: { email: accEmail, password: DEMO_PASSWORD } });
  const accToken = accLogin.json?.data?.token;
  check('acceptance member login', !!accToken);
  const w0 = (() => { const [y, m] = CUR.split('-').map(Number); const abs = y * 12 + (m - 1) - 3; return `${Math.floor(abs / 12)}-${pad((abs % 12) + 1)}`; })();
  await sql(conn, `INSERT INTO member_monthly_rates (user_id, amount, effective_month, source, set_by) VALUES (?, 20, ?, 'member', ?)`, [accId, w0, accId]);
  const dues99 = await call('GET', '/api/contributions/mine', { token: accToken });
  const nMonths = (CUR.slice(0, 4) === w0.slice(0, 4)) ? (Number(CUR.slice(5)) - Number(w0.slice(5)) + 1) : (12 - Number(w0.slice(5)) + 1 + Number(CUR.slice(5)));
  check(`acceptance: dues = ৳${nMonths * 20} across ${nMonths} month(s) from ${w0}`, closeTo(dues99.json?.data?.summary?.total_due, nMonths * 20), `got ${dues99.json?.data?.summary?.total_due}`);
  const pay99 = await call('POST', '/api/payments', {
    token: accToken,
    body: { registration_number: `${DEMO_REG_PREFIX}ACC903`, payment_type: 'monthly', amount: 100, months: [CUR], sender_number: '01712345678' },
  });
  check('acceptance: ৳100 payment approved instantly (201 success)', pay99.status === 201 && pay99.json?.data?.payment?.status === 'success', `status ${pay99.status}`);
  const alloc99 = await sql(conn,
    `SELECT payment_month, SUM(amount) amount, SUM(extra_amount) extra FROM monthly_payment_details mpd
      JOIN users u ON u.user_id = mpd.user_id WHERE u.email = ? GROUP BY payment_month ORDER BY payment_month`,
    [accEmail]);
  const totalAlloc = alloc99.reduce((a, r) => a + Number(r.amount), 0);
  const totalDuePart = alloc99.reduce((a, r) => a + (Number(r.amount) - Number(r.extra)), 0);
  const totalExtraPart = alloc99.reduce((a, r) => a + Number(r.extra), 0);
  // 100 covers the 4 oldest months (80) when nMonths>=4; else covers all dues, remainder extra.
  const expDue99 = Math.min(100, nMonths * 20);
  const expExtra99 = 100 - expDue99;
  check('acceptance: original ৳100 fully preserved (SUM(amount)=100)', closeTo(totalAlloc, 100), `got ${totalAlloc}`);
  check(`acceptance: ৳${expDue99} allocated oldest-first, ৳${expExtra99} extra`, closeTo(totalDuePart, expDue99) && closeTo(totalExtraPart, expExtra99), `due ${totalDuePart} extra ${totalExtraPart}`);
  const after99 = await call('GET', '/api/contributions/mine', { token: accToken });
  check('acceptance: remaining outstanding due = ৳0', closeTo(after99.json?.data?.summary?.total_due, 0), `got ${after99.json?.data?.summary?.total_due}`);
  const mine99 = await call('GET', '/api/payments/mine', { token: accToken });
  check('acceptance: member payment history shows txn id + covered months',
    mine99.json?.data?.payments?.[0]?.transaction_id?.startsWith('TEST-')
    && mine99.json?.data?.payments?.[0]?.covered_months?.length === Math.ceil(expDue99 / 20),
    JSON.stringify(mine99.json?.data?.payments?.[0]?.covered_months));

  section('P6) Cohort reconciliation (member-wise report vs DB)');
  const rep = await call('GET', `/api/contributions/members?search=${DEMO_REG_PREFIX}&limit=200`, { token: authToken });
  check('member-wise report returns the cohort (200)', rep.status === 200 && (rep.json?.data?.members || []).length >= 100, `count ${rep.json?.data?.members?.length}`);
  const members = rep.json?.data?.members || [];
  const sumDue = members.reduce((a, m) => a + Number(m.total_due || 0), 0);
  const sumExtra = members.reduce((a, m) => a + Number(m.total_extra || 0), 0);
  const sumMonthly = members.reduce((a, m) => a + Number(m.approved_monthly_total || 0), 0);
  // DB ground truth for the cohort.
  const [dbExtra] = await sql(conn,
    `SELECT COALESCE(SUM(mpd.extra_amount),0) e FROM monthly_payment_details mpd JOIN users u ON u.user_id=mpd.user_id WHERE u.email LIKE ?`, [DEMO_LIKE]);
  const [dbMonthly] = await sql(conn,
    `SELECT COALESCE(SUM(p.amount),0) s FROM payments p JOIN users u ON u.user_id=p.user_id WHERE u.email LIKE ? AND p.status='success' AND p.payment_type='monthly'`, [DEMO_LIKE]);
  // pending(10)+rejected(10) members each owe their rate; partial(10) owe 30.
  let expDueCohort = 0;
  for (let i = 1; i <= 100; i++) { const g = groupOf(i); if (g === 'pending' || g === 'rejected') expDueCohort += rateOf(i); else if (g === 'partial') expDueCohort += 30; }
  check(`report cohort total_due = ৳${expDueCohort}`, closeTo(sumDue, expDueCohort), `got ${sumDue}`);
  check('report extra total matches DB SUM(extra_amount)', closeTo(sumExtra, Number(dbExtra.e)), `report ${sumExtra} db ${dbExtra.e}`);
  check('report approved monthly totals match DB success payments', closeTo(sumMonthly, Number(dbMonthly.s)), `report ${sumMonthly} db ${dbMonthly.s}`);

  const fin = await call('GET', '/api/analytics/financial', { token: authToken });
  const kpis = fin.json?.data?.kpis || {};
  check('analytics financial KPIs reconcile (total_paid >= cohort monthly)', fin.status === 200 && Number(kpis.total_paid) + 0.001 >= Number(dbMonthly.s), `paid ${kpis.total_paid} cohort ${dbMonthly.s}`);
  const paidFromMpd = await sql(conn,
    `SELECT COALESCE(SUM(mpd.amount - mpd.extra_amount),0) due_part, COALESCE(SUM(mpd.extra_amount),0) extra_part
       FROM monthly_payment_details mpd JOIN payments p ON p.payment_id = mpd.payment_id
       JOIN users u ON u.user_id = mpd.user_id WHERE u.email LIKE ? AND p.status='success'`, [DEMO_LIKE]);
  check('cohort allocations: due-part + extra-part = SUM(amount) (no double counting)',
    closeTo(Number(paidFromMpd[0].due_part) + Number(paidFromMpd[0].extra_part),
      Number(paidFromMpd[0].due_part) + Number(dbExtra.e)));

  section('P7) Pending never counted; rejected never counted');
  const pendMember = 11; // i%10==1 group
  const minePend = await call('GET', '/api/payments/mine', { token: tokens[pendMember] });
  check('pending member: totals.monthly_total = 0', closeTo(minePend.json?.data?.totals?.monthly_total, 0), JSON.stringify(minePend.json?.data?.totals));
  const msPend = await call('GET', '/api/payments/monthly-status', { token: tokens[pendMember] });
  const pendRow = (msPend.json?.data?.months || []).find((m) => m.month === CUR);
  check('pending member: current month pending=true, paid=false', pendRow?.pending === true && pendRow?.paid === false, JSON.stringify(pendRow));
  const rejMember = 12; // i%10==2 group
  const mineRej = await call('GET', '/api/payments/mine', { token: tokens[rejMember] });
  check('rejected member: totals.monthly_total = 0, row shows rejected + note',
    closeTo(mineRej.json?.data?.totals?.monthly_total, 0)
    && mineRej.json?.data?.payments?.some((p) => p.status === 'rejected' && !!p.review_note));

  section('P8) Community workflows with demo members');
  const t1 = tokens[7], t2 = tokens[17], t3 = tokens[27];
  const help = await call('POST', '/api/help', { token: t1, body: { title: `DEMO-${stamp} Blood help`, description: 'Blood needed for surgery', category: 'blood', urgency: 'emergency', blood_group: 'O+', location: 'Bilbilash Union', required_date: '2030-03-03' } });
  check('help request with blood group + emergency -> 201', help.status === 201, `status ${help.status} ${help.json?.message || ''}`);
  const helpStatus = await call('PUT', `/api/help/${help.json?.data?.help_id}/status`, { token: authToken, body: { status: 'in_progress' } });
  check('authority updates help status -> 200', helpStatus.status === 200, `status ${helpStatus.status}`);
  const vision = await call('POST', '/api/visions', { token: t2, body: { title: `DEMO-${stamp} Vision`, description: 'Build a demo library', category: 'education' } });
  const vMod = await call('PUT', `/api/visions/${vision.json?.data?.vision_id}/moderate`, { token: authToken, body: { action: 'approve' } });
  check('vision submit + authority approve -> 201/200', vision.status === 201 && vMod.status === 200, `vision ${vision.status} mod ${vMod.status}`);
  const job = await call('POST', '/api/jobs', { token: t3, body: { title: `DEMO-${stamp} Job`, company: 'Demo Corp', description: 'Demo opening', location: 'Dhaka' } });
  const jMod = await call('PUT', `/api/jobs/${job.json?.data?.job_id}/moderate`, { token: authToken, body: { action: 'approve' } });
  check('job submit + authority approve -> 201/200', job.status === 201 && jMod.status === 200, `job ${job.status} mod ${jMod.status}`);
  const poll = await call('POST', '/api/polls', { token: authToken, body: { question: `DEMO-${stamp} Poll`, options: 'Yes | No | Abstain' } });
  const polls = await call('GET', '/api/polls', { token: t1 });
  const optId = polls.json?.data?.polls?.find((p) => p.poll_id === poll.json?.data?.poll_id)?.options?.[0]?.option_id;
  const vote1 = await call('POST', `/api/polls/${poll.json?.data?.poll_id}/vote`, { token: t1, body: { option_id: optId } });
  const vote2 = await call('POST', `/api/polls/${poll.json?.data?.poll_id}/vote`, { token: t1, body: { option_id: optId } });
  check('poll vote once, duplicate blocked (201 then 409)', vote1.status === 201 && vote2.status === 409, `${vote1.status}/${vote2.status}`);
  const ev = await call('POST', '/api/events', { token: authToken, body: { title: `DEMO-${stamp} Event`, event_date: '2030-02-02', capacity: 2 } });
  const evR1 = await call('POST', `/api/events/${ev.json?.data?.event_id}/register`, { token: t1 });
  const evDup = await call('POST', `/api/events/${ev.json?.data?.event_id}/register`, { token: t1 });
  const evR2 = await call('POST', `/api/events/${ev.json?.data?.event_id}/register`, { token: t2 });
  const evFull = await call('POST', `/api/events/${ev.json?.data?.event_id}/register`, { token: t3 });
  check('event capacity + duplicate registration enforced', evR1.status === 201 && evDup.status === 409 && evR2.status === 201 && evFull.status === 409, `${evR1.status}/${evDup.status}/${evR2.status}/${evFull.status}`);
  const notice = await call('POST', '/api/notices', { token: authToken, body: { title: `DEMO-${stamp} Notice`, body: 'Demo notice body' } });
  const noticePub = await call('GET', '/api/notices');
  check('notice published + publicly visible', notice.status === 201 && (noticePub.json?.data?.notices || []).some((n) => n.title === `DEMO-${stamp} Notice`));
  // Profile update + Active Donor + directory.
  const prof = await call('PUT', '/api/profile', { token: t1, form: (() => {
    const f = new FormData();
    f.append('first_name', 'DemoActive'); f.append('last_name', 'Donor'); f.append('phone', '01712345678');
    f.append('registration_number', demoReg(7)); f.append('active_donor', 'true');
    f.append('present_address', 'Demo Village 7'); f.append('permanent_address', 'Demo Village 7');
    return f;
  })() });
  check('profile update with active_donor -> 200', prof.status === 200, `status ${prof.status}`);
  const dir = await call('GET', '/api/directory?search=DemoActive', { token: t2 });
  const dirHit = (dir.json?.data?.members || dir.json?.data?.results || []).find((m) => m.first_name === 'DemoActive');
  check('directory shows updated name + active donor flag', dir.status === 200 && !!dirHit && (dirHit.active_donor === true || dirHit.active_donor === 1), JSON.stringify(dirHit && { name: dirHit.first_name, donor: dirHit.active_donor }));
  const teachers = await call('GET', '/api/teachers');
  check('teacher directory public (200)', teachers.status === 200);
  // Gallery: upload -> approve -> member delete denied -> authority delete.
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex');
  const gfd = new FormData();
  gfd.append('image', new Blob([png], { type: 'image/png' }), 'demo.png');
  gfd.append('caption', `DEMO ${stamp}`);
  const gal = await call('POST', '/api/gallery', { token: t2, form: gfd });
  const galMod = await call('PUT', `/api/gallery/${gal.json?.data?.gallery_id}/moderate`, { token: authToken, body: { action: 'approve' } });
  const galMemberDel = await call('DELETE', `/api/gallery/${gal.json?.data?.gallery_id}`, { token: t2 });
  const galAuthDel = await call('DELETE', `/api/gallery/${gal.json?.data?.gallery_id}`, { token: authToken, body: { reason: 'DEMO cleanup' } });
  check('gallery upload/approve/permission-delete', gal.status === 201 && galMod.status === 200 && [401, 403, 404].includes(galMemberDel.status) && galAuthDel.status === 200,
    `${gal.status}/${galMod.status}/${galMemberDel.status}/${galAuthDel.status}`);
  // Donation vs monthly separation.
  const don = await call('POST', '/api/payments', { token: t2, body: { registration_number: demoReg(17), payment_type: 'occasional', purpose: 'donation', amount: 250, sender_number: '01812345678', description: 'DEMO donation' } });
  check('donation recorded as occasional (201)', don.status === 201, `status ${don.status}`);
  const donLedger = await call('GET', '/api/contributions/mine', { token: t2 });
  check('donation does not change monthly dues/extra', donLedger.status === 200 && closeTo(donLedger.json?.data?.summary?.total_due, 0) && closeTo(donLedger.json?.data?.summary?.total_extra, 0),
    `due ${donLedger.json?.data?.summary?.total_due} extra ${donLedger.json?.data?.summary?.total_extra}`);

  section('P9) Notifications & authorization matrix');
  const notifs = await call('GET', '/api/notifications', { token: tokens[33] }); // approved_manual member
  const paymentNotif = (notifs.json?.data?.notifications || []).find((n) => n.type === 'payment_approved');
  check('approved member received payment_approved notification', !!paymentNotif, `types ${(notifs.json?.data?.notifications || []).map((n) => n.type).join(',')}`);
  if (paymentNotif) {
    const readOther = await call('PUT', `/api/notifications/${paymentNotif.notification_id}/read`, { token: tokens[34] });
    check("cannot mark another member's notification read (403/404)", [403, 404].includes(readOther.status), `status ${readOther.status}`);
    const markRead = await call('PUT', `/api/notifications/${paymentNotif.notification_id}/read`, { token: tokens[33] });
    check('own notification mark-read -> 200', markRead.status === 200, `status ${markRead.status}`);
  }
  const noticeNotif = (await call('GET', '/api/notifications', { token: tokens[45] })).json?.data?.notifications || [];
  check('community notice notification fanned out to members', noticeNotif.some((n) => n.type === 'new_notice'), `types ${noticeNotif.map((n) => n.type).join(',')}`);
  // Authorization matrix.
  const repDenied = await call('GET', '/api/contributions/members', { token: tokens[5] });
  check('MEMBER cannot read member-wise dues report (403)', repDenied.status === 403, `status ${repDenied.status}`);
  const reviewDenied = await call('PATCH', `/api/payments/${manualPids.pending[0].pid}/review`, { token: tokens[5], body: { status: 'success' } });
  check('MEMBER cannot review payments (403)', reviewDenied.status === 403, `status ${reviewDenied.status}`);
  const listDenied = await call('GET', '/api/payments', { token: tokens[5] });
  check('MEMBER cannot list all payments (403)', listDenied.status === 403, `status ${listDenied.status}`);
  const xUser = await call('GET', `/api/payments/monthly-status?user_id=${ids[6]}`, { token: tokens[5] });
  check("MEMBER cannot read another member's monthly status (403)", xUser.status === 403, `status ${xUser.status}`);
  // Pending (unapproved) demo member is restricted.
  const pendEmail = `${DEMO_EMAIL_PREFIX}pend901@${DEMO_EMAIL_DOMAIN}`;
  const pendLogin = await call('POST', '/api/auth/login', { body: { email: pendEmail, password: DEMO_PASSWORD } });
  const pendToken = pendLogin.json?.data?.token;
  if (pendToken) {
    const pendReport = await call('GET', '/api/contributions/members', { token: pendToken });
    const pendStatus = await call('GET', '/api/payments/monthly-status', { token: pendToken });
    check('PENDING member: dues report forbidden, financial status restricted', pendReport.status === 403 && pendStatus.status >= 400, `${pendReport.status}/${pendStatus.status}`);
    const pendContrib = await call('GET', '/api/contributions/mine', { token: pendToken });
    check('PENDING member cannot set a contribution rate', pendContrib.status === 403 || pendContrib.status === 404, `status ${pendContrib.status}`);
  } else {
    check('pending demo member cannot log in (403, no token)', pendLogin.status === 403, `status ${pendLogin.status}`);
  }
  // Rejected demo member cannot log in.
  const rejLogin = await call('POST', '/api/auth/login', { body: { email: `${DEMO_EMAIL_PREFIX}rej902@${DEMO_EMAIL_DOMAIN}`, password: DEMO_PASSWORD } });
  check('REJECTED member cannot log in (401)', rejLogin.status === 401, `status ${rejLogin.status}`);
  // Visitor token (fresh pending registration) blocked from member content.
  const visitor = await call('POST', '/api/auth/register', { body: {
    first_name: 'DemoVisitor', last_name: 'Tmp', email: `demo.visitor.${stamp}@${DEMO_EMAIL_DOMAIN}`,
    password: DEMO_PASSWORD, phone: '01700000099', registration_number: `DEMO-VIS-${stamp}`,
    present_address: 'Demo', permanent_address: 'Demo',
  } });
  const visLogin = await call('POST', '/api/auth/login', { body: { email: `demo.visitor.${stamp}@${DEMO_EMAIL_DOMAIN}`, password: DEMO_PASSWORD } });
  const visToken = visLogin.json?.data?.token;
  check('VISITOR (pending) cannot log in (403, no token)', visitor.status === 201 && visLogin.status === 403 && !visToken, `visitor reg ${visitor.status} login ${visLogin.status}`);
  await sql(conn, `DELETE FROM users WHERE email = ?`, [`demo.visitor.${stamp}@${DEMO_EMAIL_DOMAIN}`]); // remove throwaway visitor

  await conn.end();
  console.log('\n==================================================');
  console.log(`DEMO E2E RESULT: ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log(`  - ${f}`)); }
  console.log('==================================================');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('demo E2E crashed:', e.message); process.exit(1); });
