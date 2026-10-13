import { listVisions, createVision, moderateVision, deleteVision } from '../services/visionService.js';
import { audit } from '../services/statsService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate, parsePositiveId } from '../utils/validate.js';

export const list = asyncHandler(async (req, res) => {
  const visions = await listVisions(req.user || null);
  res.json({ success: true, data: { visions } });
});

export const create = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    title: { type: 'string', required: true, max: 150 },
    description: { type: 'string', required: true, max: 5000 },
    category: { type: 'enum', values: ['education', 'welfare', 'event', 'infrastructure', 'other'], default: 'other' },
  });
  const result = await createVision(req.user, data);
  res.status(201).json({ success: true, message: 'Idea submitted for moderation', data: result });
});

export const moderate = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'vision id');
  const data = validate(req.body, { action: { type: 'enum', values: ['approve', 'reject', 'implement'], required: true } });
  const result = await moderateVision(req.user, id, data.action);
  res.json({ success: true, message: `Idea ${data.action}d`, data: result });
});

export const remove = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'vision id');
  const result = await deleteVision(id);
  audit(req.user.user_id, 'DELETE_VISION', 'visions', id, { by_role: req.user.role_name });
  res.json({ success: true, message: 'Idea deleted', data: result });
});
