import { query, queryOne, withTransaction } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { notify, NOTIFICATION_TYPES } from './notificationService.js';
import { audit } from './statsService.js';

/*
 * CONTRIBUTION SERVICE — THE single authoritative monthly-contribution and
 * due-calculation logic for the whole application.
 *
 * Profile, the Payments page, the admin payment summary and the Analytics
 * Dashboard all call THIS module, so they can never disagree. Do not add a
 * second due algorithm anywhere else.
 *
 * Domain rules implemented here (see master spec §4–§7):
 *  - Rates are APPEND-ONLY history (member_monthly_rates). A rate governs
 *    every month from its effective_month until the next rate's effective
 *    month. Nothing is ever overwritten, so historic dues keep historic rates.
 *  - Effective months are never retroactive (>= current month), so a rate
 *    change can never silently rewrite a past month or an approved payment.
 *  - Obligation start = explicit value ?? earliest approved payment month ??
 *    first configured rate month ?? UNKNOWN. Unknown is reported as unknown —
 *    a contribution-start date is never invented.
 *  - Paid months come from monthly_payment_details (written ONLY on approval).
 *    Pending/rejected payments never count as paid and never reduce dues.
 *  - Paying more than the month's rate stores the surplus in extra_amount —
 *    it is never treated as another monthly payment, never auto-applied to a
 *    later month, and never double-counted.
 *  - A month with no rate for an obligated member is 'rate_not_set': its
 *    monetary value is unknown, NOT zero.
 */

// Single source of truth for allowed contribution amounts (reused by
// paymentService and the contribution API).
export const MONTHLY_AMOUNTS = [20, 30, 50, 100];
export const MONTHLY_MAX = 100;

const pad = (n) => String(n).padStart(2, '0');
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const monthLabel = (key) => {
  const [y, m] = String(key).split('-').map(Number);
  return `${MONTH_NAMES[(m || 1) - 1]} ${y}`;
};
export const currentYM = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
};
export const monthIdx = (key) => {
  const [y, m] = String(key).split('-').map(Number);
  return y * 12 + (m - 1);
};
export const shiftMonth = (key, delta) => {
  const abs = monthIdx(key) + delta;
  return `${Math.floor(abs / 12)}-${pad((abs % 12) + 1)}`;
};
export const isValidMonthKey = (key) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(key || ''));
export const monthRange = (fromKey, toKey) => {
  const out = [];
  if (!isValidMonthKey(fromKey) || !isValidMonthKey(toKey) || monthIdx(fromKey) > monthIdx(toKey)) return out;
  for (let k = fromKey; monthIdx(k) <= monthIdx(toKey); k = shiftMonth(k, 1)) out.push(k);
  return out;
};

/**
 * Resolve a member's contribution obligation start.
 * Explicit value wins; otherwise the earliest APPROVED payment month is a
 * reliable lower bound; otherwise the first explicitly configured rate month;
 * otherwise UNKNOWN (null) — never guessed from registration date.
 */
export function resolveContributionStart({ explicitStart, earliestPaidMonth, firstRateMonth } = {}) {
  // 'profile' = profiles.contribution_start_month — set by a member/admin, or
  // filled by the documented migration from the earliest approved payment.
  if (isValidMonthKey(explicitStart)) return { month: explicitStart, source: 'profile' };
  if (isValidMonthKey(earliestPaidMonth)) return { month: earliestPaidMonth, source: 'first_payment' };
  if (isValidMonthKey(firstRateMonth)) return { month: firstRateMonth, source: 'first_rate' };
  return { month: null, source: 'unknown' };
}

/** Effective rate for a month = the latest rate whose effective_month <= month. */
export function rateForMonth(rates, monthKey) {
  let found = null;
  for (const r of rates) {
    if (monthIdx(r.effective_month) <= monthIdx(monthKey)) found = r;
    else break; // rates must arrive sorted ascending by effective_month
  }
  return found;
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Pure split of a received monthly amount against the month's rate:
 *   rate known & paid >= rate  -> allocate the rate, record the surplus as EXTRA
 *   rate known & paid <  rate  -> partial (remainder stays due)
 *   rate unknown               -> allocate everything, nothing is invented
 */
export function splitByRate(rateAmount, paidAmount) {
  const paid = Number(paidAmount);
  if (rateAmount == null) return { rate: null, allocated: paid, extra: 0 };
  const rate = Number(rateAmount);
  if (paid >= rate) return { rate, allocated: rate, extra: round2(paid - rate) };
  return { rate, allocated: paid, extra: 0 };
}

/**
 * Build the month-by-month ledger for one member. Pure function (no DB) so it
 * is directly unit-testable for every business case in the test suite.
 *
 * statuses: not_obligated | start_unknown | paid | partial | pending |
 *           rate_not_set | due
 */
export function buildLedger({ start, rates, paid, pending, fromKey, toKey }) {
  const sortedRates = [...(rates || [])].sort((a, b) => monthIdx(a.effective_month) - monthIdx(b.effective_month));
  const rows = [];
  for (const month of monthRange(fromKey, toKey)) {
    const rate = rateForMonth(sortedRates, month);
    const paidRow = paid?.get ? paid.get(month) : null;
    const pendingRow = pending?.get ? pending.get(month) : null;

    const row = {
      month,
      label: monthLabel(month),
      status: 'due',
      rate: rate ? Number(rate.amount) : null,
      rate_source: rate ? rate.source : null,
      required: rate ? Number(rate.amount) : null,
      allocated: 0,
      extra: 0,
      remaining: rate ? Number(rate.amount) : 0,
      pending_amount: 0,
      flags: [],
    };

    // 0) A PENDING payment is a hard fact about this month and must stay
    //    visible ("awaiting verification") even while the obligation start is
    //    still unknown. It never looks paid and never reduces confirmed dues.
    //    A month that already has approved allocations keeps its paid/partial
    //    status (checked below), so a pending top-up cannot mask a real remainder.
    if (!start?.month && pendingRow && !paidRow) {
      row.status = 'pending';
      row.pending_amount = rate ? Number(rate.amount) : Number(pendingRow.amount || 0);
      row.remaining = 0;
      row.flags.push('contribution_start_unknown');
      if (!rate) row.flags.push('rate_not_set');
      rows.push(row);
      continue;
    }
    // 1) Obligation start unknown → the month's obligation cannot be determined.
    if (!start?.month) {
      row.status = 'start_unknown';
      row.remaining = null; // unknown, NOT zero
      row.flags.push('contribution_start_unknown');
      rows.push(row);
      continue;
    }
    // 2) Before the member's obligation began → never charged.
    if (monthIdx(month) < monthIdx(start.month)) {
      row.status = 'not_obligated';
      row.remaining = 0;
      row.required = rate ? Number(rate.amount) : null; // informational only
      rows.push(row);
      continue;
    }

    // 3) Approved payment exists for this month (monthly_payment_details).
    if (paidRow) {
      const allocated = round2(Number(paidRow.amount) - Number(paidRow.extra_amount || 0));
      row.allocated = allocated;
      row.extra = round2(Number(paidRow.extra_amount || 0));
      // A rate configured AFTER the month was already paid must not create a
      // retroactive charge — flag it for manual review instead. Reconciliation
      // rows are exempt: they were DERIVED from that very payment.
      const rateCreatedAfterPayment = rate
        && rate.source !== 'reconciliation'
        && rate.effective_month === month
        && rate.created_at && paidRow.created_at
        && new Date(rate.created_at).getTime() > new Date(paidRow.created_at).getTime();
      if (rateCreatedAfterPayment) {
        row.flags.push('rate_set_after_payment_manual_review');
        row.status = 'paid';
        row.remaining = 0;
      } else if (rate == null) {
        row.status = 'paid'; // paid while no rate was set — nothing outstanding
        row.remaining = 0;
        row.flags.push('paid_without_configured_rate');
      } else if (allocated >= Number(rate.amount)) {
        row.status = 'paid';
        row.remaining = 0;
      } else {
        row.status = 'partial';
        row.remaining = round2(Number(rate.amount) - allocated);
      }
      rows.push(row);
      continue;
    }

    // 4) Payment awaiting verification: not paid, not confirmed due.
    if (pendingRow) {
      row.status = 'pending';
      row.pending_amount = rate ? Number(rate.amount) : Number(pendingRow.amount || 0);
      row.remaining = 0; // excluded from confirmed outstanding due
      if (!rate) row.flags.push('rate_not_set');
      rows.push(row);
      continue;
    }

    // 5) Obligated month with no configured rate → monetary value UNKNOWN.
    if (!rate) {
      row.status = 'rate_not_set';
      row.remaining = null;
      row.flags.push('rate_not_set');
      rows.push(row);
      continue;
    }

    // 6) Normal outstanding month.
    row.status = 'due';
    row.remaining = Number(rate.amount);
    rows.push(row);
  }
  return rows;
}

/** Aggregate a ledger into the summary every consumer displays. */
export function summarizeLedger(rows, { start, currentRate } = {}) {
  let totalRequired = 0, totalAllocated = 0, totalExtra = 0, totalDue = 0, pendingAmount = 0;
  const dueMonths = [], rateNotSetMonths = [], reviewFlags = [];
  for (const r of rows) {
    if (r.status === 'not_obligated') continue;
    if (r.required != null && r.status !== 'rate_not_set' && r.status !== 'start_unknown') totalRequired += r.required;
    totalAllocated += r.allocated || 0;
    totalExtra += r.extra || 0;
    if (r.status === 'due' || r.status === 'partial') {
      totalDue += r.remaining || 0;
      dueMonths.push({ month: r.month, remaining: r.remaining });
    }
    if (r.status === 'pending') {
      pendingAmount += r.pending_amount || 0;
      // Spec: "outstanding due decreases only by eligible approved
      // allocations" — a payment awaiting verification is not confirmed money,
      // so its month stays in the outstanding due until approval. Months whose
      // rate is unknown stay unknown (no invented amount).
      if (r.rate != null) totalDue += Number(r.rate);
    }
    if (r.status === 'rate_not_set') rateNotSetMonths.push(r.month);
    for (const f of r.flags) {
      if (f === 'rate_set_after_payment_manual_review') reviewFlags.push({ month: r.month, flag: f });
    }
  }
  return {
    start_month: start?.month ?? null,
    start_source: start?.source ?? 'unknown',
    start_unknown: !start?.month,
    current_rate: currentRate != null ? Number(currentRate.amount) : null,
    current_rate_effective_month: currentRate?.effective_month ?? null,
    total_required: round2(totalRequired),
    total_allocated: round2(totalAllocated),
    total_extra: round2(totalExtra),
    total_due: round2(totalDue),
    pending_amount: round2(pendingAmount),
    due_months: dueMonths,
    due_month_count: dueMonths.length,
    rate_not_set_months: rateNotSetMonths,
    review_flags: reviewFlags,
    up_to_date: round2(totalDue) === 0 && rateNotSetMonths.length === 0 && !!start?.month,
  };
}

/* ------------------------------------------------------------------ */
/* DB access                                                           */
/* ------------------------------------------------------------------ */

/** All contribution facts for one member (rates, payments, pending, start). */
export async function getContributionFacts(userId) {
  const [rates, paidRows, pendingRows, member] = await Promise.all([
    query(`SELECT rate_id, amount, effective_month, source, created_at
             FROM member_monthly_rates WHERE user_id = ? ORDER BY effective_month, rate_id`, [userId]),
    // One payment can settle several months and a month can be topped up by a
    // later payment, so allocations are SUMMED per month.
    query(`SELECT payment_month, SUM(amount) AS amount, SUM(extra_amount) AS extra_amount, MIN(created_at) AS created_at
             FROM monthly_payment_details WHERE user_id = ? GROUP BY payment_month ORDER BY payment_month`, [userId]),
    query(`SELECT billing_month, amount FROM payments
            WHERE user_id = ? AND payment_type = 'monthly' AND status = 'pending' AND billing_month IS NOT NULL`, [userId]),
    queryOne(`SELECT u.user_id, u.first_name, u.last_name, u.registration_number, p.contribution_start_month
                FROM users u LEFT JOIN profiles p ON p.user_id = u.user_id WHERE u.user_id = ? LIMIT 1`, [userId]),
  ]);

  const start = resolveContributionStart({
    explicitStart: member?.contribution_start_month,
    earliestPaidMonth: paidRows[0]?.payment_month,
    firstRateMonth: rates[0]?.effective_month,
  });

  return {
    member,
    rates,
    start,
    paid: new Map(paidRows.map((r) => [r.payment_month, r])),
    pending: new Map(pendingRows.filter((r) => r.billing_month).map((r) => [r.billing_month, r])),
  };
}

/** Full ledger + summary for one member (own view or admin detail view). */
export async function getMemberLedger(userId, { toKey = currentYM(), back = 24 } = {}) {
  const facts = await getContributionFacts(userId);
  if (!facts.member) throw notFound('Member not found');

  const endKey = toKey;
  const startKey = facts.start.month
    ? (monthIdx(shiftMonth(endKey, -(back - 1))) > monthIdx(facts.start.month) ? shiftMonth(endKey, -(back - 1)) : facts.start.month)
    : shiftMonth(endKey, -(back - 1));

  const rows = buildLedger({ start: facts.start, rates: facts.rates, paid: facts.paid, pending: facts.pending, fromKey: startKey, toKey: endKey });
  const currentRate = rateForMonth(facts.rates, endKey);
  const summary = summarizeLedger(rows, { start: facts.start, currentRate });

  return {
    member: facts.member,
    history: facts.rates.map((r) => ({
      rate_id: r.rate_id,
      amount: Number(r.amount),
      effective_month: r.effective_month,
      effective_label: monthLabel(r.effective_month),
      source: r.source,
      created_at: r.created_at,
    })),
    start: facts.start,
    summary,
    months: rows,
  };
}

/* ------------------------------------------------------------------ */
/* Oldest-first allocation waterfall (extra contribution rule)          */
/* ------------------------------------------------------------------ */

/**
 * Pure planner. A received monthly payment first settles CONFIRMED outstanding
 * dues, starting from the OLDEST unpaid month; only the remainder becomes an
 * EXTRA contribution.
 *
 * outstanding: [{ month, required, allocated }] — eligible months only
 *   (obligated, rate known, not pending, not fully settled), oldest first.
 * total: money received.
 *
 * Returns { allocations, extra, settled_amount }:
 *  - allocations[].amount = money parked on that month's ledger row, so
 *    SUM(allocations.amount) === total (nothing is lost or double-counted);
 *  - allocations[].extra  = the part of that row's money ABOVE the month's
 *    remaining requirement (only on the last row);
 *  - a null month means "nothing was settleable" — the caller records the
 *    whole amount as extra on the payment's declared month.
 */
export function planAllocation(outstanding, total) {
  let balance = round2(total);
  const allocations = [];
  for (const m of outstanding || []) {
    if (balance <= 0) break;
    const remaining = round2(Number(m.required) - Number(m.allocated || 0));
    if (remaining <= 0) continue;
    const take = Math.min(balance, remaining);
    allocations.push({ month: m.month, amount: take, extra: 0, required_remaining: remaining });
    balance = round2(balance - take);
  }
  let extra = 0;
  if (balance > 0) {
    extra = balance;
    if (allocations.length) {
      const last = allocations[allocations.length - 1];
      last.amount = round2(last.amount + balance);
      last.extra = balance;
    } else {
      allocations.push({ month: null, amount: balance, extra: balance, required_remaining: 0 });
    }
  }
  return { allocations, extra, settled_amount: round2(Number(total) - extra) };
}

/** Eligible months for the waterfall, oldest first (ledger rows in, plan rows out). */
export function eligibleOutstandingMonths(ledgerMonths, { phaseStart, phaseEnd }) {
  return (ledgerMonths || [])
    .filter((m) => (m.status === 'due' || m.status === 'partial')
      && m.required != null
      && monthIdx(m.month) >= monthIdx(phaseStart)
      && monthIdx(m.month) <= monthIdx(phaseEnd))
    .map((m) => ({ month: m.month, required: m.required, allocated: m.allocated }));
}

/**
 * Outstanding months a payment may settle right now (payable phase = January
 * of the current year → current month, the existing payment rule). Works with
 * the pool OR inside a transaction connection so approvals re-check state.
 */
export async function getPayableOutstanding(userId, conn = null, { resolvePendingMonth = null } = {}) {
  const run = async (sql, params = []) => (conn ? (await conn.query(sql, params))[0] : await query(sql, params));
  const [member, rates, paidRows, pendingRows] = await Promise.all([
    run(`SELECT u.user_id, p.contribution_start_month
           FROM users u LEFT JOIN profiles p ON p.user_id = u.user_id WHERE u.user_id = ? LIMIT 1`, [userId]),
    run(`SELECT amount, effective_month, created_at FROM member_monthly_rates
          WHERE user_id = ? ORDER BY effective_month, rate_id`, [userId]),
    run(`SELECT payment_month, SUM(amount) AS amount, SUM(extra_amount) AS extra_amount, MIN(created_at) AS created_at
           FROM monthly_payment_details WHERE user_id = ? GROUP BY payment_month ORDER BY payment_month`, [userId]),
    run(`SELECT billing_month FROM payments
          WHERE user_id = ? AND payment_type = 'monthly' AND status = 'pending' AND billing_month IS NOT NULL`, [userId]),
  ]);
  // `resolvePendingMonth` = the declared month of the payment being approved
  // right now: its pending flag exists only because of THAT payment, so the
  // month must take part in this approval's oldest-first waterfall. Other
  // pending payments still hold their months back.
  const pendingForPlanning = resolvePendingMonth
    ? pendingRows.filter((r) => r.billing_month !== resolvePendingMonth)
    : pendingRows;

  const start = resolveContributionStart({
    explicitStart: member?.[0]?.contribution_start_month,
    earliestPaidMonth: paidRows[0]?.payment_month,
    firstRateMonth: rates[0]?.effective_month,
  });
  const cur = currentYM();
  const phaseStart = `${cur.slice(0, 4)}-01`;
  const ledger = buildLedger({
    start,
    rates,
    paid: new Map(paidRows.map((r) => [r.payment_month, r])),
    pending: new Map(pendingForPlanning.filter((r) => r.billing_month).map((r) => [r.billing_month, r])),
    fromKey: phaseStart,
    toKey: cur,
  });
  return eligibleOutstandingMonths(ledger, { phaseStart, phaseEnd: cur });
}

/** Allocation preview for the payment UI (oldest-first, before submitting). */
export async function getAllocationPreview(userId, amount) {
  const total = Number(amount);
  if (!Number.isFinite(total) || total <= 0) throw badRequest('amount must be a positive number');
  const outstanding = await getPayableOutstanding(userId);
  const plan = planAllocation(outstanding, total);
  const outstandingBefore = outstanding.reduce((a, m) => a + round2(Number(m.required) - Number(m.allocated || 0)), 0);
  return {
    amount: round2(total),
    settles: plan.allocations.filter((a) => a.month).map((a) => ({
      month: a.month, label: monthLabel(a.month),
      from_remaining: a.required_remaining, pays: round2(a.amount - a.extra),
    })),
    settles_amount: plan.settled_amount,
    extra: plan.extra,
    remaining_due_after: round2(Math.max(0, outstandingBefore - plan.settled_amount)),
    outstanding_before: round2(outstandingBefore),
  };
}

/** Load a member's rates in the ascending order rateForMonth() expects. */
export async function getMemberRates(userId) {
  return query(`SELECT rate_id, amount, effective_month, source, created_at
                  FROM member_monthly_rates WHERE user_id = ? ORDER BY effective_month, rate_id`, [userId]);
}

/* ------------------------------------------------------------------ */
/* Rate configuration                                                  */
/* ------------------------------------------------------------------ */

/**
 * Create the next rate row for a member. APPEND-ONLY: previous rows are never
 * touched, so historic dues keep their historic rates.
 * Effective month must never be retroactive (>= current month).
 */
export async function setContributionRate(actor, targetUserId, { amount, effectiveMonth, source = null }) {
  const rateAmount = Number(amount);
  if (!MONTHLY_AMOUNTS.includes(rateAmount)) {
    throw badRequest(`Monthly contribution must be one of: ${MONTHLY_AMOUNTS.join(', ')} (max ৳${MONTHLY_MAX})`);
  }
  const effective = String(effectiveMonth || currentYM()).trim();
  if (!isValidMonthKey(effective)) throw badRequest('effective_month must be a valid YYYY-MM month');

  const cur = currentYM();
  if (monthIdx(effective) < monthIdx(cur)) {
    throw badRequest('The effective month cannot be in the past — changing a past rate would rewrite historical dues.');
  }
  if (monthIdx(effective) > monthIdx(shiftMonth(cur, 24))) {
    throw badRequest('The effective month cannot be more than 24 months in the future.');
  }

  const member = await queryOne(
    `SELECT u.user_id, u.first_name, u.last_name, u.status FROM users u WHERE u.user_id = ? LIMIT 1`,
    [targetUserId]
  );
  if (!member || member.status !== 'approved') throw notFound('Approved member not found');

  const isStaff = actor.role_name === 'ADMIN' || actor.role_name === 'AUTHORITY';
  if (!isStaff && Number(actor.user_id) !== Number(targetUserId)) {
    throw forbidden('You can only change your own monthly contribution');
  }

  const [existingForMonth] = await query(
    `SELECT rate_id, amount FROM member_monthly_rates WHERE user_id = ? AND effective_month = ? LIMIT 1`,
    [targetUserId, effective]
  );
  if (existingForMonth) {
    if (Number(existingForMonth.amount) === rateAmount) {
      // Idempotent: same amount already effective from that month.
      const [row] = await query(`SELECT * FROM member_monthly_rates WHERE rate_id = ?`, [existingForMonth.rate_id]);
      return { rate: row, unchanged: true };
    }
    throw conflict(`A different contribution rate is already effective from ${monthLabel(effective)}. Each month can hold only one rate.`);
  }

  const rateSource = source || (isStaff && Number(actor.user_id) !== Number(targetUserId) ? 'admin' : 'member');
  let rateId;
  try {
    const res = await query(
      `INSERT INTO member_monthly_rates (user_id, amount, effective_month, source, set_by)
       VALUES (?, ?, ?, ?, ?)
       RETURNING rate_id`,
      [targetUserId, rateAmount, effective, rateSource, actor.user_id]
    );
    rateId = res.insertId;
  } catch (err) {
    if (err.code === '23505') throw conflict('A rate is already effective from that month.');
    throw err;
  }

  // The setup reminder is obsolete the moment a rate exists.
  await clearSetupReminder(targetUserId);

  try {
    await audit(actor.user_id, 'contribution_rate_set', 'user', targetUserId,
      { amount: rateAmount, effective_month: effective, source: rateSource });
  } catch { /* audit is best-effort */ }

  // If an admin changed someone else's rate, tell the member.
  if (Number(actor.user_id) !== Number(targetUserId)) {
    try {
      await notify(targetUserId, 'Monthly contribution updated',
        `Your monthly contribution is now ৳${rateAmount} from ${monthLabel(effective)}.`,
        NOTIFICATION_TYPES.CONTRIBUTION_UPDATED,
        { entityType: 'contribution', entityId: targetUserId, actorId: actor.user_id });
    } catch { /* best-effort */ }
  }

  const [rate] = await query(`SELECT * FROM member_monthly_rates WHERE rate_id = ?`, [rateId]);
  return { rate, unchanged: false };
}

/** Remove the pending "set up your contribution" reminder once configured. */
export async function clearSetupReminder(userId) {
  try {
    await query(
      `UPDATE notifications SET is_read = 1, read_at = NOW()
        WHERE recipient_id = ? AND type = 'contribution_setup' AND is_read = 0`,
      [userId]
    );
  } catch { /* best-effort */ }
}

/** ADMIN/AUTHORITY: set an explicit contribution-start month for a member. */
export async function setContributionStart(actor, targetUserId, startMonth) {
  const key = String(startMonth || '').trim();
  if (!isValidMonthKey(key)) throw badRequest('contribution_start_month must be a valid YYYY-MM month');
  if (monthIdx(key) > monthIdx(currentYM())) throw badRequest('The contribution start month cannot be in the future');

  const member = await queryOne(`SELECT user_id, first_name, last_name FROM users WHERE user_id = ? LIMIT 1`, [targetUserId]);
  if (!member) throw notFound('Member not found');

  const [earliest] = await query(
    `SELECT MIN(payment_month) AS earliest FROM monthly_payment_details WHERE user_id = ?`, [targetUserId]
  );
  if (earliest?.earliest && monthIdx(key) < monthIdx(earliest.earliest)) {
    throw badRequest(`Cannot start before ${monthLabel(earliest.earliest)} — that member already has an approved payment for that month.`);
  }

  await query(`UPDATE profiles SET contribution_start_month = ? WHERE user_id = ?`, [key, targetUserId]);
  try {
    await audit(actor.user_id, 'contribution_start_set', 'user', targetUserId, { contribution_start_month: key });
  } catch { /* best-effort */ }
  return { user_id: Number(targetUserId), contribution_start_month: key };
}

/* ------------------------------------------------------------------ */
/* Member-wise report (ADMIN/AUTHORITY) — batched, no N+1              */
/* ------------------------------------------------------------------ */

export async function getMembersDueReport({ search = null, limit = 50, offset = 0 } = {}) {
  const lim = Math.min(Number(limit) || 50, 1000);
  const off = Math.max(Number(offset) || 0, 0);
  const where = [`u.status = 'approved'`, 'u.is_active = 1'];
  const params = [];
  if (search) {
    where.push('(u.first_name LIKE ? OR u.last_name LIKE ? OR u.registration_number LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const members = await query(
    `SELECT u.user_id, u.first_name, u.last_name, u.registration_number, p.ssc_batch, p.contribution_start_month
       FROM users u LEFT JOIN profiles p ON p.user_id = u.user_id
       ${whereSql}
      ORDER BY u.first_name, u.last_name LIMIT ${lim} OFFSET ${off}`, params);
  const [countRow] = await query(`SELECT COUNT(*) AS n FROM users u ${whereSql}`, params);
  if (!members.length) return { members: [], total: Number(countRow.n), limit: lim, offset: off };

  const ids = members.map((m) => m.user_id);
  const placeholders = ids.map(() => '?').join(',');
  const [rates, paidRows, pendingRows, paymentTotals] = await Promise.all([
    query(`SELECT user_id, amount, effective_month, source, created_at FROM member_monthly_rates
            WHERE user_id IN (${placeholders}) ORDER BY effective_month, rate_id`, ids),
    query(`SELECT user_id, payment_month, SUM(amount) AS amount, SUM(extra_amount) AS extra_amount, MIN(created_at) AS created_at
            FROM monthly_payment_details WHERE user_id IN (${placeholders}) GROUP BY user_id, payment_month ORDER BY payment_month`, ids),
    query(`SELECT user_id, billing_month, amount FROM payments
            WHERE user_id IN (${placeholders}) AND payment_type='monthly' AND status='pending' AND billing_month IS NOT NULL`, ids),
    query(`SELECT user_id,
                  COALESCE(SUM(CASE WHEN payment_type='monthly' THEN amount END),0) AS monthly_total,
                  COALESCE(SUM(CASE WHEN payment_type='occasional' THEN amount END),0) AS occasional_total
             FROM payments WHERE user_id IN (${placeholders}) AND status='success' GROUP BY user_id`, ids),
  ]);

  const groupByUser = (rows) => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.user_id)) map.set(r.user_id, []);
      map.get(r.user_id).push(r);
    }
    return map;
  };
  const ratesBy = groupByUser(rates), paidBy = groupByUser(paidRows), pendingBy = groupByUser(pendingRows);
  const totalsBy = new Map(paymentTotals.map((r) => [r.user_id, r]));
  const cur = currentYM();

  // Cross-member monthly aggregation for the analytics trend charts.
  const byMonth = new Map(); // month -> { month, due_amount, due_months, rate_not_set_months }
  const acc = (month, key, delta) => {
    if (!byMonth.has(month)) byMonth.set(month, { month, due_amount: 0, due_months: 0, rate_not_set_months: 0 });
    const cell = byMonth.get(month);
    cell[key] += delta;
  };

  const report = members.map((m) => {
    const mRates = ratesBy.get(m.user_id) || [];
    const mPaidList = paidBy.get(m.user_id) || [];
    const mPendingList = pendingBy.get(m.user_id) || [];
    const start = resolveContributionStart({
      explicitStart: m.contribution_start_month,
      earliestPaidMonth: mPaidList[0]?.payment_month,
      firstRateMonth: mRates[0]?.effective_month,
    });
    const fromKey = start.month && monthIdx(start.month) > monthIdx(shiftMonth(cur, -11))
      ? start.month : shiftMonth(cur, -11);
    const ledger = buildLedger({
      start,
      rates: mRates,
      paid: new Map(mPaidList.map((r) => [r.payment_month, r])),
      pending: new Map(mPendingList.map((r) => [r.billing_month, r])),
      fromKey,
      toKey: cur,
    });
    const currentRate = rateForMonth(mRates, cur);
    const summary = summarizeLedger(ledger, { start, currentRate });
    for (const row of ledger) {
      if (row.status === 'due' || row.status === 'partial') {
        acc(row.month, 'due_amount', Number(row.remaining || 0));
        acc(row.month, 'due_months', 1);
      } else if (row.status === 'rate_not_set') {
        acc(row.month, 'rate_not_set_months', 1);
      }
    }
    const totals = totalsBy.get(m.user_id) || { monthly_total: 0, occasional_total: 0 };
    return {
      user_id: m.user_id,
      name: `${m.first_name} ${m.last_name}`,
      registration_number: m.registration_number,
      ssc_batch: m.ssc_batch ?? null,
      current_rate: summary.current_rate,
      current_rate_effective_month: summary.current_rate_effective_month,
      approved_monthly_total: round2(totals.monthly_total),
      approved_occasional_total: round2(totals.occasional_total),
      ...summary,
    };
  });

  return {
    members: report,
    total: Number(countRow.n),
    limit: lim,
    offset: off,
    totals: {
      by_month: [...byMonth.values()].sort((a, b) => monthIdx(a.month) - monthIdx(b.month)),
    },
  };
}
