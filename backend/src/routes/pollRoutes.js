import { Router } from 'express';
import { list, create, close, remove, voters, vote } from '../controllers/pollController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireRole('ANY'));
router.get('/', list);
router.post('/', requireRole('ADMIN'), create);
router.put('/:id/close', requireRole('ADMIN'), close);
router.get('/:id/voters', requireRole('ADMIN'), voters);
router.delete('/:id', requireRole('ADMIN'), remove);
router.post('/:id/vote', requireRole('MEMBER'), vote);

export default router;
