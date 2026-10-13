import { Router } from 'express';
import { list, unread, read, readAll, remove, removeRead } from '../controllers/notificationController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);
router.get('/', list);
router.get('/unread-count', unread);
router.put('/read-all', readAll);
router.put('/:id/read', read);
// NOTE: static '/read' MUST be registered before the parametric '/:id' so
// "read" is never parsed as a notification id.
router.delete('/read', removeRead);
router.delete('/:id', remove);

export default router;
