import { Router } from 'express';
import { list, getOne, create, update, close, moderate, remove, apply, myApplications, applicationsForJob, setApplicationStatus } from '../controllers/jobController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticate, requireRole('ANY'), list);
router.get('/mine/applications', authenticate, requireRole('ANY'), myApplications);
router.post('/', authenticate, requireRole('MEMBER'), create);
router.put('/:id', authenticate, requireRole('MEMBER'), update);
router.put('/:id/close', authenticate, requireRole('MEMBER'), close);
router.post('/:id/apply', authenticate, requireRole('MEMBER'), apply);
router.get('/:id/applications', authenticate, requireRole('ANY'), applicationsForJob);
router.put('/applications/:appId/status', authenticate, requireRole('MEMBER'), setApplicationStatus);
router.put('/:id/moderate', authenticate, requireRole('ADMIN'), moderate);
router.delete('/:id', authenticate, requireRole('ADMIN'), remove);
router.get('/:id', authenticate, requireRole('ANY'), getOne);

export default router;
