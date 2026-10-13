import { query, queryOne } from '../db/pool.js';
import { badRequest, notFound } from '../utils/errors.js';
import { notify, notifyCommunity, NOTIFICATION_TYPES } from './notificationService.js';

export async function listHelpRequests(user) {
  const isAdmin = user && (user.role_name === 'ADMIN' || user.role_name === 'AUTHORITY');
  return isAdmin
    ? query(`SELECT h.*, u.first_name, u.last_name FROM help_requests h JOIN users u ON u.user_id = h.user_id ORDER BY h.created_at DESC LIMIT 200`)
    : query(
        `SELECT h.*, u.first_name, u.last_name FROM help_requests h JOIN users u ON u.user_id = h.user_id
          WHERE h.status <> 'closed' OR h.user_id = ? ORDER BY h.created_at DESC LIMIT 200`,
        [user.user_id]
      );
}

export async function createHelpRequest(user, data) {
  const res = await query(
    `INSERT INTO help_requests (user_id, title, description, category, urgency, blood_group, location, required_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING help_id`,
    [user.user_id, data.title, data.description, data.category, data.urgency, data.blood_group ?? null, data.location ?? null, data.required_date ?? null]
  );
  // This system has NO help-approval workflow — requests are open immediately,
  // so this is a community notification (admins/authority are members too).
  // Blood emergencies say so in the message; the existing notification
  // architecture (type NEW_HELP) is reused unchanged.
  const bloodPrefix = data.category === 'blood' ? '🩸 BLOOD REQUEST' : '';
  const urgencySuffix = data.urgency === 'emergency' ? ' — 🚨 EMERGENCY' : '';
  await notifyCommunity({
    actorId: user.user_id,
    type: NOTIFICATION_TYPES.NEW_HELP,
    title: 'New help request',
    message: `${bloodPrefix ? bloodPrefix + ': ' : ''}${user.first_name} ${user.last_name} needs help: "${data.title}"${urgencySuffix}.`,
    entityType: 'help',
    entityId: res.insertId,
  });
  return { help_id: res.insertId, status: 'open' };
}

/** ADMIN/AUTHORITY: hard-delete a help request (no child rows; member's own
 * notifications that link to it are cleaned up best-effort). */
export async function deleteHelpRequest(helpId) {
  const row = await queryOne(`SELECT help_id, title FROM help_requests WHERE help_id = ? LIMIT 1`, [helpId]);
  if (!row) throw notFound('Help request not found');
  await query(`DELETE FROM help_requests WHERE help_id = ?`, [helpId]);
  try {
    await query(`DELETE FROM notifications WHERE related_entity_type = 'help' AND related_entity_id = ?`, [helpId]);
  } catch { /* best-effort */ }
  return { help_id: helpId, deleted: true };
}

export async function updateHelpStatus(helpId, status, user) {
  if (!['open', 'in_progress', 'resolved', 'closed'].includes(status)) throw badRequest('Unknown status');
  const row = await queryOne(`SELECT user_id, title FROM help_requests WHERE help_id = ? LIMIT 1`, [helpId]);
  if (!row) throw notFound('Help request not found');
  const isAdmin = user.role_name === 'ADMIN' || user.role_name === 'AUTHORITY';
  const isOwner = row.user_id === user.user_id;
  if (!isAdmin && !(isOwner && ['resolved', 'closed'].includes(status))) {
    const err = new Error('Not allowed to change this status');
    err.status = 403;
    throw err;
  }
  await query(`UPDATE help_requests SET status = ? WHERE help_id = ?`, [status, helpId]);
  // Tell the owner when someone else (i.e. an admin) moved their request —
  // never notify members about status changes they made themself.
  if (!isOwner) {
    await notify(
      row.user_id,
      'Help request update',
      `Your help request "${row.title}" is now: ${String(status).replace('_', ' ')}.`,
      NOTIFICATION_TYPES.HELP_STATUS,
      { entityType: 'help', entityId: helpId, actorId: user.user_id }
    );
  }
  return { help_id: helpId, status };
}
