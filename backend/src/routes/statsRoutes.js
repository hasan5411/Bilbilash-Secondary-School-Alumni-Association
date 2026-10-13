import { Router } from 'express';
import { overview } from '../controllers/statsController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();
router.get('/overview', authenticate, requireRole('ADMIN'), overview);

export default router;
