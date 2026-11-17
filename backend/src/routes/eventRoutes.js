import { Router } from 'express';
import {
  list, getOne, create, update, cancel, archive, remove, register, unregister,
  myRegistrations, registrations, participants, adminCancel, setTshirtSize,
} from '../controllers/eventController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireRole('ANY'));
router.get('/', list);
router.get('/mine/registrations', myRegistrations);
router.post('/', requireRole('ADMIN'), create);
router.put('/:id', requireRole('ADMIN'), update);
router.put('/:id/cancel', requireRole('ADMIN'), cancel);
router.put('/:id/archive', requireRole('ADMIN'), archive);
router.post('/:id/register', requireRole('MEMBER'), register);
router.delete('/:id/register', requireRole('MEMBER'), unregister);
// The member's own T-shirt size: ownership is taken from the JWT, never a body id.
router.put('/:id/tshirt-size', requireRole('MEMBER'), setTshirtSize);
router.delete('/:id', requireRole('ADMIN'), remove);
router.get('/:id', getOne);
// Registration management: ADMIN or AUTHORITY only (rank >= 3; MEMBER/VISITOR
// -> 403, anonymous -> 401 from authenticate above). Declared after
// '/mine/registrations' so that path keeps matching myRegistrations.
router.get('/:id/registrations', requireRole('ADMIN'), registrations);
router.get('/:id/participants', requireRole('ADMIN'), participants);
router.patch('/:id/registrations/:registrationId/cancel', requireRole('ADMIN'), adminCancel);

export default router;
