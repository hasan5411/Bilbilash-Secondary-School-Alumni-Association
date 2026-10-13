import { Router } from 'express';
import { listPending, listAll, approveUser, rejectUser, deactivateUser, promote, demote, removeUser, getMemberDetail } from '../controllers/userController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../services/statsService.js';

const router = Router();
router.use(authenticate);

router.get('/pending', requireRole('ADMIN'), listPending);
router.get('/', requireRole('ADMIN'), listAll);
router.put('/:id/approve', requireRole('ADMIN'), approveUser);
router.put('/:id/reject', requireRole('ADMIN'), rejectUser);
router.put('/:id/deactivate', requireRole('ADMIN'), deactivateUser);
router.delete('/:id', requireRole('ADMIN'), removeUser);
router.put('/:id/promote-admin', requireRole('AUTHORITY'), promote);
router.put('/:id/demote-admin', requireRole('AUTHORITY'), demote);

// Authority-only audit trail (separate mount path is /api/users/... but semantically admin)
router.get('/audit', requireRole('AUTHORITY'), async (req, res, next) => {
  try {
    const { getRecentActivity } = await import('../services/statsService.js');
    res.json({ success: true, data: { activity: await getRecentActivity(50) } });
  } catch (e) { next(e); }
});

// Admin/Authority: complete member information (declared after /audit so /audit still matches exactly)
router.get('/:id', requireRole('ADMIN'), getMemberDetail);

export default router;
