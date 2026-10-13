import { query, queryOne } from '../db/pool.js';
import { badRequest, notFound } from '../utils/errors.js';
import { removeUpload } from '../storage.js';
import { notify, notifyModerators, NOTIFICATION_TYPES } from './notificationService.js';

export async function listGallery(user) {
  const isAdmin = user && (user.role_name === 'ADMIN' || user.role_name === 'AUTHORITY');
  return isAdmin
    ? query(
        `SELECT g.gallery_id, g.image_path, g.caption, g.status, g.created_at, u.first_name, u.last_name
           FROM gallery g JOIN users u ON u.user_id = g.uploaded_by ORDER BY g.created_at DESC LIMIT 200`
      )
    : query(
        `SELECT g.gallery_id, g.image_path, g.caption, g.status, g.created_at, u.first_name, u.last_name
           FROM gallery g JOIN users u ON u.user_id = g.uploaded_by
          WHERE g.status = 'approved' ORDER BY g.created_at DESC LIMIT 200`
      );
}

export async function submitGalleryItem(user, filename, caption) {
  const res = await query(
    `INSERT INTO gallery (uploaded_by, image_path, caption, status) VALUES (?, ?, ?, 'pending')
     RETURNING gallery_id`,
    [user.user_id, filename, caption || null]
  );
  await notifyModerators({
    actorId: user.user_id,
    type: NOTIFICATION_TYPES.GALLERY_PENDING,
    title: 'New gallery submission',
    message: `${user.first_name} ${user.last_name} submitted an image for approval.`,
    entityType: 'gallery',
    entityId: res.insertId,
  });
  return { gallery_id: res.insertId, status: 'pending' };
}

export async function moderateGalleryItem(actor, galleryId, action) {
  const map = { approve: 'approved', reject: 'rejected' };
  const status = map[action];
  if (!status) throw badRequest('Unknown action');
  const item = await queryOne(`SELECT gallery_id, uploaded_by, image_path, caption FROM gallery WHERE gallery_id = ? LIMIT 1`, [galleryId]);
  if (!item) throw notFound('Gallery item not found');
  await query(`UPDATE gallery SET status = ?, moderated_by = ? WHERE gallery_id = ?`, [status, actor.user_id, galleryId]);
  if (status === 'approved') {
    await notify(item.uploaded_by, 'Image approved', `Your gallery image${item.caption ? ` "${item.caption}"` : ''} has been approved.`, NOTIFICATION_TYPES.GALLERY_APPROVED, { entityType: 'gallery', entityId: galleryId, actorId: actor.user_id });
  } else {
    await notify(item.uploaded_by, 'Image rejected', `Your gallery image${item.caption ? ` "${item.caption}"` : ''} was not approved.`, NOTIFICATION_TYPES.GALLERY_REJECTED, { entityType: 'gallery', entityId: galleryId, actorId: actor.user_id });
  }
  return { gallery_id: galleryId, status, image_path: item.image_path };
}

export async function deleteGalleryItem(galleryId) {
  const item = await queryOne(`SELECT gallery_id, image_path FROM gallery WHERE gallery_id = ? LIMIT 1`, [galleryId]);
  if (!item) throw notFound('Gallery item not found');
  await query(`DELETE FROM gallery WHERE gallery_id = ?`, [galleryId]);
  // Remove the stored image (local file or cloud object) — best-effort.
  await removeUpload(item.image_path);
  return { gallery_id: galleryId, deleted: true };
}
