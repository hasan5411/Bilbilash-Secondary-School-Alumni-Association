import { Router } from 'express';
import { lookup, monthlyStatus, create, mine, listAll, memberSummary, providers, submitManual, review } from '../controllers/paymentController.js';
import { authenticate, requireApproved, requireRole } from '../middleware/auth.js';
import { uploadImageMiddleware } from '../middleware/upload.js';

const router = Router();
router.use(authenticate, requireRole('ANY'));

// Static segments first so :id-style params never shadow them.
// Member-facing financial surfaces require APPROVED status (same policy as
// /api/contributions/*): pending/visitor accounts must not record payments or
// read due/payment data — authorization is enforced here in the backend.
router.get('/lookup/:regNumber', requireApproved, lookup);
router.get('/monthly-status', requireApproved, monthlyStatus);
router.get('/mine', requireApproved, mine);
router.get('/providers', requireApproved, providers);

// Manual bKash/Nagad/Rocket submission (multipart, optional screenshot).
// Only approved members submit; the row is created as PENDING — review is a
// separate ADMIN/AUTHORITY step (rank ≥ ADMIN covers AUTHORITY too).
router.post('/manual', requireApproved, uploadImageMiddleware, submitManual);
router.patch('/:id/review', requireRole('ADMIN'), review);

// Legacy/simulated TEST payment flow (dev + smoke suite) — unchanged.
router.post('/', requireApproved, create);
router.get('/summary/:userId', requireRole('ADMIN'), memberSummary);
router.get('/', requireRole('ADMIN'), listAll);

export default router;
