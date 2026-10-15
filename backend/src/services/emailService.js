import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

/**
 * Email service — password-reset OTP delivery.
 *
 * WHY TWO TRANSPORTS (root cause of the 2026-10-15 production outage):
 *   Production logs showed `ETIMEDOUT Connection timeout` and
 *   `ESOCKET connect ENETUNREACH 2404:6800:…:465` when Render tried to reach
 *   Gmail SMTP, and Render documents that Free web services cannot send
 *   outbound traffic on SMTP ports 25/465/587 (render.com/docs/free). The
 *   same credentials authenticated from a non-Render network in ~1.5s, so
 *   this is a HOSTING-LEVEL egress block, not a credentials problem — no
 *   SMTP port, IPv4 forcing, or longer timeout can fix it.
 *
 *   Therefore production delivery goes through an email provider's HTTPS API
 *   on port 443 (allowed by Render): configure ONE of
 *     EMAIL_PROVIDER=resend|brevo|sendgrid  +  EMAIL_API_KEY  +  EMAIL_FROM
 *   Transport picks up the provider's REST endpoint, auth header and payload
 *   shape — plain fetch(), no SDK dependency.
 *
 *   SMTP (EMAIL_USER + EMAIL_APP_PASSWORD) remains ONLY as the local-dev
 *   transport: when no EMAIL_PROVIDER is configured the service behaves
 *   exactly as before. On Render, leaving SMTP configured without an API
 *   provider keeps the flow broken — the config check below says so loudly.
 *
 * RELIABILITY CONTRACT (spec Section 15):
 *   - sendEmail NEVER throws (provider crashes become { sent:false, reason }).
 *   - No retry on 4xx (a bad API key will not fix itself); one bounded retry
 *     on network errors / timeouts / 5xx / 429 — duplicate OTP emails cannot
 *     strand anything because the OTP row is created before sending and a
 *     failed send is invalidated by authService (see createPasswordReset).
 *   - Never log credentials, API keys, or OTP values. Provider response
 *     bodies are NOT logged (they can echo the recipient).
 *
 * Credentials live ONLY in backend/.env and the Render dashboard — never in
 * source, never in the frontend.
 */

// ── Provider registry (HTTPS API over port 443) ─────────────────────────────
// baseUrl override exists for TESTS only (mirror of SUPABASE_STORAGE_BASE /
// CLOUDINARY_BASE_URL): tests point the transport at a local mock server.
const PROVIDERS = {
  resend: {
    endpoint: () => `${env.email.apiBaseUrl || 'https://api.resend.com'}/emails`,
    headers: (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }),
    body: (from, to, subject, text) => ({ from, to: [to], subject, text }),
    messageId: (json) => json?.id ?? null,
  },
  brevo: {
    endpoint: () => `${env.email.apiBaseUrl || 'https://api.brevo.com'}/v3/smtp/email`,
    headers: (key) => ({ 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' }),
    body: (from, to, subject, text) => ({
      sender: { email: bareAddress(from) },
      to: [{ email: to }],
      subject,
      textContent: text,
    }),
    messageId: (json) => json?.messageId ?? null,
  },
  sendgrid: {
    endpoint: () => `${env.email.apiBaseUrl || 'https://api.sendgrid.com'}/v3/mail/send`,
    headers: (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }),
    body: (from, to, subject, text) => ({
      from: { email: bareAddress(from) },
      personalizations: [{ to: [{ email: to }] }],
      subject,
      content: [{ type: 'text/plain', value: text }],
    }),
    messageId: (json) => json?.[0]?.headers?.['x-message-id'] ?? json?.[0]?.messageId ?? null,
  },
};

/** "Bilbilash Alumni <no-reply@x>" → "no-reply@x" (Brevo/SendGrid want bare addresses). */
function bareAddress(value) {
  const s = String(value || '').trim();
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim();
}

export function emailProvider() {
  return env.email.provider;
}

/** API transport configured (provider selected + key + from)? */
export function apiEnabled() {
  return Boolean(env.email.provider && env.email.apiKey && (env.email.from || env.email.user));
}

/**
 * Config state for diagnostics:
 *   'api'          → HTTPS API transport ready
 *   'smtp'         → legacy SMTP transport ready (local dev)
 *   'missing_key'  → EMAIL_PROVIDER chosen but EMAIL_API_KEY / EMAIL_FROM absent
 *   'not_configured'
 */
export function emailConfigState() {
  if (env.email.provider) {
    return (env.email.apiKey && (env.email.from || env.email.user)) ? 'api' : 'missing_key';
  }
  return (env.email.user && env.email.appPassword) ? 'smtp' : 'not_configured';
}

/** True when the service can attempt real delivery (API or SMTP). */
export function emailEnabled() {
  const state = emailConfigState();
  return state === 'api' || state === 'smtp';
}

// ── SMTP transport (local development only) ─────────────────────────────────
const transporters = new Map();

function getSmtpTransporter() {
  const port = env.email.port;
  let t = transporters.get(port);
  if (t) return t;
  t = nodemailer.createTransport({
    host: env.email.host,
    port,
    secure: port === 465,
    auth: { user: env.email.user, pass: env.email.appPassword },
    // Bound every phase so a broken SMTP path can never hold the
    // forgot-password request open indefinitely.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  transporters.set(port, t);
  return t;
}

async function sendViaSmtp({ to, subject, text }) {
  try {
    const info = await getSmtpTransporter().sendMail({
      from: env.email.from || env.email.user,
      to,
      subject,
      text,
    });
    return { sent: true, transport: 'smtp', messageId: info.messageId ?? null };
  } catch (err) {
    // Log code/status only — never the message body (contains the OTP).
    console.error('[email] smtp send failed:', err.code || '', err.responseCode || '', err.message);
    return { sent: false, reason: err.code || 'smtp_send_failed' };
  }
}

// ── HTTPS API transport (production) ────────────────────────────────────────
const API_TIMEOUT_MS = env.email.apiTimeoutMs;

function isRetryable(status, err) {
  if (err) return true; // network error / timeout / abort — worth one retry
  return status === 429 || (status >= 500 && status <= 599);
}

async function attemptApi(provider, payload, from, to) {
  const spec = PROVIDERS[provider];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(spec.endpoint(), {
      method: 'POST',
      headers: spec.headers(env.email.apiKey),
      body: JSON.stringify(spec.body(from, to, payload.subject, payload.text)),
      signal: controller.signal,
    });
    return { res };
  } finally {
    clearTimeout(timer);
  }
}

async function sendViaApi({ to, subject, text }) {
  const provider = env.email.provider;
  const from = env.email.from || env.email.user;
  const payload = { subject, text };
  let lastReason = 'api_send_failed';
  let lastStatus = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { res } = await attemptApi(provider, payload, from, to);
      if (res.ok) {
        let json = null;
        try { json = await res.json(); } catch { /* 202 Accepted with empty body (SendGrid) */ }
        return {
          sent: true,
          transport: 'api',
          provider,
          messageId: PROVIDERS[provider].messageId(json),
        };
      }
      lastStatus = res.status;
      lastReason = `http_${res.status}`;
      if (!isRetryable(res.status, null)) break; // 4xx: auth/validation — retrying cannot help
    } catch (err) {
      lastReason = err?.name === 'AbortError' ? 'api_timeout' : (err?.cause?.code || err?.code || 'api_network_error');
    }
    if (attempt === 1) {
      // One bounded retry for transient failures (network, timeout, 5xx, 429).
      console.error(`[email] api attempt ${attempt} failed (${provider} status=${lastStatus} reason=${lastReason}) — retrying once`);
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }
  }
  // Status/reason only: response bodies can echo the recipient, message text
  // contains the OTP — neither is ever logged.
  console.error(`[email] api send failed (${provider} status=${lastStatus} reason=${lastReason})`);
  return { sent: false, reason: lastReason, provider };
}

/**
 * Send an email through the configured transport.
 * Returns { sent: true, ... } or { sent: false, reason } — NEVER throws, so a
 * provider outage can never become an unhandled server error.
 */
export async function sendEmail({ to, subject, text }) {
  const state = emailConfigState();
  if (state === 'not_configured') return { sent: false, reason: 'not_configured' };
  if (state === 'missing_key') {
    // EMAIL_PROVIDER set but EMAIL_API_KEY/EMAIL_FROM missing: do not silently
    // fall back to a console "success" — fail honestly and tell ops what to fix.
    console.error(`[email] EMAIL_PROVIDER=${env.email.provider} is configured but EMAIL_API_KEY or EMAIL_FROM is missing — set it in the Render dashboard (Environment tab).`);
    return { sent: false, reason: 'provider_missing_credentials' };
  }
  if (state === 'api') return sendViaApi({ to, subject, text });
  return sendViaSmtp({ to, subject, text });
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
