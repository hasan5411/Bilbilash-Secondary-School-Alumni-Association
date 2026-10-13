import { getOverview } from '../services/statsService.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const overview = asyncHandler(async (_req, res) => {
  const stats = await getOverview();
  res.json({ success: true, data: { stats } });
});
