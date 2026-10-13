import { Router } from 'express';
import { summary, search } from '../controllers/bloodController.js';

const router = Router();
router.get('/summary', summary);
router.get('/search', search);

export default router;
