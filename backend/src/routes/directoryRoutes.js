import { Router } from 'express';
import { search, publicProfile } from '../controllers/directoryController.js';
import { authenticate, requireApproved } from '../middleware/auth.js';

const router = Router();
// Listing stays public for everyone (Visitors included).
router.get('/', search);
// Full profile details: approved members only (Members, Admins, Authority).
router.get('/:id', authenticate, requireApproved, publicProfile);

export default router;
