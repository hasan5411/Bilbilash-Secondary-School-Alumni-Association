import {
  findMemberByRegNumber, getMonthlyStatus, createTestPayment,
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
 * POST /api/payments/manual — submit a MANUAL bKash/Nagad/Rocket payment.
 * multipart/form-data: registration_number, payment_type (monthly|occasional),
 * payment_method (bkash|nagad|rocket), amount, billing_month (monthly) or
 * purpose (+ optional event_id, description) (occasional), transaction_id,
 * optional sender_number, optional image (payment screenshot).
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
 * GET /api/payments/lookup/:regNumber — resolve a member by registration number.
 * Privacy: members may only resolve their OWN registration number (the payment
 * UI pre-fills the payer); admins/authority may resolve anyone. Same message
 * as an unknown number so reg-number enumeration cannot confirm existence.
 */
export const lookup = asyncHandler(async (req, res) => {
  const member = await findMemberByRegNumber(req.params.regNumber);
  const isStaff = req.user.role_name === 'ADMIN' || req.user.role_name === 'AUTHORITY';
  if (!isStaff && Number(member.user_id) !== Number(req.user.user_id)) {
    const err = new Error('Invalid registration number. Please check your registration number.');
    err.status = 404;
    throw err;
  }
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
 * Body: { registration_number, payment_type: monthly|occasional, ... }
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
