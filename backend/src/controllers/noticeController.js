import { listNotices, createNotice, archiveNotice, deleteNotice } from '../services/noticeService.js';
import { audit } from '../services/statsService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate, parsePositiveId } from '../utils/validate.js';

export const list = asyncHandler(async (req, res) => {
  const notices = await listNotices(req.user || null);
  res.json({ success: true, data: { notices } });
});

export const create = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    title: { type: 'string', required: true, max: 150 },
    body: { type: 'string', required: true, max: 5000 },
  });
  const result = await createNotice(req.user, data);
  res.status(201).json({ success: true, message: 'Notice published', data: result });
});

export const archive = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'notice id');
  const result = await archiveNotice(id);
  res.json({ success: true, message: 'Notice archived', data: result });
});

export const remove = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'notice id');
  const result = await deleteNotice(id);
  audit(req.user.user_id, 'DELETE_NOTICE', 'notices', id, { by_role: req.user.role_name });
  res.json({ success: true, message: 'Notice deleted', data: result });
});
