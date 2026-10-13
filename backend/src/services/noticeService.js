import { query, queryOne } from '../db/pool.js';
import { notFound } from '../utils/errors.js';
import { notifyCommunity, NOTIFICATION_TYPES } from './notificationService.js';

export async function listNotices(user) {
  const isAdmin = user && (user.role_name === 'ADMIN' || user.role_name === 'AUTHORITY');
  return isAdmin
    ? query(`SELECT n.*, u.first_name, u.last_name FROM notices n JOIN users u ON u.user_id = n.created_by ORDER BY n.created_at DESC LIMIT 200`)
    : query(
        `SELECT n.*, u.first_name, u.last_name FROM notices n JOIN users u ON u.user_id = n.created_by
          WHERE n.status = 'published' ORDER BY COALESCE(n.published_at, n.created_at) DESC LIMIT 200`
      );
}

export async function createNotice(user, data) {
  const res = await query(
    `INSERT INTO notices (created_by, title, body, status, published_at) VALUES (?, ?, ?, 'published', NOW())
     RETURNING notice_id`,
    [user.user_id, data.title, data.body]
  );
  // Notices publish instantly — fan out to the whole community (the author
  // already knows they wrote it and is excluded by actorId).
  await notifyCommunity({
    actorId: user.user_id,
    type: NOTIFICATION_TYPES.NEW_NOTICE,
    title: 'New notice published',
    message: `A new community notice has been published: "${data.title}".`,
    entityType: 'notice',
    entityId: res.insertId,
  });
  return { notice_id: res.insertId, status: 'published' };
}

export async function archiveNotice(noticeId) {
  const row = await queryOne(`SELECT notice_id FROM notices WHERE notice_id = ? LIMIT 1`, [noticeId]);
  if (!row) throw notFound('Notice not found');
  await query(`UPDATE notices SET status = 'archived' WHERE notice_id = ?`, [noticeId]);
  return { notice_id: noticeId, status: 'archived' };
}

/** ADMIN/AUTHORITY: hard-delete a notice. Notifications that link to it are
 * cleaned up best-effort so members never see a dead link. */
export async function deleteNotice(noticeId) {
  const row = await queryOne(`SELECT notice_id, title FROM notices WHERE notice_id = ? LIMIT 1`, [noticeId]);
  if (!row) throw notFound('Notice not found');
  await query(`DELETE FROM notices WHERE notice_id = ?`, [noticeId]);
  try {
    await query(`DELETE FROM notifications WHERE related_entity_type = 'notice' AND related_entity_id = ?`, [noticeId]);
  } catch { /* best-effort: notifications are not the record of truth */ }
  return { notice_id: noticeId, deleted: true };
}
