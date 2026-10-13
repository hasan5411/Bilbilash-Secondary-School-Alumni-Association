import bcrypt from 'bcryptjs';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { badRequest, conflict, notFound, forbidden } from '../utils/errors.js';
import { notify, notifyModerators, NOTIFICATION_TYPES } from './notificationService.js';

export const MAX_ADMINS = 100;

export function publicUser(row) {
  if (!row) return null;
  return {
    user_id: row.user_id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    phone: row.phone,
    role: row.role_name,
    status: row.status,
    ssc_batch: row.ssc_batch ?? null,
    blood_group: row.blood_group ?? null,
    active_donor: row.active_donor === 1 || row.active_donor === true,
    profession: row.profession ?? null,
    institute: row.institute ?? null,
    present_address: row.present_address ?? null,
    permanent_address: row.permanent_address ?? null,
    profile_photo: row.profile_photo ?? null,
    facebook_url: row.facebook_url ?? null,
    created_at: row.created_at,
  };
}

const BASE_SELECT = `
  SELECT u.*, r.role_name, p.ssc_batch, p.blood_group, p.active_donor, p.profession, p.institute, p.present_address, p.permanent_address, p.bio, p.facebook_url, p.profile_photo
    FROM users u
    JOIN roles r ON r.role_id = u.role_id
    LEFT JOIN profiles p ON p.user_id = u.user_id`;

export async function findByEmail(email) {
  return queryOne(`${BASE_SELECT} WHERE u.email = ? LIMIT 1`, [String(email).trim().toLowerCase()]);
}

export async function findById(id) {
  return queryOne(`${BASE_SELECT} WHERE u.user_id = ? LIMIT 1`, [id]);
}

/** Registration ALWAYS creates a pending VISITOR. Any role in the body is ignored. */
export async function registerUser(data) {
  const email = data.email.trim().toLowerCase();
  const exists = await findByEmail(email);
  if (exists) throw conflict('An account with this email already exists');

  const hash = await bcrypt.hash(data.password, 12);
  const userId = await withTransaction(async (conn) => {
    const [visitorRole] = await conn.query("SELECT role_id FROM roles WHERE role_name='VISITOR' LIMIT 1");
    const [res] = await conn.query(
      `INSERT INTO users (role_id, first_name, last_name, email, password_hash, phone, registration_number, status, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1)
       RETURNING user_id`,
      [visitorRole[0].role_id, data.first_name, data.last_name, email, hash, data.phone || null, data.registration_number || null]
    );
    const userId = res.insertId;
    await conn.query(
      `INSERT INTO profiles (user_id, ssc_batch, blood_group, profession, institute, present_address, permanent_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, data.ssc_batch ?? null, data.blood_group ?? null, data.profession || null, data.institute || null, data.present_address || null, data.permanent_address || null]
    );
    return userId;
  });

  // Moderators (ADMIN + AUTHORITY) must review the new registration. The new
  // user themself gets nothing here — they simply wait for the decision.
  await notifyModerators({
    actorId: userId,
    type: NOTIFICATION_TYPES.REGISTRATION_PENDING,
    title: 'New member registration',
    message: `${data.first_name} ${data.last_name} registered and is awaiting approval.`,
    entityType: 'user',
    entityId: userId,
  });
  return userId;
}

const STATUS_TRANSITIONS = {
  approve: 'approved',
  reject: 'rejected',
  deactivate: 'inactive',
};

/** Admin/Authority: approve / reject / deactivate a VISITOR account. Never deletes users. */
export async function setUserStatus(actor, userId, action) {
  const newStatus = STATUS_TRANSITIONS[action];
  if (!newStatus) throw badRequest('Unknown action');
  // Transaction does ONLY the state change; notifications are sent after commit.
  // (Inserting a notification inside the transaction deadlocks: the notification's
  // foreign key needs a lock on the very user row the transaction still holds.)
  await withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT u.user_id, u.email, u.status, u.first_name, r.role_name
         FROM users u JOIN roles r ON r.role_id = u.role_id
        WHERE u.user_id = ? FOR UPDATE`,
      [userId]
    );
    const target = rows[0];
    if (!target) throw notFound('User not found');
    if (target.role_name === 'AUTHORITY') throw forbidden('Authority account cannot be modified');
    if (actor.role_name === 'ADMIN' && (target.role_name === 'ADMIN' || target.role_name === 'AUTHORITY')) {
      throw forbidden('Admins cannot change the status of Admin or Authority accounts');
    }
    await conn.query('UPDATE users SET status = ?, is_active = ? WHERE user_id = ?', [
      newStatus,
      newStatus === 'inactive' ? 0 : 1,
      userId,
    ]);
    if (action === 'approve') {
      const [memberRole] = await conn.query("SELECT role_id FROM roles WHERE role_name='MEMBER' LIMIT 1");
      await conn.query('UPDATE users SET role_id = ? WHERE user_id = ?', [memberRole[0].role_id, userId]);
    }
    return { user_id: userId, status: newStatus };
  });

  if (action === 'approve') {
    await notify(userId, 'Registration approved', 'Your membership was approved. Welcome to the Bilbilash Alumni community!', NOTIFICATION_TYPES.REGISTRATION_APPROVED, { entityType: 'user', entityId: userId, actorId: actor.user_id });
  } else if (action === 'reject') {
    await notify(userId, 'Registration rejected', 'Your registration was reviewed and not approved. Contact an administrator for details.', NOTIFICATION_TYPES.REGISTRATION_REJECTED, { entityType: 'user', entityId: userId, actorId: actor.user_id });
  }
  return { user_id: userId, status: newStatus };
}

/**
 * Promote approved MEMBER -> ADMIN with race-safe max-100 enforcement.
 * Runs inside a transaction with FOR UPDATE row locks so two simultaneous
 * promotions can never exceed MAX_ADMINS.
 */
export async function promoteToAdmin(actor, userId) {
  const result = await withTransaction(async (conn) => {
    const [targetRows] = await conn.query(
      `SELECT u.user_id, u.status, r.role_name, u.first_name, u.last_name
         FROM users u JOIN roles r ON r.role_id = u.role_id
        WHERE u.user_id = ? FOR UPDATE`,
      [userId]
    );
    const target = targetRows[0];
    if (!target) throw notFound('User not found');
    if (target.role_name !== 'MEMBER') throw badRequest('Only MEMBER accounts can be promoted to Admin');
    if (target.status !== 'approved') throw badRequest('Only approved members can be promoted');

    const [adminRole] = await conn.query("SELECT role_id FROM roles WHERE role_name='ADMIN' LIMIT 1");
    // FOR SHARE on matching rows serializes concurrent promotions.
    await conn.query('SELECT role_id FROM users WHERE role_id = ? AND is_active = 1 FOR SHARE', [adminRole[0].role_id]);
    const [[{ cnt }]] = await conn.query('SELECT COUNT(*) AS cnt FROM users WHERE role_id = ? AND is_active = 1', [adminRole[0].role_id]);
    if (cnt >= MAX_ADMINS) throw conflict(`Admin limit reached (max ${MAX_ADMINS})`);

    await conn.query('UPDATE users SET role_id = ? WHERE user_id = ?', [adminRole[0].role_id, userId]);
    return { user_id: userId, role: 'ADMIN' };
  });
  await notify(userId, 'Promoted to Admin', 'You have been promoted to Admin by the Authority.', 'promotion');
  return result;
}

/** Only Authority can demote ADMIN -> MEMBER. Permissions change immediately (role read from DB per request). */
export async function demoteAdmin(actor, userId) {
  if (actor.role_name !== 'AUTHORITY') throw forbidden('Only Authority can demote an Admin');
  const result = await withTransaction(async (conn) => {
    const [targetRows] = await conn.query(
      `SELECT u.user_id, r.role_name FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = ? FOR UPDATE`,
      [userId]
    );
    const target = targetRows[0];
    if (!target) throw notFound('User not found');
    if (target.role_name !== 'ADMIN') throw badRequest('Only ADMIN accounts can be demoted');
    const [memberRole] = await conn.query("SELECT role_id FROM roles WHERE role_name='MEMBER' LIMIT 1");
    await conn.query('UPDATE users SET role_id = ? WHERE user_id = ?', [memberRole[0].role_id, userId]);
    return { user_id: userId, role: 'MEMBER' };
  });
  await notify(userId, 'Demoted to Member', 'Your Admin role was removed. You are now a Member.', 'demotion');
  return result;
}

/**
 * Permanently delete a user account — case by case, inside ONE transaction.
 * Guards: no self-delete, Authority is protected, Admins cannot delete Admins.
 *
 * Retention policy enforced here (schema: member_monthly_rates.set_by is
 * NULLable with ON DELETE SET NULL + set_by_snapshot identity text):
 *  1. Rates the member set for THEMSELVES (user_id = target) leave with the
 *     account — the existing fk_mmr_user CASCADE policy. They are captured in
 *     an immutable audit_logs entry first, never silently discarded.
 *  2. Rates this account set for OTHER members (set_by = target, user_id <>)
 *     SURVIVE: the setter's identity is copied into set_by_snapshot, then the
 *     FK releases the pointer to NULL. Amounts, months and rate owners are
 *     untouched — attribution is preserved, never reassigned.
 *  3. Payments MADE by the member cannot survive without the user row (user_id
 *     anchors every report; reg_number is only a snapshot) — deletion is
 *     refused with 409 and the exact dependency. Deactivate instead.
 *  4. Payments this account REVIEWED survive (reviewed_by -> SET NULL); the
 *     reviewer's identity is preserved in the same audit entry.
 *
 * Any failure rolls back the whole transaction (snapshots included).
 */
export async function deleteUser(actor, userId) {
  if (Number(actor.user_id) === Number(userId)) throw forbidden('You cannot delete your own account');
  return withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT u.user_id, u.email, u.first_name, u.last_name, r.role_name
         FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = ? FOR UPDATE`,
      [userId]
    );
    const target = rows[0];
    if (!target) throw notFound('User not found');
    if (target.role_name === 'AUTHORITY') throw forbidden('Authority account cannot be deleted');
    if (actor.role_name === 'ADMIN' && target.role_name === 'ADMIN') {
      throw forbidden('Admins cannot delete Admin accounts');
    }
    const identity = `${target.first_name} ${target.last_name} <${target.email}> (user_id ${userId})`.slice(0, 160);

    // Case 3 — payments made by the member: checked FIRST (before any write) so
    // a blocked deletion can never leave partial changes behind.
    const [payRefs] = await conn.query(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total
         FROM payments WHERE user_id = ?`,
      [userId]
    );
    if (Number(payRefs[0].cnt) > 0) {
      throw conflict(
        `This account has ${payRefs[0].cnt} payment record(s) totalling ৳${Number(payRefs[0].total)}. ` +
        'Payment history cannot be deleted or reassigned to anyone else. ' +
        'Deactivate the account instead — payment history and every amount stay intact.'
      );
    }

    // Case 2 — attribution rows for OTHER members: snapshot the setter's
    // identity, then let fk_mmr_setby (SET NULL) release the pointer on delete.
    const [attribution] = await conn.query(
      `SELECT rate_id FROM member_monthly_rates WHERE set_by = ? AND user_id <> ?`,
      [userId, userId]
    );
    if (attribution.length > 0) {
      await conn.query(
        `UPDATE member_monthly_rates SET set_by_snapshot = ? WHERE set_by = ? AND user_id <> ?`,
        [identity, userId, userId]
      );
    }

    // Case 1 — the member's own rate rows leave with the account (fk_mmr_user
    // CASCADE). Capture them for the audit trail before the DELETE.
    const [ownRates] = await conn.query(
      `SELECT rate_id, amount, effective_month, source
         FROM member_monthly_rates WHERE user_id = ?`,
      [userId]
    );

    // Case 4 — payments reviewed by this account (survive; reviewed_by -> SET NULL).
    const [reviewed] = await conn.query(
      `SELECT payment_id FROM payments WHERE reviewed_by = ?`,
      [userId]
    );

    const [del] = await conn.query('DELETE FROM users WHERE user_id = ?', [userId]);
    if (del.affectedRows !== 1) throw conflict('User could not be deleted — nothing was changed.');

    // Immutable audit entry, atomic with the delete (same transaction).
    await conn.query(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, details) VALUES (?, 'user_deleted', 'users', ?, ?)`,
      [
        actor.user_id,
        userId,
        JSON.stringify({
          deleted_user: identity,
          deleted_role: target.role_name,
          deleted_by: `${actor.first_name || ''} ${actor.last_name || ''} <${actor.email || ''}>`.trim(),
          attribution_rates_preserved: attribution.map((r) => r.rate_id),
          own_rates_removed_with_account: ownRates.map((r) => ({
            rate_id: r.rate_id, amount: r.amount, effective_month: r.effective_month, source: r.source,
          })),
          reviewed_payments_reviewer_released: reviewed.map((p) => p.payment_id),
        })
      ]
    );

    return {
      user_id: userId,
      attribution_rates_preserved: attribution.length,
      own_rates_removed: ownRates.length,
      reviewed_payments: reviewed.length,
    };
  });
}

export async function listUsersByStatus(statuses) {
  const placeholders = statuses.map(() => '?').join(',');
  const rows = await query(
    `${BASE_SELECT} WHERE u.status IN (${placeholders}) ORDER BY u.created_at DESC LIMIT 500`,
    statuses
  );
  return rows.map(publicUser);
}

/**
 * Admin/Authority: complete profile for ONE user. Never returns password_hash
 * or token_version — credentials are stripped explicitly by the controller.
 */
export async function getUserDetail(userId) {
  const row = await queryOne(`${BASE_SELECT} WHERE u.user_id = ? LIMIT 1`, [userId]);
  if (!row) throw notFound('User not found');
  return row;
}

export async function countByRole() {
  return query(
    `SELECT r.role_name, COUNT(*) AS count FROM users u JOIN roles r ON r.role_id = u.role_id
      WHERE u.is_active = 1 GROUP BY r.role_name`
  );
}
