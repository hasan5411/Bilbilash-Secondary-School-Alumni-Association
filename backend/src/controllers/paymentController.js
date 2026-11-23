import {
  getSelfMember, getMonthlyStatus, createTestPayment,
  listMyPayments, listAllPayments, getMemberPaymentSummary,
  submitManualPayment, reviewPayment, listProviderInfo,
} from '../services/paymentService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { parsePositiveId, validate } from '../utils/validate.js';

/** GET /api/payments/providers — manual provider info (number, instructions, app link) for the payment UI. */
export const providers = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { providers: listProviderInfo() } });
});

/**
 * POST /api/payments/manual — submit a MANUAL bKash/Nagad/Rocket/bank payment.
 * multipart/form-data: payment_type (monthly|occasional), payment_method,
 * amount, billing_month (monthly) or purpose (+ optional event_id, description)
 * (occasional), transaction_id, optional sender_number, optional image.
 * The payer is always the logged-in member — no registration number and no
 * paying on behalf of someone else.
 * ALWAYS creates a PENDING payment — a submission is never an instant success;
 * an admin/authority must verify the Transaction ID.
 */
export const submitManual = asyncHandler(async (req, res) => {
  const payment = await submitManualPayment(req.user, req.body || {}, req.file || null);
  res.status(201).json({
    success: true,
    message: 'Payment submitted successfully. Your payment is waiting for verification.',
    data: { payment },
  });
});

/** PATCH /api/payments/:id/review — ADMIN/AUTHORITY: approve ('success') or reject a pending payment. */
export const review = asyncHandler(async (req, res) => {
  const body = validate(req.body, {
    status: { type: 'enum', values: ['success', 'rejected'], required: true },
    note: { type: 'string', max: 255 },
  });
  const payment = await reviewPayment(req.user, parsePositiveId(req.params.id, 'payment id'), body);
  res.json({
    success: true,
    message: body.status === 'success' ? 'Payment approved.' : 'Payment rejected.',
    data: { payment },
  });
});

/**
 * GET /api/payments/me — the logged-in member's own payment record.
 * Identity comes from the token; no registration number lookup.
 */
export const me = asyncHandler(async (req, res) => {
  const member = await getSelfMember(req.user.user_id);
  res.json({ success: true, data: { member } });
});

/** GET /api/payments/monthly-status?user_id=123 — own by default; admins may query others. */
export const monthlyStatus = asyncHandler(async (req, res) => {
  const isStaff = req.user.role_name === 'ADMIN' || req.user.role_name === 'AUTHORITY';
  const requested = req.query.user_id ? Number(req.query.user_id) : req.user.user_id;
  if (!isStaff && Number(requested) !== Number(req.user.user_id)) {
    const err = new Error('You can only view your own monthly status');
    err.status = 403;
    throw err;
  }
  const status = await getMonthlyStatus(requested);
  res.json({ success: true, data: status });
});

/**
 * POST /api/payments — record a TEST payment.
 * Body: { payment_type: monthly|occasional, ... }. Always recorded for the
 * logged-in account itself.
 * The simulated charge only happens after the client's explicit confirm step.
 */
export const create = asyncHandler(async (req, res) => {
  const payment = await createTestPayment(req.user, req.body || {});
  res.status(201).json({ success: true, message: 'Test payment recorded', data: { payment } });
});

/** GET /api/payments/mine — strictly own history (ownership from token, never the URL). */
export const mine = asyncHandler(async (req, res) => {
  const result = await listMyPayments(req.user.user_id);
  res.json({ success: true, data: result });
});

/** GET /api/payments — ADMIN/AUTHORITY: all payments with search/filter/pagination. */
export const listAll = asyncHandler(async (req, res) => {
  const result = await listAllPayments(req.query);
  res.json({ success: true, data: result });
});

/** GET /api/payments/summary/:userId — ADMIN/AUTHORITY: per-member payment summary. */
export const memberSummary = asyncHandler(async (req, res) => {
  const summary = await getMemberPaymentSummary(parsePositiveId(req.params.userId, 'user id'));
  res.json({ success: true, data: summary });
});
