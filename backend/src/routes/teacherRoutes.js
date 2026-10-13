import { Router } from 'express';
import { list, getOne, create, update, remove } from '../controllers/teacherController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

// Public read
router.get('/', list);
router.get('/:id', getOne);

router.use(authenticate, requireRole('ADMIN'));
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', remove);

export default router;
