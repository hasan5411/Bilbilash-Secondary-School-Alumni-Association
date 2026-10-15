import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

/**
 * Email service (nodemailer + Gmail SMTP).
 *
 * Enabled ONLY when EMAIL_USER + EMAIL_APP_PASSWORD are set in backend/.env.
 * When not configured, sendEmail returns { sent: false, reason: 'not_configured' }
 * so callers can decide how to behave (the auth flow falls back to the
 * documented local-dev console OTP).
 *
 * Credentials live ONLY in backend/.env — never in source, never in the frontend.
 */

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: env.email.host,
    port: env.email.port,
    secure: env.email.port === 465,
    auth: { user: env.email.user, pass: env.email.appPassword },
    // Bound every phase of the SMTP conversation. Without these, a flaky SMTP
    // path holds the forgot-password request open indefinitely — in production
    // (Render behind Cloudflare) that meant 50–100s waits and opaque 524s
    // before the user saw any feedback. Typical Gmail sends complete in ~11s,
    // so these limits only clip genuine failures.
    connectionTimeout: 10_000, // TCP connect
    greetingTimeout: 10_000,   // server banner after connect
    socketTimeout: 15_000,     // inactivity during the SMTP transaction
  });
  return transporter;
}

export function emailEnabled() {
  return Boolean(env.email.user && env.email.appPassword);
}

export async function sendEmail({ to, subject, text }) {
  if (!emailEnabled()) return { sent: false, reason: 'not_configured' };
  try {
    const info = await getTransporter().sendMail({
      from: env.email.from || env.email.user,
      to,
      subject,
      text,
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    // Log useful server-side detail; never leak credentials or stack traces.
    console.error('[email] send failed:', err.code || '', err.message);
    return { sent: false, reason: err.code || 'send_failed' };
  }
}

/** Professional password-reset OTP email (Section 12 of the spec). */
export function passwordResetOtpEmail(to, otp, ttlMinutes) {
  return sendEmail({
    to,
    subject: 'Bilbilash Alumni - Password Reset OTP',
    text: [
      'Hello,',
      '',
      'We received a request to reset your Bilbilash Alumni Community account password.',
      '',
      `Your verification code is: ${otp}`,
      '',
      `This code will expire in ${ttlMinutes} minutes.`,
      '',
      'If you did not request a password reset, you can ignore this email.',
      '',
      'Regards,',
      'Bilbilash Alumni Association',
    ].join('\n'),
  });
}
