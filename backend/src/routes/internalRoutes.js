import { Router } from 'express';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { expireOverdueRegistrations } from '../services/eventService.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/**
 * Internal, machine-only endpoints. NOT part of the public business API:
 * every request must present CRON_SECRET (Authorization: Bearer <secret> or
 * x-cron-secret), compared with crypto.timingSafeEqual. The secret is never
 * logged or returned. When CRON_SECRET is unset the endpoint is disabled (503).
 */
const router = Router();

function providedSecret(req) {
  const header = req.headers['x-cron-secret'];
  if (typeof header === 'string' && header) return header.trim();
  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return '';
}

function secretsMatch(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timingSafeEqual requires equal lengths; reject early without leaking which
  // part differed (the response is always the same 401).
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** POST /api/internal/registrations/expire — run the automatic expiry batch. */
router.post('/registrations/expire', asyncHandler(async (req, res) => {
  if (!env.cronSecret) {
    res.status(503).json({
      success: false,
      message: 'Registration expiry endpoint is disabled: CRON_SECRET is not configured.',
    });
    return;
  }
  if (!secretsMatch(providedSecret(req), env.cronSecret)) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }
  const limit = Number(req.query.limit || req.body?.limit || 200);
  const result = await expireOverdueRegistrations(limit);
  res.json({ success: true, data: result });
}));

export default router;
