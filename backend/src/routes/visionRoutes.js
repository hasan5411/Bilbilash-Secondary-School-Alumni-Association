import { Router } from 'express';
import { list, create, moderate, remove } from '../controllers/visionController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireRole('ANY'));
router.get('/', list);
router.post('/', requireRole('MEMBER'), create);
router.put('/:id/moderate', requireRole('ADMIN'), moderate);
router.delete('/:id', requireRole('ADMIN'), remove);

export default router;
