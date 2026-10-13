import { query, queryOne, withTransaction } from '../db/pool.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { getProvider, listProviderInfo, MANUAL_PROVIDERS, PAYMENT_PROVIDERS } from './paymentProvider.js';
import { notify, notifyModerators, NOTIFICATION_TYPES } from './notificationService.js';
// ONE authoritative contribution/due service — the payment page, profile,
// admin summary and Analytics all agree because they all call it.
import { MONTHLY_AMOUNTS, getMemberLedger, getMemberRates, rateForMonth, planAllocation, getPayableOutstanding } from './contributionService.js';

export { listProviderInfo };
export { MONTHLY_AMOUNTS };
export const MONTHLY_MAX = 100;
const round2 = (n) => Math.round(Number(n) * 100) / 100;
export const OCCASIONAL_MAX = 1000000;
export const PURPOSES = ['event_contribution', 'donation', 'help_fund', 'emergency_fund', 'other'];

const pad = (n) => String(n).padStart(2, '0');

/** Current year/month from the SERVER clock (never the browser's). */
export function currentYM() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

const toKey = (year, month) => `${year}-${pad(month)}`;
const fromKey = (key) => {
  const [y, m] = String(key).split('-').map(Number);
  return { year: y, month: m };
};
/** Absolute month index; a difference of N means N months apart. */
const monthIndex = ({ year, month }) => year * 12 + (month - 1);
const shiftKey = (key, delta) => {
  const { year, month } = fromKey(key);
  const abs = monthIndex({ year, month }) + delta;
  return toKey(Math.floor(abs / 12), (abs % 12) + 1);
};

/** Member lookup by the unique registration number — approved members only. */
export async function findMemberByRegNumber(regNumber) {
  const reg = String(regNumber || '').trim();
  if (!reg) throw badRequest('Registration number is required');
  const member = await queryOne(
    `SELECT u.user_id, u.first_name, u.last_name, u.registration_number, u.phone, u.status,
            p.ssc_batch
       FROM users u LEFT JOIN profiles p ON p.user_id = u.user_id
      WHERE u.registration_number = ? AND u.status = 'approved' LIMIT 1`,
    [reg]
  );
  if (!member) throw notFound('Invalid registration number. Please check your registration number.');
  return member;
}

/**
 * Monthly status from January of the current year through the CURRENT month
 * (server clock). Future months are never listed as due. Paid = a row in
 * monthly_payment_details — the database is the single source of truth.
 */
/**
 * Monthly status for the PAYMENT UI and the admin summary. Delegates entirely
 * to the authoritative contribution service so every screen agrees.
 *
 * Payable phase stays January → current month of the CURRENT year (existing
 * business rule). Months before the member's obligation start come back
 * flagged `not_obligated`; obligated months with no configured rate are
 * flagged `rate_not_set` instead of being assigned an invented price.
 * Pending payments still never look paid.
 */
export async function getMonthlyStatus(userId) {
  const ledger = await getMemberLedger(userId);
  const now = currentYM();
  const phaseStart = toKey(now.year, 1);
  const currentKey = toKey(now.year, now.month);

  const phase = ledger.months.filter(
    (m) => monthIndex(fromKey(m.month)) >= monthIndex(fromKey(phaseStart)) && monthIndex(fromKey(m.month)) <= monthIndex(fromKey(currentKey))
  );
  const months = phase.map((m) => ({
    month: m.month,
    amount: m.status === 'paid' || m.status === 'partial' ? m.allocated : null, // amount that covered the month
    paid: m.status === 'paid' || m.status === 'partial',
    pending: m.status === 'pending', // awaiting verification — not paid
    rate: m.rate,
    required: m.required,
    remaining: m.remaining,
    extra: m.extra,
    status: m.status,
    not_obligated: m.status === 'not_obligated',
    rate_not_set: m.status === 'rate_not_set',
    flags: m.flags,
  }));

  const due = months.filter((m) => m.status === 'due' || m.status === 'partial');
  const unknown = months.filter((m) => m.status === 'rate_not_set');
  const outstanding = due.reduce((a, m) => a + Number(m.remaining || 0), 0);

  return {
    year: now.year,
    months,
    due_months: due.length,
    // Unknown prices are reported as null — never a misleading ৳0.
    due_amount: due.length ? (unknown.length ? null : Math.round(outstanding * 100) / 100) : 0,
    paid_months: months.filter((m) => m.paid).map((m) => m.month),
    current_rate: ledger.summary.current_rate,
    current_rate_effective_month: ledger.summary.current_rate_effective_month,
    configured: ledger.history.length > 0,
    start: ledger.start,
    start_unknown: ledger.summary.start_unknown,
    rate_not_set_months: unknown.map((m) => m.month),
    not_obligated_months: months.filter((m) => m.not_obligated).map((m) => m.month),
    // Confirmed outstanding across the whole obligation (not only this phase).
    outstanding_due: ledger.summary.total_due,
  };
}

/** Duplicate guard + sanity check for the months a member is about to pay. */
async function assertMonthsPayable(userId, monthKeys) {
  const now = currentYM();
  const currentKey = toKey(now.year, now.month);
  const currentIndex = monthIndex(now);
  for (const key of monthKeys) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) throw badRequest(`Invalid month format: ${key}`);
    const { year, month } = fromKey(key);
    if (year !== now.year) {
      throw badRequest('Monthly contributions for this phase cover the current year only');
    }
    if (monthIndex({ year, month }) > currentIndex) {
      throw badRequest(`Future months cannot be paid (${key})`);
    }
    if (monthIndex({ year, month }) < monthIndex({ year: now.year, month: 1 })) {
      throw badRequest(`Months before January ${now.year} cannot be paid in this phase (${key})`);
    }
  }
  const placeholders = monthKeys.map(() => '?').join(',');
  // A month with a PENDING payment can never be declared again…
  const pendingDecl = await query(
    `SELECT billing_month FROM payments
      WHERE user_id = ? AND payment_type = 'monthly' AND status = 'pending'
        AND billing_month IN (${placeholders})`,
    [userId, ...monthKeys]
  );
  if (pendingDecl.length) throw conflict(`Awaiting verification: ${pendingDecl.map((r) => r.billing_month).join(', ')}`);

  // …and a month that is FULLY settled cannot be declared again. A partially
  // settled month IS payable again: the next payment tops it up (oldest first).
  const allocRows = await query(
    `SELECT payment_month, SUM(amount) AS amount, SUM(extra_amount) AS extra_amount
       FROM monthly_payment_details
      WHERE user_id = ? AND payment_month IN (${placeholders})
      GROUP BY payment_month`,
    [userId, ...monthKeys]
  );
  const rates = await getMemberRates(userId);
  const settled = [];
  for (const row of allocRows) {
    const allocated = Number(row.amount) - Number(row.extra_amount || 0);
    const rate = rateForMonth(rates, row.payment_month);
    // Without a rate there is nothing to compare against: any approved payment
    // settles that month (legacy behaviour — no invented price).
    const isSettled = rate ? allocated >= Number(rate.amount) : true;
    if (isSettled) settled.push(row.payment_month);
  }
  if (settled.length) throw conflict(`Already paid: ${settled.join(', ')}`);
}

/**
 * Record a TEST payment after the user explicitly confirms it.
 * Everything is re-validated server-side, the provider charges, then one
 * transaction writes the payment + per-month rows (all-or-nothing).
 */
export async function createTestPayment(actor, data) {
  const reg = String(data.registration_number || '').trim();
  if (!reg) throw badRequest('Registration number is required');

  // Ownership rule: members pay for themselves; admins/authority may pay for others.
  const isStaff = actor.role_name === 'ADMIN' || actor.role_name === 'AUTHORITY';
  const member = await findMemberByRegNumber(reg);
  if (!isStaff && Number(member.user_id) !== Number(actor.user_id)) {
    throw badRequest('You can only make payments for your own registration number');
  }

  const senderNumber = String(data.sender_number || '').trim();
  if (!/^01[3-9]\d{8}$/.test(senderNumber)) {
    throw badRequest('Sender number must be a valid Bangladeshi mobile number (e.g. 01712345678)');
  }

  const nowDate = new Date(); // server clock for the receipt reference (TEST-YYYYMMDD-…)
  const txnId = `TEST-${nowDate.getFullYear()}${pad(nowDate.getMonth() + 1)}${pad(nowDate.getDate())}-${member.user_id}-${Date.now().toString(36).toUpperCase()}`;

  let paymentId;
  if (data.payment_type === 'monthly') {
    const perMonth = Number(data.amount);
    if (!MONTHLY_AMOUNTS.includes(perMonth)) {
      throw badRequest(`Monthly contribution must be one of: ${MONTHLY_AMOUNTS.join(', ')} (max ৳${MONTHLY_MAX})`);
    }
    const monthKeys = Array.isArray(data.months) ? [...new Set(data.months.map((m) => String(m).trim()))] : [];
    if (!monthKeys.length) throw badRequest('Select at least one due month to pay');
    await assertMonthsPayable(member.user_id, monthKeys);

    // Allocation policy (documented): received money settles CONFIRMED
    // outstanding dues starting from the OLDEST unpaid month; only the remainder
    // becomes an EXTRA contribution. Members with no configured rate keep the
    // simple per-month allocation (there is nothing to compare against, and no
    // price is ever invented for them).
    const total = round2(perMonth * monthKeys.length);
    const ratesForMember = await getMemberRates(member.user_id);
    let plan;
    if (ratesForMember.length) {
      const outstanding = await getPayableOutstanding(member.user_id);
      plan = planAllocation(outstanding, total);
      if (!plan.allocations.some((a) => a.month)) {
        throw badRequest('All your outstanding dues are already covered — use an Occasional payment (donation / extra contribution) instead.');
      }
    } else {
      plan = { allocations: monthKeys.map((key) => ({ month: key, amount: perMonth, extra: 0 })), extra: 0, settled_amount: total };
    }

    await getProvider('test').charge({ amount: total, senderNumber });

    paymentId = await withTransaction(async (conn) => {
      const [res] = await conn.query(
        `INSERT INTO payments (user_id, reg_number, payment_type, amount, payment_method, sender_number, transaction_id, status)
         VALUES (?, ?, 'monthly', ?, 'test', ?, ?, 'success')
         RETURNING payment_id`,
        [member.user_id, member.registration_number, total, senderNumber, txnId]
      );
      for (const a of plan.allocations) {
        await conn.query(
          `INSERT INTO monthly_payment_details (payment_id, user_id, payment_month, amount, extra_amount)
           VALUES (?, ?, ?, ?, ?)`,
          [res.insertId, member.user_id, a.month, a.amount, a.extra]
        );
      }
      return res.insertId;
    });
  } else if (data.payment_type === 'occasional') {
    const purpose = String(data.purpose || '').trim();
    if (!PURPOSES.includes(purpose)) {
      throw badRequest(`Purpose must be one of: ${PURPOSES.join(', ')}`);
    }
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw badRequest('Amount must be a positive number');
    if (amount > OCCASIONAL_MAX) throw badRequest(`Amount cannot exceed ৳${OCCASIONAL_MAX.toLocaleString('en-US')}`);
    if (purpose === 'event_contribution' && data.event_id) {
      const event = await queryOne(`SELECT event_id, title FROM events WHERE event_id = ? AND status = 'published' LIMIT 1`, [Number(data.event_id)]);
      if (!event) throw badRequest('Selected event not found or not published');
    }

    await getProvider('test').charge({ amount, senderNumber });

    paymentId = await withTransaction(async (conn) => {
      const [res] = await conn.query(
        `INSERT INTO payments (user_id, reg_number, payment_type, purpose, event_id, amount, payment_method, sender_number, transaction_id, status, description)
         VALUES (?, ?, 'occasional', ?, ?, ?, 'test', ?, ?, 'success', ?)
         RETURNING payment_id`,
        [
          member.user_id, member.registration_number, purpose,
          purpose === 'event_contribution' && data.event_id ? Number(data.event_id) : null,
          amount, senderNumber, txnId,
          String(data.description || '').trim().slice(0, 255) || null,
        ]
      );
      return res.insertId;
    });
  } else {
    throw badRequest('payment_type must be monthly or occasional');
  }

  return getPayment(paymentId);
}

const PAYMENT_SELECT = `
  SELECT pay.payment_id, pay.reg_number, pay.payment_type, pay.purpose, pay.event_id,
         e.title AS event_title, pay.amount, pay.payment_method, pay.sender_number,
         pay.transaction_id, pay.payment_date, pay.billing_month, pay.screenshot_path,
         pay.status, pay.description, pay.review_note, pay.reviewed_by, pay.reviewed_at,
         ru.first_name AS reviewer_first_name, ru.last_name AS reviewer_last_name,
         pay.created_at,
         u.user_id, u.first_name, u.last_name, u.phone, p.ssc_batch
    FROM payments pay
    JOIN users u ON u.user_id = pay.user_id
    LEFT JOIN profiles p ON p.user_id = u.user_id
    LEFT JOIN events e ON e.event_id = pay.event_id
    LEFT JOIN users ru ON ru.user_id = pay.reviewed_by`;

// Manual Transaction IDs: 6–64 chars, letters/numbers/dash/underscore.
// (bKash TrxIDs are ~10 alphanumeric chars; keep the rule permissive but sane.)
const TXN_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

/**
 * Record a MANUAL mobile-money payment (bKash / Nagad / Rocket) as PENDING.
 *
 * The member sends money themselves (using the number + instructions from
 * GET /providers), then submits the Transaction ID + optional screenshot.
 * Nothing is ever confirmed here: the row stays 'pending' until an admin or
 * the authority approves it. The transaction_id column is UNIQUE at the DB
 * level (uq_payments_txn) — the pre-check below only produces a friendlier
 * error; the UNIQUE violation (SQLSTATE 23505) is caught as a concurrency safety net.
 */
export async function submitManualPayment(actor, data, screenshotFile = null) {
  const reg = String(data.registration_number || '').trim();
  if (!reg) throw badRequest('Registration number is required');

  // Ownership rule: members pay for themselves; admins/authority may pay for others.
  const isStaff = actor.role_name === 'ADMIN' || actor.role_name === 'AUTHORITY';
  const member = await findMemberByRegNumber(reg);
  if (!isStaff && Number(member.user_id) !== Number(actor.user_id)) {
    throw badRequest('You can only make payments for your own registration number');
  }

  const providerKey = String(data.payment_method || '').trim();
  const provider = PAYMENT_PROVIDERS[providerKey];
  if (!provider || !provider.manual) {
    throw badRequest(`payment_method must be one of: ${MANUAL_PROVIDERS.join(', ')}`);
  }

  const txnId = String(data.transaction_id || '').trim();
  if (!TXN_ID_RE.test(txnId)) {
    throw badRequest('A valid Transaction ID is required (6–64 letters, numbers, - or _)');
  }

  const dup = await queryOne(`SELECT payment_id FROM payments WHERE transaction_id = ? LIMIT 1`, [txnId]);
  if (dup) throw conflict('This Transaction ID has already been submitted.');

  // Optional sender number (the number the money was sent FROM).
  const senderNumber = String(data.sender_number || '').trim();
  if (senderNumber && !/^01[3-9]\d{8}$/.test(senderNumber)) {
    throw badRequest('Sender number must be a valid Bangladeshi mobile number (e.g. 01712345678)');
  }

  const screenshotPath = screenshotFile ? screenshotFile.filename : null; // multer already validated it
  const description = String(data.description || '').trim().slice(0, 255) || null;

  let paymentId;
  try {
    if (data.payment_type === 'monthly') {
      const perMonth = Number(data.amount);
      if (!MONTHLY_AMOUNTS.includes(perMonth)) {
        throw badRequest(`Monthly contribution must be one of: ${MONTHLY_AMOUNTS.join(', ')} (max ৳${MONTHLY_MAX})`);
      }
      // Manual flow pays ONE billing month+year per submission. It is stored on
      // the payment row (billing_month) — deliberately separate from
      // payment_date. monthly_payment_details rows are written ONLY at approval,
      // so a pending payment can never make a month look paid.
      const billingMonth = String(data.billing_month || '').trim();
      await assertMonthsPayable(member.user_id, [billingMonth]);

      // A month already awaiting verification cannot be submitted again.
      const pendingRow = await queryOne(
        `SELECT payment_id FROM payments
          WHERE user_id = ? AND payment_type = 'monthly' AND status = 'pending' AND billing_month = ? LIMIT 1`,
        [member.user_id, billingMonth]
      );
      if (pendingRow) throw conflict(`A payment for ${billingMonth} is already pending verification`);

      paymentId = await withTransaction(async (conn) => {
        const [res] = await conn.query(
          `INSERT INTO payments (user_id, reg_number, payment_type, amount, payment_method, sender_number, transaction_id, billing_month, screenshot_path, status, description)
           VALUES (?, ?, 'monthly', ?, ?, ?, ?, ?, ?, 'pending', ?)
           RETURNING payment_id`,
          [member.user_id, member.registration_number, perMonth, providerKey, senderNumber || null, txnId, billingMonth, screenshotPath, description]
        );
        return res.insertId;
      });
    } else if (data.payment_type === 'occasional') {
      const purpose = String(data.purpose || '').trim();
      if (!PURPOSES.includes(purpose)) {
        throw badRequest(`Purpose must be one of: ${PURPOSES.join(', ')}`);
      }
      const amount = Number(data.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw badRequest('Amount must be a positive number');
      if (amount > OCCASIONAL_MAX) throw badRequest(`Amount cannot exceed ৳${OCCASIONAL_MAX.toLocaleString('en-US')}`);
      if (purpose === 'event_contribution' && data.event_id) {
        const event = await queryOne(`SELECT event_id, title FROM events WHERE event_id = ? AND status = 'published' LIMIT 1`, [Number(data.event_id)]);
        if (!event) throw badRequest('Selected event not found or not published');
      }

      // Occasional payments never touch monthly_payment_details — they can
      // never affect the monthly Due/Paid calculation.
      paymentId = await withTransaction(async (conn) => {
        const [res] = await conn.query(
          `INSERT INTO payments (user_id, reg_number, payment_type, purpose, event_id, amount, payment_method, sender_number, transaction_id, screenshot_path, status, description)
           VALUES (?, ?, 'occasional', ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
           RETURNING payment_id`,
          [
            member.user_id, member.registration_number, purpose,
            purpose === 'event_contribution' && data.event_id ? Number(data.event_id) : null,
            amount, providerKey, senderNumber || null, txnId, screenshotPath, description,
          ]
        );
        return res.insertId;
      });
    } else {
      throw badRequest('payment_type must be monthly or occasional');
    }
  } catch (err) {
    // Concurrency safety net: two submissions with the same Transaction ID.
    if (err && err.code === '23505') throw conflict('This Transaction ID has already been submitted.');
    throw err;
  }

  // Payment verification is required: alert ADMIN + AUTHORITY (never the
  // submitter themself). Test payments are instant-success and skip this.
  await notifyModerators({
    actorId: actor.user_id,
    type: NOTIFICATION_TYPES.PAYMENT_PENDING,
    title: 'Payment verification required',
    message: `${member.first_name} ${member.last_name} submitted a ${provider.label || providerKey} payment of ৳${Number(data.amount).toLocaleString('en-US')}. Transaction ID: ${txnId}`,
    entityType: 'payment',
    entityId: paymentId,
  });

  return getPayment(paymentId);
}

/**
 * ADMIN/AUTHORITY review of a pending manual payment.
 * Approve (status='success'): for monthly payments the billing month is written
 * to monthly_payment_details in the SAME transaction as the status flip, so the
 * month becomes "paid" exactly once, atomically. Reject: status-only.
 * Both record who reviewed, when, and an optional note.
 */
export async function reviewPayment(actor, paymentId, decision) {
  const status = String(decision?.status || '').trim();
  if (status !== 'success' && status !== 'rejected') {
    throw badRequest('status must be success or rejected');
  }
  const note = String(decision?.note || '').trim().slice(0, 255) || null;

  const payment = await queryOne(`${PAYMENT_SELECT} WHERE pay.payment_id = ? LIMIT 1`, [paymentId]);
  if (!payment) throw notFound('Payment not found');

  await withTransaction(async (conn) => {
    // Lock the payment row for the duration of the review. The status check
    // MUST live inside the lock: two concurrent approvals would both pass an
    // outside-the-transaction check and allocate the money twice. A locking
    // read sees the latest committed status, so the loser rolls back with 409.
    const [lockedRows] = await conn.query(
      'SELECT payment_id, user_id, payment_type, amount, billing_month, status FROM payments WHERE payment_id = ? FOR UPDATE',
      [paymentId]
    );
    const locked = lockedRows?.[0];
    if (!locked) throw notFound('Payment not found');
    if (locked.status !== 'pending') {
      throw conflict(`This payment was already reviewed (status: ${locked.status})`);
    }

    if (status === 'success' && locked.payment_type === 'monthly') {
      // Allocation is recomputed INSIDE the transaction from the CURRENT state:
      // the oldest-first waterfall settles confirmed dues (never twice — the
      // planner caps each month at its remaining requirement) and any remainder
      // is stored as an EXTRA contribution on the declared month.
      const outstanding = await getPayableOutstanding(locked.user_id, conn, { resolvePendingMonth: locked.billing_month });
      const plan = planAllocation(outstanding, Number(locked.amount));
      const rows = plan.allocations.some((a) => a.month)
        ? plan.allocations
        : [{ month: locked.billing_month, amount: Number(locked.amount), extra: Number(locked.amount) }];
      for (const a of rows) {
        await conn.query(
          `INSERT INTO monthly_payment_details (payment_id, user_id, payment_month, amount, extra_amount)
           VALUES (?, ?, ?, ?, ?)`,
          [locked.payment_id, locked.user_id, a.month, a.amount, a.extra]
        );
      }
    }
    await conn.query(
      `UPDATE payments SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE payment_id = ?`,
      [status, note, actor.user_id, locked.payment_id]
    );
  });

  // Best-effort notification to the member (never fails the review itself).
  try {
    if (status === 'success') {
      await notify(payment.user_id, 'Payment approved', `Your ${payment.payment_method} payment of ৳${Number(payment.amount).toLocaleString('en-US')} was approved.`, NOTIFICATION_TYPES.PAYMENT_APPROVED, { entityType: 'payment', entityId: payment.payment_id, actorId: actor.user_id });
    } else {
      await notify(payment.user_id, 'Payment rejected', `Your ${payment.payment_method} payment of ৳${Number(payment.amount).toLocaleString('en-US')} was rejected.${note ? ` Note: ${note}` : ''}`, NOTIFICATION_TYPES.PAYMENT_REJECTED, { entityType: 'payment', entityId: payment.payment_id, actorId: actor.user_id });
    }
  } catch { /* notification is best-effort */ }

  return getPayment(paymentId);
}

/** Full receipt detail incl. covered months for monthly payments. */
export async function getPayment(paymentId) {
  const row = await queryOne(`${PAYMENT_SELECT} WHERE pay.payment_id = ? LIMIT 1`, [paymentId]);
  if (!row) throw notFound('Payment not found');
  if (row.payment_type === 'monthly') {
    row.covered_months = (await query(
      `SELECT payment_month, amount, extra_amount FROM monthly_payment_details WHERE payment_id = ? ORDER BY payment_month`,
      [paymentId]
    )).map((r) => ({ month: r.payment_month, amount: Number(r.amount), extra: Number(r.extra_amount || 0) }));
  }
  return row;
}

/** Member history — caller must already be the member (enforced in controller). */
export async function listMyPayments(userId) {
  const rows = await query(`${PAYMENT_SELECT} WHERE pay.user_id = ? ORDER BY pay.payment_date DESC LIMIT 200`, [userId]);
  const totals = await queryOne(
    `SELECT
       COALESCE(SUM(CASE WHEN payment_type = 'monthly' THEN amount END), 0) AS monthly_total,
       COALESCE(SUM(CASE WHEN payment_type = 'occasional' THEN amount END), 0) AS occasional_total,
       COUNT(*) AS payment_count
       FROM payments WHERE user_id = ? AND status = 'success'`,
    [userId]
  );
  // Extra contributions live INSIDE approved monthly payments (mpd.extra_amount)
  // — the actual money received is preserved, nothing is double-counted.
  const [extraRow] = await query(
    `SELECT COALESCE(SUM(extra_amount), 0) AS extra_total FROM monthly_payment_details WHERE user_id = ?`,
    [userId]
  );
  totals.extra_total = Number(extraRow?.extra_total || 0);
  // Attach covered months for monthly payments (one batch query) so members
  // can see exactly which months each receipt settled — same shape the admin
  // list already exposes.
  const monthlyIds = rows.filter((r) => r.payment_type === 'monthly').map((r) => r.payment_id);
  if (monthlyIds.length) {
    const placeholders = monthlyIds.map(() => '?').join(',');
    const details = await query(
      `SELECT payment_id, payment_month, amount, extra_amount FROM monthly_payment_details
        WHERE payment_id IN (${placeholders}) ORDER BY payment_month`, monthlyIds
    );
    const byPayment = new Map();
    for (const d of details) {
      if (!byPayment.has(d.payment_id)) byPayment.set(d.payment_id, []);
      byPayment.get(d.payment_id).push({ month: d.payment_month, amount: Number(d.amount), extra: Number(d.extra_amount || 0) });
    }
    for (const r of rows) r.covered_months = byPayment.get(r.payment_id) || [];
  }
  return { payments: rows, totals };
}

/** Admin list with search/filters + pagination. */
export async function listAllPayments(filters = {}) {
  const where = [];
  const params = [];
  if (filters.reg) { where.push('pay.reg_number LIKE ?'); params.push(`%${filters.reg}%`); }
  if (filters.name) { where.push('(u.first_name LIKE ? OR u.last_name LIKE ?)'); params.push(`%${filters.name}%`, `%${filters.name}%`); }
  if (filters.batch) { where.push('p.ssc_batch = ?'); params.push(Number(filters.batch)); }
  if (filters.phone) { where.push('(u.phone LIKE ? OR pay.sender_number LIKE ?)'); params.push(`%${filters.phone}%`, `%${filters.phone}%`); }
  if (filters.payment_type) { where.push('pay.payment_type = ?'); params.push(filters.payment_type); }
  if (filters.purpose) { where.push('pay.purpose = ?'); params.push(filters.purpose); }
  if (filters.status) { where.push('pay.status = ?'); params.push(filters.status); }
  if (filters.from) { where.push('pay.payment_date >= ?'); params.push(`${filters.from} 00:00:00`); }
  if (filters.to) { where.push('pay.payment_date <= ?'); params.push(`${filters.to} 23:59:59`); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Number(filters.limit) || 25, 100);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  const rows = await query(
    `${PAYMENT_SELECT} ${whereSql} ORDER BY pay.payment_date DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  // Attach covered months for the monthly payments on this page (single batch query).
  const monthlyIds = rows.filter((r) => r.payment_type === 'monthly').map((r) => r.payment_id);
  if (monthlyIds.length) {
    const placeholders = monthlyIds.map(() => '?').join(',');
    const details = await query(
      `SELECT payment_id, payment_month, amount, extra_amount FROM monthly_payment_details WHERE payment_id IN (${placeholders}) ORDER BY payment_month`,
      monthlyIds
    );
    const byPayment = new Map();
    for (const d of details) {
      if (!byPayment.has(d.payment_id)) byPayment.set(d.payment_id, []);
      byPayment.get(d.payment_id).push({ month: d.payment_month, amount: Number(d.amount), extra: Number(d.extra_amount || 0) });
    }
    for (const r of rows) r.covered_months = byPayment.get(r.payment_id) || [];
  }
  const total = await queryOne(`SELECT COUNT(*) AS n FROM payments pay JOIN users u ON u.user_id = pay.user_id LEFT JOIN profiles p ON p.user_id = u.user_id ${whereSql}`, params);
  return { payments: rows, total: total.n, limit, offset };
}

/** Admin per-member summary: totals + current-year monthly status (DB-derived). */
export async function getMemberPaymentSummary(userId) {
  const member = await queryOne(
    `SELECT u.user_id, u.first_name, u.last_name, u.registration_number, u.phone, p.ssc_batch
       FROM users u LEFT JOIN profiles p ON p.user_id = u.user_id WHERE u.user_id = ? LIMIT 1`,
    [userId]
  );
  if (!member) throw notFound('Member not found');
  const totals = await queryOne(
    `SELECT
       COALESCE(SUM(CASE WHEN payment_type = 'monthly' THEN amount END), 0) AS monthly_total,
       COALESCE(SUM(CASE WHEN payment_type = 'occasional' THEN amount END), 0) AS occasional_total
       FROM payments WHERE user_id = ? AND status = 'success'`,
    [userId]
  );
  const monthly = await getMonthlyStatus(userId);
  return {
    member,
    monthly_total: Number(totals.monthly_total),
    occasional_total: Number(totals.occasional_total),
    total_contributions: Number(totals.monthly_total) + Number(totals.occasional_total),
    monthly,
  };
}
