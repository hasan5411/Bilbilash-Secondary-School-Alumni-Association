import { searchDirectory, getPublicProfile } from '../services/directoryService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { parsePositiveId } from '../utils/validate.js';

/** GET /api/directory?name=&batch=&profession=&institute=&blood_group= — public. */
export const search = asyncHandler(async (req, res) => {
  const results = await searchDirectory(req.query);
  res.json({ success: true, data: { results } });
});

/** GET /api/directory/:id — public profile of an approved member (public fields only). */
export const publicProfile = asyncHandler(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'member id');
  const profile = await getPublicProfile(id);
  if (!profile) {
    res.status(404).json({ success: false, message: 'Member not found' });
    return;
  }
  res.json({ success: true, data: { profile } });
});
