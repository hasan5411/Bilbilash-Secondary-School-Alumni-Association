import { searchByBloodGroup, bloodGroupSummary } from '../services/bloodService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { BLOOD_GROUPS } from '../utils/validate.js';

export const summary = asyncHandler(async (_req, res) => {
  const summary = await bloodGroupSummary();
  res.json({ success: true, data: { summary } });
});

export const search = asyncHandler(async (req, res) => {
  const bg = String(req.query.blood_group || '').trim();
  if (!BLOOD_GROUPS.includes(bg)) {
    res.status(422).json({ success: false, message: 'blood_group must be one of: ' + BLOOD_GROUPS.join(', ') });
    return;
  }
  const results = await searchByBloodGroup(bg);
  res.json({ success: true, data: { results } });
});
