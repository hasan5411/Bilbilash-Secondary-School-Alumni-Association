import { searchDirectory, getPublicProfile } from '../services/directoryService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { parsePositiveId } from '../utils/validate.js';

/** GET /api/directory?name=&batch=&profession=&institute=&address=&blood_group=&limit=&offset= — public.
 *  `institute` matches company/institute, college or university; `address` matches
 *  the present address only (never returned in results). Results are paged
 *  (`limit` default 24, max 100) and return `total` + `has_more`. */
export const search = asyncHandler(async (req, res) => {
  const data = await searchDirectory(req.query);
  res.json({ success: true, data });
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
