import { Router } from 'express';
import { list, getOne, create, update, cancel, remove, register, unregister, myRegistrations } from '../controllers/eventController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireRole('ANY'));
router.get('/', list);
router.get('/mine/registrations', myRegistrations);
router.post('/', requireRole('ADMIN'), create);
router.put('/:id', requireRole('ADMIN'), update);
router.put('/:id/cancel', requireRole('ADMIN'), cancel);
router.post('/:id/register', requireRole('MEMBER'), register);
router.delete('/:id/register', requireRole('MEMBER'), unregister);
router.delete('/:id', requireRole('ADMIN'), remove);
router.get('/:id', getOne);

export default router;
