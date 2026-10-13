import { signToken } from '../utils/jwt.js';
import { publicUser, registerUser, findById } from '../services/userService.js';
import { login, createPasswordReset, verifyResetOtp, resetPassword, changePassword } from '../services/authService.js';
import { validate } from '../utils/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/** POST /api/auth/register — public. Always creates a pending VISITOR. */
export const register = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    first_name: { type: 'string', required: true, max: 60 },
    last_name: { type: 'string', required: true, max: 60 },
    email: { type: 'string', required: true, max: 120, email: true },
    password: { type: 'string', required: true, min: 8, max: 72 },
    phone: { type: 'string', max: 20 },
    registration_number: { type: 'string', required: true, max: 50 },
    ssc_batch: { type: 'int', min: 1960, max: 2100 },
    blood_group: { type: 'enum', values: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
    profession: { type: 'string', max: 120 },
    institute: { type: 'string', max: 120 },
    present_address: { type: 'string', required: true, max: 255 },
    permanent_address: { type: 'string', required: true, max: 255 },
  });
  await registerUser(data);
  res.status(201).json({
    success: true,
    message: 'Registration successful! Your account is pending admin approval.',
    data: { email: data.email },
  });
});

/** POST /api/auth/login — public. Returns JWT + DB-backed user. */
export const loginHandler = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    email: { type: 'string', required: true, max: 120, email: true },
    password: { type: 'string', required: true, max: 72 },
  });
  const user = await login(data.email, data.password);
  const token = signToken(user);
  res.json({ success: true, message: 'Login successful', data: { token, user: publicUser(user) } });
});

/** GET /api/auth/me — current user from DB. */
export const me = asyncHandler(async (req, res) => {
  const user = await findById(req.user.user_id);
  res.json({ success: true, data: { user: publicUser(user) } });
});

/** POST /api/auth/logout — client discards token; server acknowledges. */
export const logout = asyncHandler(async (req, res) => {
  res.json({ success: true, message: 'Logged out' });
});

/** POST /api/auth/forgot-password — public. Emails the OTP (Gmail SMTP); dev console fallback without SMTP. */
export const forgotPassword = asyncHandler(async (req, res) => {
  const data = validate(req.body, { email: { type: 'string', required: true, max: 120, email: true } });
  const result = await createPasswordReset(data.email);
  if (result.delivered !== false) {
    // Real email sent (true) OR unknown address (null) — identical enumeration-safe wording.
    res.json({ success: true, message: 'If an account exists for this email, a verification code has been sent.', data: {} });
    return;
  }
  // Known account + no SMTP configured (local development): OTP goes to the backend
  // console. It reaches the API response ONLY when ALLOW_DEV_OTP=1 is explicitly set.
  res.json({
    success: true,
    message: 'Email is not configured on this server — the reset code is printed in the backend console.',
    data: { dev_otp: result.devOtp ?? null },
  });
});

/** POST /api/auth/verify-otp — public. */
export const verifyOtp = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    email: { type: 'string', required: true, max: 120, email: true },
    otp: { type: 'string', required: true, min: 6, max: 6 },
  });
  await verifyResetOtp(data.email, data.otp);
  res.json({ success: true, message: 'Code verified. Set a new password now.' });
});

/** POST /api/auth/reset-password — public. Single-use OTP; old sessions revoked. */
export const resetPasswordHandler = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    email: { type: 'string', required: true, max: 120, email: true },
    otp: { type: 'string', required: true, min: 6, max: 6 },
    password: { type: 'string', required: true, min: 8, max: 72 },
    confirm_password: { type: 'string', required: true, min: 8, max: 72 },
  });
  await resetPassword(data.email, data.otp, data.password, data.confirm_password);
  res.json({ success: true, message: 'Password reset successful. Please log in with your new password.' });
});

/** POST /api/auth/change-password — authenticated. */
export const changePasswordHandler = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    current_password: { type: 'string', required: true, max: 72 },
    password: { type: 'string', required: true, min: 8, max: 72 },
  });
  await changePassword(req.user.user_id, data.current_password, data.password);
  res.json({ success: true, message: 'Password changed. Please log in again with your new password.' });
});
