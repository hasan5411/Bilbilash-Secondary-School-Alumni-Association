import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { query, withTransaction } from '../db/pool.js';
import { badRequest, unauthorized, forbidden, conflict } from '../utils/errors.js';
import { findByEmail, findById } from './userService.js';
import { emailEnabled, passwordResetOtpEmail } from './emailService.js';
import { env } from '../config/env.js';
import { notify, NOTIFICATION_TYPES } from './notificationService.js';

const OTP_TTL_MINUTES = 5;        // Spec: OTP expires after 5 minutes.
const OTP_RESEND_COOLDOWN = 60;   // Seconds between two OTP requests (Section 8).
const OTP_MAX_ATTEMPTS = 5;       // Wrong-OTP attempts allowed per code (Section 8).
const DEV_OTP_MODE = () => !emailEnabled() && env.allowDevOtp;

/**
 * Login: verifies email + password + account state. Returns DB user row.
 *
 * Eligibility (checked AFTER the password so the outcome is only revealed to
 * someone who already proved they know the credentials):
 *   - pending   -> 403, membership awaiting approval — NO token is issued;
 *   - rejected/inactive/!is_active -> 401, account not active;
 *   - approved  -> 200, JWT issued.
 * Registration still creates a pending VISITOR — that account simply cannot
 * obtain an authenticated session until an admin approves it.
 */
export async function login(email, password) {
  const user = await findByEmail(email);
  if (!user) throw unauthorized('Invalid email or password');
  const ok = await bcrypt.compare(String(password), user.password_hash);
  if (!ok) throw unauthorized('Invalid email or password');
  if (user.status === 'pending') {
    throw forbidden('Your membership is awaiting approval. You cannot log in until your membership is approved.');
  }
  if (user.status !== 'approved' || !user.is_active) {
    throw unauthorized('This account is not active. Contact an administrator.');
  }
  // Monthly-contribution setup reminder (fire-and-forget, never blocks login).
  if (user.status === 'approved') maybeRemindContributionSetup(user.user_id);
  return user;
}

/**
 * Rule B — remind approved members (MEMBER/ADMIN/AUTHORITY only) once to
 * configure their monthly contribution. Duplicate-safe in TWO ways:
 *  - no reminder at all once a rate row exists;
 *  - no second reminder while an unread one is still sitting in the bell.
 * The reminder is cleared automatically when the member sets a rate.
 */
function maybeRemindContributionSetup(userId) {
  setImmediate(async () => {
    try {
      const rows = await query(
        `SELECT r.role_name,
                EXISTS (SELECT 1 FROM member_monthly_rates m WHERE m.user_id = u.user_id) AS has_rate
           FROM users u JOIN roles r ON r.role_id = u.role_id
          WHERE u.user_id = ? LIMIT 1`,
        [userId]
      );
      const row = rows?.[0];
      if (!row || row.has_rate) return;
      if (!['MEMBER', 'ADMIN', 'AUTHORITY'].includes(row.role_name)) return;
      const unread = await query(
        `SELECT notification_id FROM notifications
          WHERE recipient_id = ? AND type = 'contribution_setup' AND is_read = 0 LIMIT 1`,
        [userId]
      );
      if (unread.length) return; // already reminding — no duplicates on every login
      await notify(
        userId,
        'Monthly Contribution Setup Required',
        'Please set your monthly contribution amount to enable accurate monthly payment and due calculations.',
        NOTIFICATION_TYPES.CONTRIBUTION_SETUP,
        { entityType: 'contribution', entityId: userId }
      );
    } catch (err) {
      console.error('[contribution-reminder]', err.code || '', err.message);
    }
  });
}

/**
 * Forgot password: generate a 6-digit OTP, store ONLY its bcrypt hash with a
 * 5-minute expiry, and email it to the user's registered address via Gmail SMTP.
 *
 * - Enumeration-safe: unknown emails get the same generic response shape.
 * - Cooldown: a new OTP cannot be requested within 60s of the previous one.
 * - Delivery is real: if sending fails, the caller tells the user so — we never
 *   claim "sent" when the email did not go out (spec Section 15).
 * - The OTP is NEVER returned in API responses except in the documented
 *   local-dev mode (ALLOW_DEV_OTP=1 AND no SMTP configured).
 */
export async function createPasswordReset(email) {
  const user = await findByEmail(email);
  if (!user) {
    // Do not reveal whether the email exists.
    return { sent: true, delivered: null };
  }

  // Resend cooldown (uses the latest request regardless of its used/expired state).
  const [last] = await query(
    `SELECT created_at FROM password_resets WHERE user_id = ? ORDER BY reset_id DESC LIMIT 1`,
    [user.user_id]
  );
  if (last) {
    const elapsed = (Date.now() - new Date(last.created_at).getTime()) / 1000;
    if (elapsed < OTP_RESEND_COOLDOWN) {
      throw conflict(`Please wait ${Math.ceil(OTP_RESEND_COOLDOWN - elapsed)}s before requesting another code.`);
    }
  }

  const otp = String(crypto.randomInt(100000, 1000000));
  const otpHash = await bcrypt.hash(otp, 10);
  await query(
    `INSERT INTO password_resets (user_id, otp_hash, expires_at) VALUES (?, ?, NOW() + (? || ' minutes')::interval)`,
    [user.user_id, otpHash, OTP_TTL_MINUTES]
  );

  const mail = await passwordResetOtpEmail(user.email, otp, OTP_TTL_MINUTES);
  if (mail.sent) {
    return { sent: true, delivered: true };
  }
  if (mail.reason === 'not_configured') {
    // Local development without SMTP: console fallback, dev OTP only behind the flag.
    console.log(`[auth] Password reset OTP for user #${user.user_id} (${email}): ${otp} — expires in ${OTP_TTL_MINUTES} min`);
    return { sent: true, delivered: false, devOtp: DEV_OTP_MODE() ? otp : undefined };
  }
  // SMTP configured but delivery FAILED — do not pretend success.
  throw badRequest('Could not send the reset email. Please try again shortly.');
}

/** Verify an OTP (valid, unexpired, unused, under the attempt cap) for the user. */
async function consumeOtp(userId, otp, { markUsed = false } = {}) {
  const rows = await query(
    `SELECT reset_id, otp_hash, expires_at, used_at, attempts FROM password_resets
      WHERE user_id = ? AND used_at IS NULL
      ORDER BY reset_id DESC LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  if (!row) throw badRequest('No valid reset code. Request a new one.');
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw badRequest('This reset code has expired. Request a new one.');
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    throw badRequest('Too many incorrect attempts. Request a new code.');
  }

  const ok = await bcrypt.compare(String(otp), row.otp_hash);
  if (!ok) {
    await query(`UPDATE password_resets SET attempts = attempts + 1 WHERE reset_id = ?`, [row.reset_id]);
    const left = OTP_MAX_ATTEMPTS - row.attempts - 1;
    throw badRequest(left > 0 ? `Incorrect reset code (${left} attempt${left === 1 ? '' : 's'} left)` : 'Too many incorrect attempts. Request a new code.');
  }
  if (markUsed) await query(`UPDATE password_resets SET used_at = NOW() WHERE reset_id = ?`, [row.reset_id]);
  return row;
}

export async function verifyResetOtp(email, otp) {
  const user = await findByEmail(email);
  if (!user) throw badRequest('No valid reset code for this email');
  await consumeOtp(user.user_id, otp);
  return { valid: true };
}

/** Reset password with OTP: single-use OTP, bcrypt new hash, bump token_version (kills old sessions). */
export async function resetPassword(email, otp, newPassword, confirmPassword) {
  if (confirmPassword !== undefined && String(confirmPassword) !== String(newPassword)) {
    throw badRequest('Passwords do not match');
  }
  const user = await findByEmail(email);
  if (!user) throw badRequest('No valid reset code for this email');
  await withTransaction(async (conn) => {
    await consumeOtp(user.user_id, otp, { markUsed: true });
    const hash = await bcrypt.hash(newPassword, 12);
    await conn.query(`UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE user_id = ?`, [hash, user.user_id]);
  });
  return { reset: true };
}

/** Change password while logged in. */
export async function changePassword(userId, currentPassword, newPassword) {
  const user = await findById(userId);
  if (!user) throw unauthorized();
  const ok = await bcrypt.compare(String(currentPassword), user.password_hash);
  if (!ok) throw badRequest('Current password is incorrect');
  const hash = await bcrypt.hash(newPassword, 12);
  await query(`UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE user_id = ?`, [hash, userId]);
  return { changed: true };
}
