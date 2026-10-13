import {
  getMemberLedger, setContributionRate, setContributionStart, getMembersDueReport,
  getAllocationPreview, MONTHLY_AMOUNTS,
} from '../services/contributionService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate, parsePositiveId } from '../utils/validate.js';
import { forbidden } from '../utils/errors.js';

/*
 * Contribution controllers. Identity always comes from the verified server-side
 * auth context (req.user) — a member can never act on another member through a
 * client-supplied id (staff-only routes enforce that server-side too).
 */

const MONTH_RE = { re: /^\d{4}-(0[1-9]|1[0-2])$/, message: 'effective_month must be YYYY-MM' };

/** GET /api/contributions/mine — own rate, history, start and full month ledger. */
export const mine = asyncHandler(async (req, res) => {
  const ledger = await getMemberLedger(req.user.user_id);
  res.json({
    success: true,
    data: {
      ...ledger,
      allowed_amounts: MONTHLY_AMOUNTS,
      configured: ledger.history.length > 0,
    },
  });
});

/** POST /api/contributions/mine/rate — set/update own monthly contribution. */
export const setMyRate = asyncHandler(async (req, res) => {
  const body = validate(req.body, {
    amount: { type: 'int', required: true, min: 1, max: 100000 },
    effective_month: { type: 'string', max: 7, pattern: MONTH_RE },
  });
  const result = await setContributionRate(req.user, req.user.user_id, {
    amount: body.amount,
    effectiveMonth: body.effective_month || undefined,
  });
  res.status(result.unchanged ? 200 : 201).json({
    success: true,
    message: result.unchanged
      ? 'That contribution rate is already effective from this month.'
      : `Monthly contribution set to ৳${Number(result.rate.amount)} from ${result.rate.effective_month}. Previous months keep their historical rates.`,
    data: { rate: result.rate },
  });
});

/**
 * GET /api/contributions/preview?amount=100[&user_id=] — how a payment would
 * settle dues (oldest first). Defaults to the caller's own allocation;
 * ADMIN/AUTHORITY may preview another member (the Payments page lets staff
 * pay on a member's behalf). Ordinary members can never query someone else.
 */
export const preview = asyncHandler(async (req, res) => {
  const q = validate(req.query, {
    amount: { type: 'int', required: true, min: 1, max: 1000000 },
    user_id: { type: 'int', min: 1 },
  });
  let targetId = req.user.user_id;
  if (q.user_id != null && Number(q.user_id) !== Number(req.user.user_id)) {
    const isStaff = req.user.role_name === 'ADMIN' || req.user.role_name === 'AUTHORITY';
    if (!isStaff) throw forbidden('You can only preview your own payment allocation');
    targetId = q.user_id;
  }
  const plan = await getAllocationPreview(targetId, q.amount);
  res.json({ success: true, data: plan });
});

/** GET /api/contributions/members — ADMIN/AUTHORITY member-wise due report. */
export const memberReport = asyncHandler(async (req, res) => {
  const q = validate(req.query, {
    search: { type: 'string', max: 100 },
    limit: { type: 'int', min: 1, max: 200 },
    offset: { type: 'int', min: 0 },
  });
  const report = await getMembersDueReport({ search: q.search ?? null, limit: q.limit, offset: q.offset });
  res.json({ success: true, data: report });
});

/** GET /api/contributions/members/:userId — ADMIN/AUTHORITY month-by-month detail. */
export const memberDetail = asyncHandler(async (req, res) => {
  const userId = parsePositiveId(req.params.userId, 'user id');
  const ledger = await getMemberLedger(userId);
  res.json({ success: true, data: ledger });
});

/** POST /api/contributions/members/:userId/rate — ADMIN/AUTHORITY sets a member's rate. */
export const setMemberRate = asyncHandler(async (req, res) => {
  const userId = parsePositiveId(req.params.userId, 'user id');
  const body = validate(req.body, {
    amount: { type: 'int', required: true, min: 1, max: 100000 },
    effective_month: { type: 'string', max: 7, pattern: MONTH_RE },
  });
  const result = await setContributionRate(req.user, userId, {
    amount: body.amount,
    effectiveMonth: body.effective_month || undefined,
  });
  res.status(result.unchanged ? 200 : 201).json({
    success: true,
    message: result.unchanged
      ? 'That contribution rate is already effective from this month.'
      : `Contribution rate set to ৳${Number(result.rate.amount)} from ${result.rate.effective_month}.`,
    data: { rate: result.rate },
  });
});

/** PATCH /api/contributions/members/:userId/start — ADMIN/AUTHORITY sets the obligation start. */
export const setMemberStart = asyncHandler(async (req, res) => {
  const userId = parsePositiveId(req.params.userId, 'user id');
  const body = validate(req.body, {
    contribution_start_month: { type: 'string', required: true, max: 7, pattern: MONTH_RE },
  });
  const result = await setContributionStart(req.user, userId, body.contribution_start_month);
  res.json({ success: true, message: `Contribution start set to ${result.contribution_start_month}.`, data: result });
});
