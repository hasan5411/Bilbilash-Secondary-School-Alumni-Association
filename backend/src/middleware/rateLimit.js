import { ApiError } from '../utils/errors.js';

/**
 * Dependency-free rate limiter for the PUBLIC auth endpoints.
 *
 * WHY: /api/auth/login, /forgot-password, /verify-otp and /reset-password are
 * anonymous by design. Without a limiter one host can attempt unlimited
 * password guesses or flood the SMTP sender with OTP mails.
 *
 * Two independent budgets:
 *
 *   1. FAILURES per (route, client IP, email) — the brute-force brake.
 *      Only "Invalid email or password" outcomes count, and a successful
 *      login clears that key, so legitimate users (and the project's test
 *      suites, which log in constantly) are never throttled by succeeding.
 *      IMPORTANT: the request is still executed while the budget lasts, and
 *      the correct password ALWAYS works — the limiter only rewrites the
 *      answer of a *failed* credential check into 429. A lockout that also
 *      rejected the right password would let an attacker deny service to the
 *      real account owner by burning their budget.
 *   2. ATTEMPTS per (route, client IP) — stops one host spraying many
 *      different emails (enumeration, OTP spam) and bounds the CPU an
 *      attacker can spend on bcrypt. This budget pre-blocks (429 before any
 *      password check).
 *
 * Behaviour: HTTP 429 + Retry-After, JSON body in the app's standard shape.
 * Tunable / disableable without a code change:
 *   AUTH_RATE_LIMIT=0          disable entirely (tests, load experiments)
 *   AUTH_RATE_LIMIT_FAILS=8    failures allowed per (route, ip, email)
 *   AUTH_RATE_LIMIT_IP_MAX=300 attempts allowed per (route, ip)
 *   AUTH_RATE_LIMIT_WINDOW=10  window length in minutes
 *
 * State lives in this isolate's memory: correct for a single Node process
 * (Render's default) and never shared across processes — a restart simply
 * clears the counters.
 */

const buckets = new Map(); // key -> { hits: number[], fails: number[] }
const MAX_KEYS = 50000; // memory guard: evict oldest when the map grows

function prune(list, now, windowMs) {
  let i = 0;
  while (i < list.length && now - list[i] >= windowMs) i++;
  return i ? list.slice(i) : list;
}

function take(key, now, windowMs) {
  const b = buckets.get(key) || { hits: [], fails: [] };
  b.hits = prune(b.hits, now, windowMs);
  b.fails = prune(b.fails, now, windowMs);
  buckets.set(key, b);
  if (buckets.size > MAX_KEYS) {
    const oldest = buckets.keys().next().value;
    buckets.delete(oldest);
  }
  return b;
}

const intEnv = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/**
 * @param {string} routeName stable bucket name, e.g. 'login'
 * @returns {import('express').RequestHandler}
 */
export function authRateLimit(routeName) {
  const windowMs = intEnv('AUTH_RATE_LIMIT_WINDOW', 10) * 60 * 1000;
  const maxFails = intEnv('AUTH_RATE_LIMIT_FAILS', 8);
  const maxIp = intEnv('AUTH_RATE_LIMIT_IP_MAX', 300);

  return (req, res, next) => {
    if (process.env.AUTH_RATE_LIMIT === '0') return next();

    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const emailKey = email ? `${routeName}|${ip}|${email}` : null;
    const ipKey = `${routeName}|${ip}`;

    // Budget 2: coarse per-IP cap — pre-blocks, no password work performed.
    const ipBucket = take(ipKey, now, windowMs);
    if (ipBucket.hits.length >= maxIp) {
      const waitSec = Math.ceil((windowMs - (now - ipBucket.hits[0])) / 1000);
      res.set('Retry-After', String(Math.max(waitSec, 1)));
      return next(new ApiError(429, 'Too many requests from this address. Please try again later.'));
    }
    ipBucket.hits.push(now);

    if (emailKey) {
      const b = take(emailKey, now, windowMs);
      b.hits.push(now);
    }

    // Budget 1: observe the answer and rewrite an over-budget credential
    // failure into 429 (the handler itself always runs).
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      try {
        const failedCredentials = res.statusCode === 401
          && body && body.message === 'Invalid email or password';
        if (failedCredentials && emailKey) {
          const b = take(emailKey, Date.now(), windowMs);
          b.fails.push(Date.now());
          if (b.fails.length > maxFails) {
            const waitSec = Math.ceil((windowMs - (Date.now() - b.fails[0])) / 1000);
            res.set('Retry-After', String(Math.max(waitSec, 1)));
            res.status(429);
            return originalJson({
              success: false,
              message: 'Too many failed attempts. Please wait a few minutes before trying again.',
            });
          }
        } else if (res.statusCode >= 200 && res.statusCode < 300 && emailKey) {
          // A successful auth attempt clears this account's failure budget.
          const b = buckets.get(emailKey);
          if (b) b.fails = [];
        }
      } catch { /* bookkeeping must never break the response */ }
      return originalJson(body);
    };
    return next();
  };
}

export default authRateLimit;
