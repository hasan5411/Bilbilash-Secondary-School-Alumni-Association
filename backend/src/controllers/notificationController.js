import {
  listMyNotifications, unreadCount, markRead, markAllRead, removeOwnNotification, removeReadNotifications,
} from '../services/notificationDataService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { parsePositiveId } from '../utils/validate.js';

/**
 * All handlers derive the recipient from req.user (JWT + DB reload) — never
 * from a client-supplied user_id, so users can only ever touch their own rows.
 */
export const list = asyncHandler(async (req, res) => {
  const filter = ['all', 'unread', 'read'].includes(req.query.filter) ? req.query.filter : 'all';
  const [data, unread] = await Promise.all([
    listMyNotifications(req.user.user_id, { limit: req.query.limit, offset: req.query.offset, filter }),
    unreadCount(req.user.user_id),
  ]);
  res.json({ success: true, data: { ...data, unread } });
});

export const unread = asyncHandler(async (req, res) => {
  const count = await unreadCount(req.user.user_id);
  res.json({ success: true, data: { count } });
});

export const read = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'notification id');
  const result = await markRead(req.user.user_id, id);
  res.json({ success: true, message: 'Marked as read', data: result });
});

export const readAll = asyncHandler(async (req, res) => {
  const result = await markAllRead(req.user.user_id);
  res.json({ success: true, message: 'All notifications marked as read', data: result });
});

export const remove = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'notification id');
  const result = await removeOwnNotification(req.user.user_id, id);
  res.json({ success: true, message: 'Notification deleted', data: result });
});

export const removeRead = asyncHandler(async (req, res) => {
  const result = await removeReadNotifications(req.user.user_id);
  res.json({ success: true, message: `${result.deleted} read notification(s) deleted`, data: result });
});
