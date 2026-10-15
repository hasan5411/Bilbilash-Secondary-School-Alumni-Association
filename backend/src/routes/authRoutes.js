import { Router } from 'express';
import { register, loginHandler, me, logout, forgotPassword, verifyOtp, resetPasswordHandler, changePasswordHandler } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { authRateLimit } from '../middleware/rateLimit.js';

const router = Router();

// Registration stays unlimited: every account it creates is pending until an
// admin approves it, and the project's own tooling (seed-demo) registers a
// whole demo cohort from one address. The four anonymous credential endpoints
// below are throttled — failures per (ip + email) and attempts per ip.
router.post('/register', register);
router.post('/login', authRateLimit('login'), loginHandler);
router.post('/forgot-password', authRateLimit('forgot'), forgotPassword);
router.post('/verify-otp', authRateLimit('verify-otp'), verifyOtp);
router.post('/reset-password', authRateLimit('reset-password'), resetPasswordHandler);
router.get('/me', authenticate, me);
router.post('/logout', authenticate, logout);
router.post('/change-password', authenticate, changePasswordHandler);

export default router;
