import { Router } from 'express';
import { register, loginHandler, me, logout, forgotPassword, verifyOtp, resetPasswordHandler, changePasswordHandler } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/register', register);
router.post('/login', loginHandler);
router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyOtp);
router.post('/reset-password', resetPasswordHandler);
router.get('/me', authenticate, me);
router.post('/logout', authenticate, logout);
router.post('/change-password', authenticate, changePasswordHandler);

export default router;
