import { query, queryOne } from '../db/pool.js';
import { forbidden, notFound } from '../utils/errors.js';

const LIST_SELECT = `
  SELECT notification_id, title, message, type, related_entity_type, related_entity_id,
         actor_user_id, is_read, read_at, created_at
    FROM notifications`;

/**
 * List ONLY the current user's notifications (IDOR-safe: no user_id param accepted).
 * Paginated (default 20/page) with an optional All/Unread/Read filter.
 */
export async function listMyNotifications(userId, { limit = 20, offset = 0, filter = 'all' } = {}) {
  const limitInt = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const offsetInt = Math.max(Number(offset) || 0, 0);
  let where = 'WHERE recipient_id = ?';
  const params = [userId];
  if (filter === 'unread') where += ' AND is_read = 0';
  else if (filter === 'read') where += ' AND is_read = 1';

  const notifications = await query(
    `${LIST_SELECT} ${where} ORDER BY created_at DESC, notification_id DESC LIMIT ${limitInt} OFFSET ${offsetInt}`,
    params
  );
  const { total } = await queryOne(`SELECT COUNT(*) AS total FROM notifications ${where}`, params);
  return { notifications, total, limit: limitInt, offset: offsetInt };
}

export async function unreadCount(userId) {
  const row = await queryOne(`SELECT COUNT(*) AS cnt FROM notifications WHERE recipient_id = ? AND is_read = 0`, [userId]);
  return row.cnt;
}

export async function markRead(userId, notificationId) {
  const row = await queryOne(`SELECT recipient_id FROM notifications WHERE notification_id = ? LIMIT 1`, [notificationId]);
  if (!row) throw notFound('Notification not found');
  if (row.recipient_id !== userId) throw forbidden('Not your notification');
  await query(`UPDATE notifications SET is_read = 1, read_at = COALESCE(read_at, NOW()) WHERE notification_id = ?`, [notificationId]);
  return { notification_id: notificationId, is_read: 1 };
}

export async function markAllRead(userId) {
  await query(`UPDATE notifications SET is_read = 1, read_at = COALESCE(read_at, NOW()) WHERE recipient_id = ? AND is_read = 0`, [userId]);
  return { ok: true };
}

/** Delete one of the current user's notifications (ownership enforced). */
export async function removeOwnNotification(userId, notificationId) {
  const row = await queryOne(`SELECT recipient_id FROM notifications WHERE notification_id = ? LIMIT 1`, [notificationId]);
  if (!row) throw notFound('Notification not found');
  if (row.recipient_id !== userId) throw forbidden('Not your notification');
  await query(`DELETE FROM notifications WHERE notification_id = ?`, [notificationId]);
  return { notification_id: notificationId, deleted: true };
}

/** Delete ALL of the current user's READ notifications (never touches anyone else's rows). */
export async function removeReadNotifications(userId) {
  const res = await query(`DELETE FROM notifications WHERE recipient_id = ? AND is_read = 1`, [userId]);
  return { deleted: res.affectedRows || 0 };
}
