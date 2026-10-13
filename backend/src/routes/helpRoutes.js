import { Router } from 'express';
import { list, create, setStatus, remove } from '../controllers/helpController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireRole('ANY'));
router.get('/', list);
router.post('/', requireRole('MEMBER'), create);
router.put('/:id/status', setStatus);
router.delete('/:id', requireRole('ADMIN'), remove);

export default router;
