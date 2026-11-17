import fs from 'node:fs';
import path from 'node:path';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { uploadDir } from '../config/env.js';
import { notify, notifyCommunity, NOTIFICATION_TYPES } from './notificationService.js';

/**
 * Event lifecycle rules (single source of truth for the backend).
 *
 * EVENT START: event_date + start_time are Asia/Dhaka wall-clock values. When
 * start_time is NULL the event is treated as starting at 00:00 Asia/Dhaka on
 * event_date (the day-boundary convention — an all-day event starts that day).
 * All deadline / 10-day calculations compare timezone-aware timestamps.
 */
// date + time builds the naive Dhaka wall-clock timestamp; AT TIME ZONE then
// interprets it as Asia/Dhaka and yields the correct timestamptz.
const EVENT_WALLCLOCK = `(e.event_date::date + COALESCE(e.start_time, TIME '00:00'))`;
const EVENT_START = `(${EVENT_WALLCLOCK} AT TIME ZONE 'Asia/Dhaka')`;
const EVENT_START_ALIAS = EVENT_START;
const EVENT_START_DISPLAY = `to_char(${EVENT_WALLCLOCK}, 'YYYY-MM-DD HH24:MI')`;
const DEADLINE_DISPLAY = `to_char(er.payment_deadline AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD HH24:MI')`;

export const INELIGIBLE_MESSAGE = 'This event is exclusively available to selected SSC batches.';
export const ATTEMPT_LIMIT_MESSAGE = 'You have reached the maximum number of unpaid registration attempts for this event. Further registration is not allowed.';
export const CANCEL_WINDOW_MESSAGE = 'Registration can no longer be cancelled: the event starts in 10 days or less.';
export const MAX_UNPAID_ATTEMPTS = 3;
export const TSHIRT_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
const CANCEL_WINDOW = `INTERVAL '10 days'`;
export const CANCEL_REASONS = {
  MEMBER: 'Cancelled by member',
  ADMIN: 'Cancelled by admin',
  EXPIRED: 'Payment Deadline Expired',
  EVENT_CANCELLED: 'Event cancelled',
};

const isAdmin = (user) => user && (user.role_name === 'ADMIN' || user.role_name === 'AUTHORITY');
const money = (v) => (v === null || v === undefined ? null : Number(v));

function normalizeBatches(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  return [...new Set(value.map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
}

const APPROVED_SUM = `(SELECT COALESCE(SUM(pay.amount), 0) FROM payments pay
                        WHERE pay.registration_id = er.registration_id AND pay.status = 'success')`;

const ATTEMPTS_SUBQUERY = `(SELECT COUNT(*) FROM event_registrations att
                             WHERE att.event_id = er.event_id AND att.user_id = er.user_id
                               AND att.cancel_reason = '${CANCEL_REASONS.EXPIRED}')`;

function shapeRegistration(r) {
  const fee = money(r.registration_fee_snapshot ?? r.registration_fee);
  const approved = money(r.approved_amount) ?? 0;
  return {
    ...r,
    registration_fee: fee,
    registration_fee_snapshot: fee,
    approved_amount: approved,
    remaining_amount: fee === null ? 0 : Math.max(0, Math.round((fee - approved) * 100) / 100),
    unpaid_expiry_attempts: Number(r.unpaid_expiry_attempts ?? 0),
  };
}

/** Member's SSC batch straight from the DB — never from the request. */
async function memberBatch(conn, userId) {
  const [rows] = await conn.query(`SELECT ssc_batch FROM profiles WHERE user_id = ? LIMIT 1`, [userId]);
  return rows[0] ? rows[0].ssc_batch : null;
}

function batchAllowed(eligibleBatches, batch) {
  if (!Array.isArray(eligibleBatches) || eligibleBatches.length === 0) return true; // NULL = All Batches
  if (batch === null || batch === undefined) return false;
  return eligibleBatches.map(Number).includes(Number(batch));
}

export async function listEvents(user) {
  const admin = isAdmin(user);
  const where = [];
  if (!admin) where.push(`e.status = 'published' AND e.archived_at IS NULL`);
  const rows = await query(
    `SELECT e.*, u.first_name, u.last_name,
            ${EVENT_START_ALIAS} AS event_start,
            ${EVENT_START_DISPLAY} AS event_start_display,
            (${EVENT_START_ALIAS} <= NOW()) AS event_started,
            (SELECT COUNT(*) FROM event_registrations er
              WHERE er.event_id = e.event_id AND er.status = 'active') AS registration_count
       FROM events e JOIN users u ON u.user_id = e.created_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY e.event_date DESC LIMIT 200`,
    []
  );

  const shaped = rows.map((e) => ({
    ...e,
    registration_fee: money(e.registration_fee),
    eligible_batches: Array.isArray(e.eligible_batches) ? e.eligible_batches : null,
  }));

  if (!user) return shaped;

  const [batchRow] = await query(`SELECT ssc_batch FROM profiles WHERE user_id = ? LIMIT 1`, [user.user_id]);
  const myBatch = batchRow ? batchRow.ssc_batch : null;

  const mine = await query(
    `SELECT er.*, ${DEADLINE_DISPLAY} AS payment_deadline_display,
            ${APPROVED_SUM} AS approved_amount,
            (${EVENT_START} - NOW() > ${CANCEL_WINDOW}) AS within_cancel_window
       FROM event_registrations er JOIN events e ON e.event_id = er.event_id
      WHERE er.user_id = ? AND er.status = 'active'`,
    [user.user_id]
  );
  const mineByEvent = new Map(mine.map((r) => [Number(r.event_id), {
    ...shapeRegistration(r),
    can_cancel: Boolean(r.within_cancel_window),
    cancel_block_reason: r.within_cancel_window ? null : CANCEL_WINDOW_MESSAGE,
  }]));

  const attemptRows = await query(
    `SELECT event_id, COUNT(*) AS attempts FROM event_registrations
      WHERE user_id = ? AND cancel_reason = ? GROUP BY event_id`,
    [user.user_id, CANCEL_REASONS.EXPIRED]
  );
  const attemptsByEvent = new Map(attemptRows.map((r) => [Number(r.event_id), Number(r.attempts)]));

  return shaped.map((e) => {
    const reg = mineByEvent.get(Number(e.event_id)) || null;
    const attempts = attemptsByEvent.get(Number(e.event_id)) || 0;
    const eligible = batchAllowed(e.eligible_batches, myBatch);
    const full = Number(e.registration_count) >= Number(e.capacity);
    let canRegister = true;
    let reason = null;
    if (e.status !== 'published' || e.archived_at) { canRegister = false; reason = 'This event is not open for registration.'; }
    else if (e.event_started) { canRegister = false; reason = 'This event has already started.'; }
    else if (!eligible) { canRegister = false; reason = INELIGIBLE_MESSAGE; }
    else if (reg) { canRegister = false; reason = 'You are already registered for this event.'; }
    else if (attempts >= MAX_UNPAID_ATTEMPTS) { canRegister = false; reason = ATTEMPT_LIMIT_MESSAGE; }
    else if (full) { canRegister = false; reason = 'Event is full'; }
    return {
      ...e,
      my_batch: myBatch,
      eligible,
      can_register: canRegister,
      eligibility_reason: reason,
      unpaid_expiry_attempts: attempts,
      my_registration: reg,
    };
  });
}

export async function getEvent(eventId, user = null) {
  const ev = await queryOne(
    `SELECT e.*, u.first_name, u.last_name,
            ${EVENT_START_ALIAS} AS event_start,
            ${EVENT_START_DISPLAY} AS event_start_display,
            (${EVENT_START_ALIAS} <= NOW()) AS event_started,
            (SELECT COUNT(*) FROM event_registrations er
              WHERE er.event_id = e.event_id AND er.status = 'active') AS registration_count
       FROM events e JOIN users u ON u.user_id = e.created_by WHERE e.event_id = ? LIMIT 1`,
    [eventId]
  );
  if (!ev) throw notFound('Event not found');
  ev.registration_fee = money(ev.registration_fee);
  ev.eligible_batches = Array.isArray(ev.eligible_batches) ? ev.eligible_batches : null;

  if (!user) return ev;
  const [batchRow] = await query(`SELECT ssc_batch FROM profiles WHERE user_id = ? LIMIT 1`, [user.user_id]);
  const myBatch = batchRow ? batchRow.ssc_batch : null;
  const eligible = batchAllowed(ev.eligible_batches, myBatch);

  const reg = await queryOne(
    `SELECT er.*, ${DEADLINE_DISPLAY} AS payment_deadline_display,
            ${APPROVED_SUM} AS approved_amount,
            ${ATTEMPTS_SUBQUERY} AS unpaid_expiry_attempts,
            (${EVENT_START} - NOW() > ${CANCEL_WINDOW}) AS within_cancel_window
       FROM event_registrations er JOIN events e ON e.event_id = er.event_id
      WHERE er.user_id = ? AND er.event_id = ? AND er.status = 'active' LIMIT 1`,
    [user.user_id, eventId]
  );
  const myRegistration = reg
    ? { ...shapeRegistration(reg), can_cancel: Boolean(reg.within_cancel_window), cancel_block_reason: reg.within_cancel_window ? null : CANCEL_WINDOW_MESSAGE }
    : null;

  const attemptsRow = await queryOne(
    `SELECT COUNT(*) AS n FROM event_registrations
      WHERE event_id = ? AND user_id = ? AND cancel_reason = ?`,
    [eventId, user.user_id, CANCEL_REASONS.EXPIRED]
  );
  const attempts = Number(attemptsRow?.n || 0);

  let canRegister = true;
  let reason = null;
  if (ev.status !== 'published' || ev.archived_at) { canRegister = false; reason = 'This event is not open for registration.'; }
  else if (ev.event_started) { canRegister = false; reason = 'This event has already started.'; }
  else if (!eligible) { canRegister = false; reason = INELIGIBLE_MESSAGE; }
  else if (myRegistration) { canRegister = false; reason = 'You are already registered for this event.'; }
  else if (attempts >= MAX_UNPAID_ATTEMPTS) { canRegister = false; reason = ATTEMPT_LIMIT_MESSAGE; }
  else if (Number(ev.registration_count) >= Number(ev.capacity)) { canRegister = false; reason = 'Event is full'; }

  return {
    ...ev,
    my_batch: myBatch,
    eligible,
    can_register: canRegister,
    eligibility_reason: reason,
    unpaid_expiry_attempts: attempts,
    my_registration: myRegistration,
  };
}

export async function createEvent(user, data) {
  const fee = data.registration_fee ?? null;
  if (fee !== null && !(Number(fee) > 0)) throw badRequest('Registration fee must be greater than 0, or leave it empty for a free event');
  const batches = normalizeBatches(data.eligible_batches);
  const tshirt = data.tshirt_included === true; // absent = false
  const res = await query(
    `INSERT INTO events (created_by, title, description, location, event_date, start_time, end_time, capacity, image, status, registration_fee, eligible_batches, tshirt_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)
     RETURNING event_id`,
    [user.user_id, data.title, data.description || null, data.location || null, data.event_date,
      data.start_time || null, data.end_time || null, data.capacity, data.image || null,
      fee, batches, tshirt]
  );
  await notifyCommunity({
    actorId: user.user_id,
    type: NOTIFICATION_TYPES.NEW_EVENT,
    title: 'New event announced',
    message: `A new alumni event has been announced: "${data.title}" on ${data.event_date}.`,
    entityType: 'event',
    entityId: res.insertId,
  });
  return { event_id: res.insertId, status: 'published', registration_fee: fee === null ? null : Number(fee), eligible_batches: batches, tshirt_included: tshirt };
}

/**
 * ADMIN/AUTHORITY: hard-delete ONLY an event without any lifecycle history.
 * An event with registrations or payment records must be cancelled/archived
 * instead so history is never destroyed.
 */
export async function deleteEvent(eventId) {
  const row = await queryOne(`SELECT event_id, title, image FROM events WHERE event_id = ? LIMIT 1`, [eventId]);
  if (!row) throw notFound('Event not found');
  const counts = await queryOne(
    `SELECT
       (SELECT COUNT(*) FROM event_registrations WHERE event_id = ?) AS registrations,
       (SELECT COUNT(*) FROM payments WHERE event_id = ?
          OR registration_id IN (SELECT registration_id FROM event_registrations WHERE event_id = ?)) AS payments`,
    [eventId, eventId, eventId]
  );
  if (Number(counts.registrations) > 0 || Number(counts.payments) > 0) {
    throw conflict('This event has registration or payment history and cannot be deleted. Cancel or archive it instead.');
  }
  await query(`DELETE FROM events WHERE event_id = ?`, [eventId]);
  try {
    await query(`DELETE FROM notifications WHERE related_entity_type = 'event' AND related_entity_id = ?`, [eventId]);
  } catch { /* best-effort */ }
  if (row.image) {
    try { fs.unlinkSync(path.join(uploadDir, row.image)); } catch { /* file may already be gone */ }
  }
  return { event_id: eventId, deleted: true };
}

export async function updateEvent(user, eventId, data) {
  const ev = await queryOne('SELECT created_by, tshirt_included FROM events WHERE event_id = ? LIMIT 1', [eventId]);
  if (!ev) throw notFound('Event not found');
  if (ev.created_by !== user.user_id && !isAdmin(user)) {
    throw forbidden('You can only edit your own events');
  }
  const fee = data.registration_fee ?? null;
  if (fee !== null && !(Number(fee) > 0)) throw badRequest('Registration fee must be greater than 0, or leave it empty for a free event');
  const batches = normalizeBatches(data.eligible_batches);
  const sets = [
    'title = ?', 'description = ?', 'location = ?', 'event_date = ?', 'start_time = ?', 'end_time = ?',
    'capacity = ?', 'status = ?', 'registration_fee = ?', 'eligible_batches = ?',
  ];
  const params = [data.title, data.description || null, data.location || null, data.event_date,
    data.start_time || null, data.end_time || null, data.capacity, data.status || 'published', fee, batches];
  // Only touch the T-shirt flag when the caller sent it — older clients that
  // omit the field must never silently disable a configured event.
  if (data.tshirt_included !== undefined) {
    sets.push('tshirt_included = ?');
    params.push(data.tshirt_included === true);
  }
  await query(`UPDATE events SET ${sets.join(', ')} WHERE event_id = ?`, [...params, eventId]);
  // Existing registrations keep their registration_fee_snapshot — changing the
  // event fee affects NEW registrations only. Saved T-shirt sizes are never
  // erased by disabling the flag.
  return {
    event_id: eventId,
    registration_fee: fee === null ? null : Number(fee),
    eligible_batches: batches,
    tshirt_included: data.tshirt_included === undefined ? Boolean(ev.tshirt_included) : data.tshirt_included === true,
  };
}

export async function cancelEvent(user, eventId) {
  const ev = await queryOne('SELECT created_by FROM events WHERE event_id = ? LIMIT 1', [eventId]);
  if (!ev) throw notFound('Event not found');
  if (ev.created_by !== user.user_id && !isAdmin(user)) {
    throw forbidden('You can only cancel your own events');
  }
  // One transaction: the event and every ACTIVE registration flip together, so
  // a cancelled event can never leave registrations that look active (or let
  // the expiry scheduler mislabel them as "Payment Deadline Expired").
  // Payment rows are untouched; any money already received stays for manual
  // reconciliation, exactly like a member/admin cancellation.
  const result = await withTransaction(async (conn) => {
    await conn.query(`UPDATE events SET status = 'cancelled' WHERE event_id = ?`, [eventId]);
    const [cancelled] = await conn.query(
      `UPDATE event_registrations
          SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = ?, cancel_reason = ?
        WHERE event_id = ? AND status = 'active'`,
      [user.user_id, CANCEL_REASONS.EVENT_CANCELLED, eventId]
    );
    return { cancelled_registrations: cancelled.affectedRows ?? 0 };
  });
  return { event_id: eventId, status: 'cancelled', ...result };
}

/** ADMIN/AUTHORITY: archive an event. History stays fully queryable. */
export async function archiveEvent(user, eventId) {
  const ev = await queryOne('SELECT event_id, archived_at FROM events WHERE event_id = ? LIMIT 1', [eventId]);
  if (!ev) throw notFound('Event not found');
  if (ev.archived_at) return { event_id: eventId, archived: true, archived_at: ev.archived_at };
  const res = await query(
    `UPDATE events SET archived_at = NOW(), archived_by = ? WHERE event_id = ? RETURNING archived_at`,
    [user.user_id, eventId]
  );
  return { event_id: eventId, archived: true, archived_at: res.rows?.[0]?.archived_at || null };
}

/**
 * Register for an event — enforces (inside one transaction, event row locked):
 * published + not archived + not started, batch eligibility from the DB,
 * active capacity, the 3 unpaid-expiry attempt limit and active-only uniqueness.
 */
export async function registerForEvent(user, eventId) {
  const result = await withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT event_id, capacity, status, title, archived_at, registration_fee, eligible_batches,
              event_date, start_time,
              ${EVENT_START} AS event_start,
              (${EVENT_START} <= NOW()) AS started
         FROM events e WHERE e.event_id = ? FOR UPDATE`,
      [eventId]
    );
    const ev = rows[0];
    if (!ev) throw notFound('Event not found');
    if (ev.status !== 'published' || ev.archived_at) throw badRequest('This event is not open for registration');
    if (ev.started) throw badRequest('This event has already started.');

    const batch = await memberBatch(conn, user.user_id);
    if (!batchAllowed(ev.eligible_batches, batch)) throw forbidden(INELIGIBLE_MESSAGE);

    const [attemptRows] = await conn.query(
      `SELECT COUNT(*) AS n FROM event_registrations
        WHERE event_id = ? AND user_id = ? AND cancel_reason = ?`,
      [eventId, user.user_id, CANCEL_REASONS.EXPIRED]
    );
    if (Number(attemptRows[0].n) >= MAX_UNPAID_ATTEMPTS) throw conflict(ATTEMPT_LIMIT_MESSAGE);

    const [activeRows] = await conn.query(
      `SELECT registration_id FROM event_registrations
        WHERE event_id = ? AND user_id = ? AND status = 'active' LIMIT 1`,
      [eventId, user.user_id]
    );
    if (activeRows.length) throw conflict('You are already registered for this event');

    const [countRows] = await conn.query(
      `SELECT COUNT(*) AS n FROM event_registrations WHERE event_id = ? AND status = 'active'`,
      [eventId]
    );
    if (Number(countRows[0].n) >= Number(ev.capacity)) throw conflict('Event is full');

    const fee = money(ev.registration_fee);
    const paid = fee !== null && fee > 0;
    let header;
    try {
      // Deadline = LEAST(now + 5 days, event start) in Asia/Dhaka wall clock.
      // The event values are passed directly — the deadline can never extend
      // beyond the event start.
      [header] = paid
        ? await conn.query(
          `INSERT INTO event_registrations
             (event_id, user_id, status, payment_status, payment_deadline, confirmed_at, registration_fee_snapshot)
           VALUES (?, ?, 'active', 'unpaid',
                   LEAST(NOW() + INTERVAL '5 days',
                         ((?::date + COALESCE(?::time, TIME '00:00')) AT TIME ZONE 'Asia/Dhaka')),
                   NULL, ?)
           RETURNING registration_id, payment_deadline,
                     to_char(payment_deadline AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD HH24:MI') AS payment_deadline_display`,
          [eventId, user.user_id, ev.event_date, ev.start_time, fee]
        )
        : await conn.query(
          `INSERT INTO event_registrations
             (event_id, user_id, status, payment_status, payment_deadline, confirmed_at, registration_fee_snapshot)
           VALUES (?, ?, 'active', 'not_required', NULL, NOW(), NULL)
           RETURNING registration_id, payment_deadline,
                     to_char(payment_deadline AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD HH24:MI') AS payment_deadline_display`,
          [eventId, user.user_id]
        );
    } catch (err) {
      if (err.code === '23505') throw conflict('You are already registered for this event');
      throw err;
    }
    const inserted = header.rows[0];
    return {
      eventId,
      title: ev.title,
      registrationId: inserted.registration_id,
      paymentStatus: paid ? 'unpaid' : 'not_required',
      paymentDeadline: inserted.payment_deadline,
      paymentDeadlineDisplay: inserted.payment_deadline_display,
      fee,
    };
  });

  const suffix = result.paymentStatus === 'unpaid'
    ? ` Payment of ৳${result.fee} must be verified before ${result.paymentDeadlineDisplay} (Asia/Dhaka).`
    : '';
  await notify(user.user_id, 'Event registration confirmed', `You are registered for "${result.title}".${suffix}`, 'event',
    { entityType: 'event', entityId: eventId, actorId: user.user_id });
  return {
    event_id: eventId,
    registered: true,
    registration_id: result.registrationId,
    payment_status: result.paymentStatus,
    payment_deadline: result.paymentDeadline,
    payment_deadline_display: result.paymentDeadlineDisplay,
  };
}

/**
 * Member chooses/updates their own T-shirt size. Ownership comes from the JWT
 * (there is no registration id in the request), so no member can ever write
 * another member's row.
 *
 * Eligible when ALL hold, re-read from the DB inside the transaction:
 *   - the caller has an ACTIVE registration for this event
 *   - the event has tshirt_included = TRUE
 *   - payment_status is 'paid' (approved payment) or 'not_required' (free
 *     event: registration confirmed, nothing to pay) — never 'unpaid', which
 *     covers both pending and rejected payments
 */
export async function setMyTshirtSize(user, eventId, size) {
  if (!TSHIRT_SIZES.includes(size)) {
    throw badRequest(`T-shirt size must be one of: ${TSHIRT_SIZES.join(', ')}`);
  }
  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT er.registration_id, er.status, er.payment_status, e.tshirt_included
         FROM event_registrations er JOIN events e ON e.event_id = er.event_id
        WHERE er.event_id = ? AND er.user_id = ? AND er.status = 'active'
        LIMIT 1
        FOR UPDATE OF er`,
      [eventId, user.user_id]
    );
    const reg = rows[0];
    if (!reg) throw notFound('You do not have an active registration for this event');
    if (!reg.tshirt_included) throw badRequest('This event does not include a T-shirt');
    if (reg.payment_status !== 'paid' && reg.payment_status !== 'not_required') {
      throw conflict('T-shirt size can only be selected after your payment is approved.');
    }
    await conn.query(
      `UPDATE event_registrations SET tshirt_size = ? WHERE registration_id = ?`,
      [size, reg.registration_id]
    );
    return {
      event_id: eventId,
      registration_id: reg.registration_id,
      tshirt_size: size,
    };
  });
}

/** Load one active registration with the event start, locked for update. */
async function lockActiveRegistration(conn, eventId, userId) {
  const [rows] = await conn.query(
    `SELECT er.registration_id, er.user_id, er.event_id, er.payment_status,
            er.registration_fee_snapshot, er.created_at,
            ${EVENT_START} AS event_start,
            (${EVENT_START} - NOW() > ${CANCEL_WINDOW}) AS within_window
       FROM event_registrations er JOIN events e ON e.event_id = er.event_id
      WHERE er.event_id = ? AND er.user_id = ? AND er.status = 'active'
      FOR UPDATE OF er`,
    [eventId, userId]
  );
  return rows[0] || null;
}

/**
 * Member self-cancellation — soft cancel with history. Blocked when the event
 * starts in 10 days or less (exactly 10 days is blocked). Payments are never
 * touched or refunded automatically.
 */
export async function cancelRegistration(user, eventId) {
  return withTransaction(async (conn) => {
    const reg = await lockActiveRegistration(conn, eventId, user.user_id);
    if (!reg) {
      const [cancelled] = await conn.query(
        `SELECT registration_id FROM event_registrations
          WHERE event_id = ? AND user_id = ? AND status = 'cancelled' LIMIT 1`,
        [eventId, user.user_id]
      );
      if (cancelled.length) throw conflict('This registration is already cancelled.');
      throw notFound('You are not registered for this event');
    }
    if (!reg.within_window) throw conflict(CANCEL_WINDOW_MESSAGE);
    await conn.query(
      `UPDATE event_registrations
          SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = ?, cancelled_by = ?
        WHERE registration_id = ?`,
      [CANCEL_REASONS.MEMBER, user.user_id, reg.registration_id]
    );
    return {
      event_id: eventId,
      registered: false,
      registration_id: reg.registration_id,
      payment_status: reg.payment_status,
      refunded: false,
    };
  });
}

/** ADMIN/AUTHORITY: cancel one registration manually (same 10-day rule). */
export async function adminCancelRegistration(actor, eventId, registrationId) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT er.registration_id, er.user_id, er.event_id, er.status, er.payment_status,
              (${EVENT_START} - NOW() > ${CANCEL_WINDOW}) AS within_window
         FROM event_registrations er JOIN events e ON e.event_id = er.event_id
        WHERE er.registration_id = ? AND er.event_id = ?
        FOR UPDATE OF er`,
      [registrationId, eventId]
    );
    const reg = rows[0];
    if (!reg) throw notFound('Registration not found');
    if (reg.status !== 'active') throw conflict('This registration is already cancelled.');
    if (!reg.within_window) throw conflict(CANCEL_WINDOW_MESSAGE);
    await conn.query(
      `UPDATE event_registrations
          SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = ?, cancelled_by = ?
        WHERE registration_id = ?`,
      [CANCEL_REASONS.ADMIN, actor.user_id, registrationId]
    );
    return { event_id: eventId, registration_id: registrationId, cancelled: true, payment_status: reg.payment_status };
  });
}

/**
 * ADMIN/AUTHORITY registration viewer. Views:
 *   active     — status = active (the backward-compatible default)
 *   pending    — active + unpaid + deadline not yet passed
 *   cancelled  — status = cancelled (full history)
 * `total` always equals the length of the returned rows.
 */
export async function listEventRegistrations(eventId, view = 'active') {
  const ev = await queryOne(
    `SELECT e.event_id, e.title, e.event_date, e.start_time, e.location, e.status, e.archived_at,
            e.tshirt_included,
            ${EVENT_START_ALIAS} AS event_start,
            ${EVENT_START_DISPLAY} AS event_start_display
       FROM events e WHERE e.event_id = ? LIMIT 1`,
    [eventId]
  );
  if (!ev) throw notFound('Event not found');

  const filters = {
    active: `er.status = 'active'`,
    pending: `er.status = 'active' AND er.payment_status = 'unpaid'
              AND er.payment_deadline IS NOT NULL AND er.payment_deadline > NOW()`,
    cancelled: `er.status = 'cancelled'`,
  };
  if (!filters[view]) throw badRequest(`view must be one of: ${Object.keys(filters).join(', ')}`);
  const order = view === 'cancelled' ? 'er.cancelled_at DESC, er.registration_id DESC' : 'er.created_at ASC, er.registration_id ASC';

  const rows = await query(
    `SELECT er.registration_id, er.event_id, er.created_at AS registered_at,
            u.user_id, u.registration_number, u.first_name, u.last_name, u.phone, p.ssc_batch,
            er.status, er.payment_status,
            er.registration_fee_snapshot AS registration_fee,
            er.tshirt_size,
            er.payment_deadline, ${DEADLINE_DISPLAY} AS payment_deadline_display,
            er.confirmed_at, er.cancelled_at, er.cancel_reason,
            ${APPROVED_SUM} AS approved_amount,
            ${ATTEMPTS_SUBQUERY} AS unpaid_expiry_attempts,
            (${EVENT_START} - NOW() > ${CANCEL_WINDOW}) AS within_cancel_window
       FROM event_registrations er
       JOIN users u ON u.user_id = er.user_id
       LEFT JOIN profiles p ON p.user_id = u.user_id
       JOIN events e ON e.event_id = er.event_id
      WHERE er.event_id = ? AND ${filters[view]}
      ORDER BY ${order}`,
    [eventId]
  );

  const registrations = rows.map((r) => {
    const shaped = shapeRegistration(r);
    return {
      ...shaped,
      can_cancel: r.status === 'active' && Boolean(r.within_cancel_window),
      cancel_block_reason: r.status === 'active' && !r.within_cancel_window ? CANCEL_WINDOW_MESSAGE : null,
      // Approved money still tied to a cancelled registration is a real
      // reconciliation item an admin must resolve manually (no auto-refund).
      reconciliation_required: r.status === 'cancelled' && Number(shaped.approved_amount) > 0,
    };
  });

  const [counts] = await Promise.all([
    queryOne(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active') AS active,
         COUNT(*) FILTER (WHERE status = 'active' AND payment_status = 'unpaid'
                            AND payment_deadline IS NOT NULL AND payment_deadline > NOW()) AS pending,
         COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled
       FROM event_registrations WHERE event_id = ?`,
      [eventId]
    ),
  ]);

  return {
    event: ev,
    view,
    registrations,
    total: registrations.length,
    counts: {
      active: Number(counts?.active || 0),
      pending: Number(counts?.pending || 0),
      cancelled: Number(counts?.cancelled || 0),
    },
  };
}

/**
 * Trustworthy T-shirt participant list — the SAME rows the print total uses:
 * active + eligible (current DB batch) + event not cancelled/archived +
 * payment_status not_required or paid.
 */
export async function listEventParticipants(eventId) {
  const ev = await queryOne(
    `SELECT e.event_id, e.title, e.event_date, e.start_time, e.location, e.status, e.archived_at,
            e.tshirt_included,
            ${EVENT_START_ALIAS} AS event_start,
            ${EVENT_START_DISPLAY} AS event_start_display
       FROM events e WHERE e.event_id = ? LIMIT 1`,
    [eventId]
  );
  if (!ev) throw notFound('Event not found');

  const rows = await query(
    `SELECT er.registration_id, er.user_id, u.registration_number,
            u.first_name, u.last_name, u.phone, p.ssc_batch,
            er.payment_status, er.registration_fee_snapshot AS registration_fee,
            er.tshirt_size, er.created_at AS registered_at, er.confirmed_at
       FROM event_registrations er
       JOIN users u ON u.user_id = er.user_id
       LEFT JOIN profiles p ON p.user_id = u.user_id
       JOIN events e ON e.event_id = er.event_id
      WHERE er.event_id = ?
        AND er.status = 'active'
        AND er.payment_status IN ('not_required','paid')
        AND e.status <> 'cancelled'
        AND e.archived_at IS NULL
        AND (e.eligible_batches IS NULL OR p.ssc_batch = ANY(e.eligible_batches))
      ORDER BY u.first_name, u.last_name, er.registration_id`,
    [eventId]
  );
  return {
    event: ev,
    registrations: rows.map(shapeRegistration),
    total: rows.length,
  };
}

/** Member's own registration history (active + cancelled), newest first. */
export async function listMyRegistrations(userId) {
  const rows = await query(
    `SELECT er.registration_id, er.event_id, er.status, er.payment_status,
            er.registration_fee_snapshot AS registration_fee,
            er.tshirt_size,
            er.payment_deadline, ${DEADLINE_DISPLAY} AS payment_deadline_display,
            er.created_at AS registered_at, er.confirmed_at, er.cancelled_at, er.cancel_reason,
            ${APPROVED_SUM} AS approved_amount,
            ${ATTEMPTS_SUBQUERY} AS unpaid_expiry_attempts,
            (${EVENT_START} - NOW() > ${CANCEL_WINDOW}) AS within_cancel_window,
            (${EVENT_START} <= NOW()) AS event_started,
            e.title, e.event_date, e.start_time, e.location, e.status AS event_status,
            e.archived_at, e.registration_fee AS event_registration_fee, e.tshirt_included,
            ${EVENT_START_DISPLAY} AS event_start_display
       FROM event_registrations er JOIN events e ON e.event_id = er.event_id
      WHERE er.user_id = ?
      ORDER BY er.created_at DESC, er.registration_id DESC`,
    [userId]
  );
  return rows.map((r) => {
    const shaped = shapeRegistration(r);
    const active = r.status === 'active';
    return {
      ...shaped,
      can_cancel: active && Boolean(r.within_cancel_window),
      cancel_block_reason: active && !r.within_cancel_window ? CANCEL_WINDOW_MESSAGE : null,
      is_active: active,
      is_cancelled: r.status === 'cancelled',
    };
  });
}

/**
 * Scheduler body: cancel active unpaid registrations whose deadline passed.
 * Advisory-lock guarded, SKIP LOCKED, bounded and idempotent.
 */
export async function expireOverdueRegistrations(limit = 200) {
  const bounded = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  return withTransaction(async (conn) => {
    const [lockRows] = await conn.query(`SELECT pg_try_advisory_xact_lock(927451831) AS locked`);
    if (!lockRows[0].locked) {
      return { processed: 0, skipped: 'another expiry run is in progress', limit: bounded, ids: [] };
    }
    const [result] = await conn.query(
      `WITH candidates AS (
         SELECT registration_id FROM event_registrations
          WHERE status = 'active'
            AND payment_status = 'unpaid'
            AND payment_deadline IS NOT NULL
            AND payment_deadline <= NOW()
          ORDER BY payment_deadline ASC, registration_id ASC
          LIMIT ?
          FOR UPDATE SKIP LOCKED
       )
       UPDATE event_registrations er
          SET status = 'cancelled',
              cancelled_at = NOW(),
              cancel_reason = ?
         FROM candidates c
        WHERE er.registration_id = c.registration_id
          AND er.status = 'active'
          AND er.payment_status = 'unpaid'
       RETURNING er.registration_id`,
      [bounded, CANCEL_REASONS.EXPIRED]
    );
    const rows = result.rows ?? [];
    return { processed: rows.length, limit: bounded, ids: rows.map((r) => r.registration_id) };
  });
}
