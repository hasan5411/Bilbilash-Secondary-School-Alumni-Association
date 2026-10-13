import {
  getFinancialAnalytics, getAlumniAnalytics, getDonorAnalytics,
  getHelpAnalytics, getCommunityAnalytics,
} from '../services/analyticsService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../utils/validate.js';

/*
 * Analytics controllers. Every endpoint is mounted behind
 * authenticate → requireApproved → requireRole('MEMBER') (see analyticsRoutes),
 * so visitors, pending/rejected accounts and unauthenticated callers never reach
 * this code (401/403). Responses contain AGGREGATES ONLY: counts and sums —
 * never user IDs, names, contact details, transaction IDs or descriptions.
 *
 * Only the verified server-side identity (req.user) is used for visibility
 * decisions; nothing the client sends can widen access.
 */

const filterRules = {
  year: { type: 'int', min: 2000, max: 2100 },
  month: { type: 'int', min: 1, max: 12 },
};

/** GET /api/analytics/financial?year=YYYY&month=M */
export const financial = asyncHandler(async (req, res) => {
  const f = validate(req.query, filterRules);
  // A month only makes sense inside a year: default it to the current year so
  // the month filter cannot silently mix October of several years.
  const year = f.year ?? (f.month ? new Date().getFullYear() : null);
  const data = await getFinancialAnalytics({ year, month: f.month ?? null }, req.user);
  res.json({ success: true, data });
});

/** GET /api/analytics/alumni?year=YYYY — year only windows the growth chart. */
export const alumni = asyncHandler(async (req, res) => {
  const f = validate(req.query, filterRules);
  const data = await getAlumniAnalytics({ year: f.year ?? null }, req.user);
  res.json({ success: true, data });
});

/** GET /api/analytics/donors — point-in-time snapshot, no date filter. */
export const donors = asyncHandler(async (_req, res) => {
  const data = await getDonorAnalytics();
  res.json({ success: true, data });
});

/** GET /api/analytics/help?year=YYYY */
export const help = asyncHandler(async (req, res) => {
  const f = validate(req.query, filterRules);
  const data = await getHelpAnalytics({ year: f.year ?? null }, req.user);
  res.json({ success: true, data });
});

/** GET /api/analytics/community?year=YYYY&poll_id=N */
export const community = asyncHandler(async (req, res) => {
  const f = validate(req.query, { ...filterRules, poll_id: { type: 'int', min: 1 } });
  const data = await getCommunityAnalytics({ year: f.year ?? null, poll_id: f.poll_id ?? null }, req.user);
  res.json({ success: true, data });
});
