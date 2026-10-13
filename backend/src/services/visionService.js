import { query, queryOne } from '../db/pool.js';
import { badRequest, notFound } from '../utils/errors.js';
import { notify, notifyCommunity, notifyModerators, NOTIFICATION_TYPES } from './notificationService.js';

export async function listVisions(user) {
  const isAdmin = user && (user.role_name === 'ADMIN' || user.role_name === 'AUTHORITY');
  const rows = isAdmin
    ? await query(`SELECT v.*, u.first_name, u.last_name FROM visions v JOIN users u ON u.user_id = v.user_id ORDER BY v.created_at DESC LIMIT 200`)
    : await query(
        `SELECT v.*, u.first_name, u.last_name FROM visions v JOIN users u ON u.user_id = v.user_id
          WHERE v.status = 'approved' OR v.user_id = ? ORDER BY v.created_at DESC LIMIT 200`,
        [user.user_id]
      );
  return rows;
}

export async function createVision(user, data) {
  const res = await query(
    `INSERT INTO visions (user_id, title, description, category) VALUES (?, ?, ?, ?)
     RETURNING vision_id`,
    [user.user_id, data.title, data.description, data.category]
  );
  await notifyModerators({
    actorId: user.user_id,
    type: NOTIFICATION_TYPES.VISION_PENDING,
    title: 'New vision submission',
    message: `${user.first_name} ${user.last_name} submitted a Vision & Idea: "${data.title}".`,
    entityType: 'vision',
    entityId: res.insertId,
  });
  return { vision_id: res.insertId, status: 'pending' };
}

/** ADMIN/AUTHORITY: hard-delete a vision & idea (no child rows; community and
 * owner notifications that link to it are cleaned up best-effort). */
export async function deleteVision(visionId) {
  const row = await queryOne(`SELECT vision_id, title FROM visions WHERE vision_id = ? LIMIT 1`, [visionId]);
  if (!row) throw notFound('Vision not found');
  await query(`DELETE FROM visions WHERE vision_id = ?`, [visionId]);
  try {
    await query(`DELETE FROM notifications WHERE related_entity_type = 'vision' AND related_entity_id = ?`, [visionId]);
  } catch { /* best-effort */ }
  return { vision_id: visionId, deleted: true };
}

export async function moderateVision(actor, visionId, action) {
  const map = { approve: 'approved', reject: 'rejected', implement: 'implemented' };
  const status = map[action];
  if (!status) throw badRequest('Unknown action');
  const vision = await queryOne(`SELECT vision_id, user_id, title FROM visions WHERE vision_id = ? LIMIT 1`, [visionId]);
  if (!vision) throw notFound('Vision not found');
  await query(`UPDATE visions SET status = ? WHERE vision_id = ?`, [status, visionId]);
  if (action === 'approve') {
    await notify(vision.user_id, 'Vision published', `Your Vision & Idea "${vision.title}" has been approved.`, NOTIFICATION_TYPES.VISION_APPROVED, { entityType: 'vision', entityId: visionId, actorId: actor.user_id });
    await notifyCommunity({
      actorId: vision.user_id,
      type: NOTIFICATION_TYPES.NEW_VISION,
      title: 'New vision & idea',
      message: `A new Vision & Idea "${vision.title}" has been published.`,
      entityType: 'vision',
      entityId: visionId,
    });
  } else if (action === 'reject') {
    await notify(vision.user_id, 'Vision rejected', `Your Vision & Idea "${vision.title}" was not approved.`, NOTIFICATION_TYPES.VISION_REJECTED, { entityType: 'vision', entityId: visionId, actorId: actor.user_id });
  } else {
    await notify(vision.user_id, 'Vision implemented', `Your Vision & Idea "${vision.title}" has been marked as implemented.`, NOTIFICATION_TYPES.VISION_IMPLEMENTED, { entityType: 'vision', entityId: visionId, actorId: actor.user_id });
  }
  return { vision_id: visionId, status };
}
