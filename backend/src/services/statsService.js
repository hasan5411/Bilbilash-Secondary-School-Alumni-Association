import { query } from '../db/pool.js';

/** Real dashboard numbers — every value is computed from the database. No fake data. */
export async function getOverview() {
  // NOTE: query() resolves to the ROW ARRAY, so destructure [{ alias }] (not [[{ alias }]]).
  const [{ total_users }] = await query(`SELECT COUNT(*) AS total_users FROM users WHERE is_active = 1`);
  const [{ pending }] = await query(`SELECT COUNT(*) AS pending FROM users WHERE status = 'pending'`);
  const [{ members }] = await query(
    `SELECT COUNT(*) AS members FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_name='MEMBER' AND u.is_active = 1`
  );
  const [{ admins }] = await query(
    `SELECT COUNT(*) AS admins FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_name='ADMIN' AND u.is_active = 1`
  );
  const [{ jobs }] = await query(`SELECT COUNT(*) AS jobs FROM jobs WHERE status = 'approved'`);
  const [{ events }] = await query(`SELECT COUNT(*) AS events FROM events WHERE status = 'published'`);
  const [{ visions }] = await query(`SELECT COUNT(*) AS visions FROM visions WHERE status = 'pending'`);
  const [{ helps }] = await query(`SELECT COUNT(*) AS helps FROM help_requests WHERE status IN ('open','in_progress')`);
  const [{ notices }] = await query(`SELECT COUNT(*) AS notices FROM notices WHERE status = 'published'`);
  const [{ gallery }] = await query(`SELECT COUNT(*) AS gallery FROM gallery WHERE status = 'approved'`);
  return { total_users, pending, members, admins, jobs, events, pending_visions: visions, open_help: helps, notices, gallery };
}

export async function getRecentActivity(limit = 20) {
  return query(`SELECT audit_id, actor_id, action, entity, entity_id, details, created_at FROM audit_logs ORDER BY audit_id DESC LIMIT ?`, [limit]);
}

/** Append an audit entry. Fire-and-forget: failures are logged, never thrown. */
export async function audit(actorId, action, entity, entityId, details = null) {
  try {
    await query(`INSERT INTO audit_logs (actor_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)`, [
      actorId,
      String(action).slice(0, 80),
      String(entity).slice(0, 50),
      entityId ?? null,
      details ? JSON.stringify(details) : null,
    ]);
  } catch (err) {
    console.error('[audit] failed:', err.code || '', err.message);
  }
}
