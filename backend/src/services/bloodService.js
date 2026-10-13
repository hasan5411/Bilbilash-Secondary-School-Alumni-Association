import { query } from '../db/pool.js';

/**
 * Blood group (Badhon) search over approved members.
 * Returns public display info only; contact details require a separate
 * authorized endpoint and are never included here.
 *
 * Uses the same standard as the Alumni Directory: every approved + active
 * account is listed regardless of role (MEMBER, ADMIN and AUTHORITY all appear).
 */
export async function searchByBloodGroup(bloodGroup) {
  return query(
    `SELECT u.user_id, u.first_name, u.last_name, p.blood_group, p.ssc_batch, p.profession, p.institute
       FROM profiles p
       JOIN users u ON u.user_id = p.user_id
       JOIN roles r ON r.role_id = u.role_id
      WHERE p.blood_group = ? AND u.status = 'approved' AND u.is_active = 1
      ORDER BY u.first_name LIMIT 200`,
    [bloodGroup]
  );
}

export async function bloodGroupSummary() {
  return query(
    `SELECT p.blood_group, COUNT(*) AS count
       FROM profiles p
       JOIN users u ON u.user_id = p.user_id
       JOIN roles r ON r.role_id = u.role_id
      WHERE p.blood_group IS NOT NULL AND u.status = 'approved' AND u.is_active = 1
      GROUP BY p.blood_group`
  );
}
