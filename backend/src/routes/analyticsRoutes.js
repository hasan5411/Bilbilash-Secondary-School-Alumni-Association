import { Router } from 'express';
import { financial, alumni, donors, help, community } from '../controllers/analyticsController.js';
import { authenticate, requireApproved, requireRole } from '../middleware/auth.js';

/*
 * /api/analytics — role-protected aggregate statistics.
 *
 * Access rule (matches the rest of the app, no new roles invented):
 *   1. authenticate    → a valid JWT (visitors never get past this: 401)
 *   2. requireApproved → account status must be 'approved' (pending/rejected
 *                        accounts get 403 even though they can log in)
 *   3. requireRole('MEMBER') → MEMBER, ADMIN or AUTHORITY (rank ≥ MEMBER)
 *
 * Every endpoint below therefore requires an approved member; hiding the navbar
 * link is only a convenience, this is the real enforcement.
 */
const router = Router();
router.use(authenticate, requireApproved, requireRole('MEMBER'));

router.get('/financial', financial);
router.get('/alumni', alumni);
router.get('/donors', donors);
router.get('/help', help);
router.get('/community', community);

export default router;
