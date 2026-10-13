import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { ensureAuthorityAccount, describeAuthorityResult, authorityResultIsFailure } from './authoritySeed.js';

/**
 * Explicit recovery: set (or create) the AUTHORITY account from the
 * AUTHORITY_EMAIL / AUTHORITY_PASSWORD environment values.
 *
 * Usage:  cd backend && npm run authority:set-password
 * (On Render: run it once as a Shell / one-off job with the service's env.)
 *
 * - Reads AUTHORITY_EMAIL and AUTHORITY_PASSWORD from backend/.env (local) or
 *   the platform environment (Render). Values are never printed or logged.
 * - Password is bcrypt-hashed (cost 12); plaintext is never stored or echoed.
 * - Creates the account if it does not exist.
 * - If the account exists AND holds the AUTHORITY role: replaces its password
 *   and bumps token_version (existing sessions are logged out).
 * - If AUTHORITY_EMAIL belongs to an account with ANY OTHER role: refuses with
 *   an actionable error and changes NOTHING (no silent promotion, no takeover).
 * - Race-safe and idempotent (see src/db/authoritySeed.js).
 */
async function main() {
  const email = String(env.authorityEmail).trim().toLowerCase();

  const result = await ensureAuthorityAccount(pool, {
    email,
    password: env.authorityPassword,
    forcePassword: true,
  });

  console.log(`[authority] ${describeAuthorityResult(email, result)}`);
  if (authorityResultIsFailure(result)) {
    throw new Error(
      'Refusing to modify a non-Authority account. Resolve the conflict described above, then re-run.'
    );
  }
  console.log('[authority] Done. Log in with AUTHORITY_EMAIL / AUTHORITY_PASSWORD as stored in the environment.');
}

main()
  .then(async () => {
    await pool.end(); // release the connection pool so the script exits promptly
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[authority] FAILED:', err.code || '', err.message);
    try { await pool.end(); } catch { /* ignore */ }
    process.exit(1);
  });
