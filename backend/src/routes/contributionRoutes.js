import { Router } from 'express';
import { mine, setMyRate, preview, memberReport, memberDetail, setMemberRate, setMemberStart } from '../controllers/contributionController.js';
import { authenticate, requireApproved, requireRole } from '../middleware/auth.js';

/*
 * /api/contributions — monthly contribution configuration + due reporting.
 *
 * Members (approved, rank >= MEMBER): their OWN rate, history and ledger only.
 * ADMIN/AUTHORITY: the member-wise report and per-member detail, and may set a
 * member's rate/start. Every rule is enforced here on the backend; the UI only
 * hides what the API already denies.
 */
const router = Router();
router.use(authenticate, requireApproved, requireRole('MEMBER'));

// Own data — identity always from req.user, never from the URL.
router.get('/mine', mine);
router.post('/mine/rate', setMyRate);
router.get('/preview', preview);

// Staff-only member-wise reporting and configuration.
router.get('/members', requireRole('ADMIN'), memberReport);
router.get('/members/:userId', requireRole('ADMIN'), memberDetail);
router.post('/members/:userId/rate', requireRole('ADMIN'), setMemberRate);
router.patch('/members/:userId/start', requireRole('ADMIN'), setMemberStart);

export default router;
