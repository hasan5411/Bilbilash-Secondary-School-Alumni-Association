import { query } from '../db/pool.js';

/**
 * Public directory: approved + active alumni only (any role), public fields only
 * (name, batch, profession, institute, blood group). Phone/address/email excluded.
 */
export async function searchDirectory(filters = {}) {
  // Approved + active accounts are alumni regardless of role — MEMBER, ADMIN and AUTHORITY all appear.
  const where = [`u.status = 'approved'`, `u.is_active = 1`];
  const params = [];

  if (filters.name) {
    where.push('(u.first_name LIKE ? OR u.last_name LIKE ?)');
    const like = `%${filters.name}%`;
    params.push(like, like);
  }
  if (filters.batch) {
    where.push('p.ssc_batch = ?');
    params.push(Number(filters.batch));
  }
  if (filters.profession) {
    where.push('p.profession LIKE ?');
    params.push(`%${filters.profession}%`);
  }
  if (filters.institute) {
    where.push('p.institute LIKE ?');
    params.push(`%${filters.institute}%`);
  }
  if (filters.blood_group) {
    where.push('p.blood_group = ?');
    params.push(filters.blood_group);
  }

  const rows = await query(
    `SELECT u.user_id, u.first_name, u.last_name,
            p.ssc_batch, p.blood_group, p.active_donor, p.profession, p.institute, p.profile_photo
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       LEFT JOIN profiles p ON p.user_id = u.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY u.first_name, u.last_name
      LIMIT 200`,
    params
  );
  // active_donor is TINYINT(1) in MySQL — normalize to a real boolean so falsy
  // values can never leak into client-side `&&` rendering as a literal "0".
  return rows.map((r) => ({ ...r, active_donor: r.active_donor === 1 || r.active_donor === true }));
}

export async function getPublicProfile(userId) {
  const { queryOne } = await import('../db/pool.js');
  const row = await queryOne(
    `SELECT u.user_id, u.first_name, u.last_name, u.created_at, u.phone,
            p.ssc_batch, p.blood_group, p.active_donor, p.profession, p.institute, p.bio, p.present_address, p.permanent_address, p.facebook_url, p.profile_photo
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       LEFT JOIN profiles p ON p.user_id = u.user_id
      WHERE u.user_id = ? AND u.status = 'approved' AND u.is_active = 1 LIMIT 1`,
    [userId]
  );
  if (!row) return row;
  return { ...row, active_donor: row.active_donor === 1 || row.active_donor === true };
}
