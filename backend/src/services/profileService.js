import { query, queryOne, withTransaction } from '../db/pool.js';
import { notFound } from '../utils/errors.js';
import { BLOOD_GROUPS } from '../utils/validate.js';
import { computeProfileCompletion } from '../utils/profileCompletion.js';

const OWN_SELECT = `
  SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone, u.status, u.created_at,
         u.registration_number,
         r.role_name AS role, p.ssc_batch, p.blood_group, p.active_donor, p.profession, p.institute, p.present_address, p.permanent_address, p.bio, p.facebook_url, p.profile_photo
    FROM users u
    JOIN roles r ON r.role_id = u.role_id
    LEFT JOIN profiles p ON p.user_id = u.user_id`;

/** Normalize a fetched profile row + attach the server-computed completion %. */
function presentProfile(row) {
  return {
    ...row,
    active_donor: row.active_donor === 1 || row.active_donor === true,
    // Real percentage computed server-side from THIS user's saved row only.
    profile_completion: computeProfileCompletion(row),
  };
}

export async function getOwnProfile(userId) {
  const row = await queryOne(`${OWN_SELECT} WHERE u.user_id = ? LIMIT 1`, [userId]);
  if (!row) throw notFound('Profile not found');
  return presentProfile(row);
}

/** Update own profile + name/phone. role/status/email/password are NEVER editable here. */
export async function updateOwnProfile(userId, data, photoFilename = undefined) {
  return withTransaction(async (conn) => {
    await conn.query(
      `UPDATE users SET first_name = ?, last_name = ?, phone = ?, registration_number = ? WHERE user_id = ?`,
      [data.first_name, data.last_name, data.phone || null, data.registration_number, userId]
    );
    const [[p]] = await conn.query(`SELECT profile_id FROM profiles WHERE user_id = ? LIMIT 1`, [userId]);
    if (!p) {
      await conn.query(
        `INSERT INTO profiles (user_id, ssc_batch, blood_group, active_donor, profession, institute, present_address, permanent_address, bio, facebook_url, profile_photo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, data.ssc_batch ?? null, data.blood_group ?? null, data.active_donor ? 1 : 0, data.profession || null, data.institute || null, data.present_address || null, data.permanent_address || null, data.bio || null, data.facebook_url || null, photoFilename ?? null]
      );
    } else {
      await conn.query(
        `UPDATE profiles SET ssc_batch = ?, blood_group = ?, active_donor = ?, profession = ?, institute = ?, present_address = ?, permanent_address = ?, bio = ?, facebook_url = ?
           WHERE user_id = ?`,
        [data.ssc_batch ?? null, data.blood_group ?? null, data.active_donor ? 1 : 0, data.profession || null, data.institute || null, data.present_address || null, data.permanent_address || null, data.bio || null, data.facebook_url || null, userId]
      );
      if (photoFilename !== undefined) {
        await conn.query(`UPDATE profiles SET profile_photo = ? WHERE user_id = ?`, [photoFilename, userId]);
      }
    }
    // Read back on the SAME connection so the response reflects this transaction's
    // writes (the pool could return a different, pre-commit connection).
    const [rows] = await conn.query(
      `${OWN_SELECT} WHERE u.user_id = ? LIMIT 1`,
      [userId]
    );
    // Fresh read-back → completion % reflects this transaction's writes immediately.
    return presentProfile(rows[0]);
  });
}

export function validateBloodGroup(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!BLOOD_GROUPS.includes(value)) {
    const err = new Error('Invalid blood group');
    err.status = 422;
    throw err;
  }
  return value;
}
