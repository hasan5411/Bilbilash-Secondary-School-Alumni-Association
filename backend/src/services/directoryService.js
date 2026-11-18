import { query, queryOne } from '../db/pool.js';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

/** Split free text into case-insensitive search tokens (wildcards stripped). */
function searchTokens(value, max = 6) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[%_\\]/g, ''))
    .filter(Boolean)
    .slice(0, max);
}

/**
 * Public directory: approved + active alumni only (any role), public fields only.
 * Address is searchable (present address only) but never returned, so members
 * can be found by area without exposing where anyone lives.
 *
 * Paged so the client can render a first batch immediately and pull the rest
 * gradually while scrolling: { results, total, limit, offset, has_more }.
 */
export async function searchDirectory(filters = {}) {
  // Approved + active accounts are alumni regardless of role — MEMBER, ADMIN and AUTHORITY all appear.
  const where = [`u.status = 'approved'`, `u.is_active = 1`];
  const params = [];

  if (filters.name) {
    // Match each word independently against first AND last name, so a full
    // name typed in any order/case ("Md. Hasan Khan") still finds the member
    // whose name is split across the two columns ("MD." + "HASAN KHAN").
    for (const token of searchTokens(filters.name)) {
      where.push('(u.first_name ILIKE ? OR u.last_name ILIKE ?)');
      const like = `%${token}%`;
      params.push(like, like);
    }
  }
  if (filters.batch) {
    where.push('p.ssc_batch = ?');
    params.push(Number(filters.batch));
  }
  if (filters.profession) {
    where.push('p.profession ILIKE ?');
    params.push(`%${filters.profession}%`);
  }
  if (filters.institute) {
    // One box covers current employer/institute, college and university.
    where.push('(p.institute ILIKE ? OR p.college ILIKE ? OR p.university ILIKE ?)');
    const like = `%${filters.institute}%`;
    params.push(like, like, like);
  }
  if (filters.address) {
    where.push('p.present_address ILIKE ?');
    params.push(`%${filters.address}%`);
  }
  if (filters.blood_group) {
    where.push('p.blood_group = ?');
    params.push(filters.blood_group);
  }

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(filters.limit, 10) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number.parseInt(filters.offset, 10) || 0);

  const totalRow = await queryOne(
    `SELECT COUNT(*) AS total
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.user_id
      WHERE ${where.join(' AND ')}`,
    params
  );

  const rows = await query(
    `SELECT u.user_id, u.first_name, u.last_name,
            p.ssc_batch, p.blood_group, p.active_donor, p.profession, p.institute,
            p.college, p.university, p.profile_photo
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       LEFT JOIN profiles p ON p.user_id = u.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY u.first_name, u.last_name, u.user_id
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  // active_donor is stored as a 0/1 flag — normalize to a real boolean so
  // falsy values can never leak into client-side `&&` rendering as a literal "0".
  const total = Number(totalRow?.total ?? 0);
  return {
    results: rows.map((r) => ({ ...r, active_donor: r.active_donor === 1 || r.active_donor === true })),
    total,
    limit,
    offset,
    has_more: offset + rows.length < total,
  };
}

export async function getPublicProfile(userId) {
  const { queryOne } = await import('../db/pool.js');
  const row = await queryOne(
    `SELECT u.user_id, u.first_name, u.last_name, u.created_at, u.phone,
            p.ssc_batch, p.blood_group, p.active_donor, p.profession, p.institute,
            p.college, p.university,
            p.bio, p.present_address, p.permanent_address, p.facebook_url, p.profile_photo
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       LEFT JOIN profiles p ON p.user_id = u.user_id
      WHERE u.user_id = ? AND u.status = 'approved' AND u.is_active = 1 LIMIT 1`,
    [userId]
  );
  if (!row) return row;
  return { ...row, active_donor: row.active_donor === 1 || row.active_donor === true };
}
