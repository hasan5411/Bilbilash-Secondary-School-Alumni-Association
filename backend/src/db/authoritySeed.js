import bcrypt from 'bcryptjs';

/**
 * Shared AUTHORITY-account initialization logic.
 *
 * Used by:
 *   - src/db/initDb.js            (mode: create-only — never modifies an existing account)
 *   - src/db/setAuthorityPassword.js (mode: set-password — explicit operator-run recovery)
 *
 * Security invariants (verified by tests/authorityInitTest.js):
 *   1. The AUTHORITY role_id is looked up from the `roles` table by name — never
 *      hardcoded (the schema seeds roles; role 1 is VISITOR, not AUTHORITY).
 *   2. CREATE-ONLY by default: an existing account is NEVER modified — its
 *      password, role and status stay untouched. A repeated run can therefore
 *      never duplicate the account or rotate its credentials.
 *   3. Privilege-escalation guard: if AUTHORITY_EMAIL belongs to an account that
 *      does NOT hold the AUTHORITY role (e.g. someone registered with that
 *      address through public registration), that account is NEVER promoted.
 *      The caller gets an actionable 'conflict' result and must resolve it
 *      manually. This closes the "register with the Authority email, wait for
 *      init-db to promote you" hole.
 *   4. Race-safe: creation uses INSERT ... ON CONFLICT (email) DO NOTHING against
 *      the uq_users_email unique constraint, so two concurrent initializations
 *      (e.g. overlapping deploys) can never create duplicates or crash.
 *   5. Passwords are bcrypt-hashed with the app's standard cost (12), matching
 *      authService.login()'s bcrypt.compare. The plaintext is never stored,
 *      logged, or returned; results only carry the action + user_id.
 *
 * The client parameter is any object with a native node-pg query(text, params)
 * → result ({ rows }) interface (pg.Client, pg.Pool, or a transaction client).
 */

export const BCRYPT_ROUNDS = 12;

/** Look up the AUTHORITY role id from the actual seeded roles table. */
export async function resolveAuthorityRoleId(client) {
  const { rows } = await client.query(
    "SELECT role_id FROM roles WHERE role_name = 'AUTHORITY' LIMIT 1"
  );
  if (!rows.length) {
    throw new Error(
      "AUTHORITY role missing from the roles table — apply the schema first (npm run init-db)"
    );
  }
  return rows[0].role_id;
}

/**
 * Ensure the AUTHORITY account for `email` exists.
 *
 * @param {object} client  node-pg client with .query(text, params)
 * @param {object} opts
 * @param {string} opts.email    AUTHORITY_EMAIL (normalized: trimmed + lowercased)
 * @param {string} opts.password AUTHORITY_PASSWORD (never logged; min 8 chars)
 * @param {boolean} [opts.forcePassword] mode 'set-password': when the account
 *        already EXISTS and holds the AUTHORITY role, replace its password with
 *        `password` and bump token_version (invalidates existing sessions).
 *        An account with a DIFFERENT role is still never touched (conflict).
 * @returns {{ action: 'created'|'exists'|'password_updated'|'conflict',
 *             userId: number, role?: string, status?: string, isActive?: number }}
 * @throws on missing/short password or missing AUTHORITY role.
 */
export async function ensureAuthorityAccount(client, { email, password, forcePassword = false }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) throw new Error('AUTHORITY_EMAIL is empty — set it in the environment');
  if (!password || String(password).length < 8) {
    throw new Error('AUTHORITY_PASSWORD must be set and at least 8 characters long');
  }

  const authorityRoleId = await resolveAuthorityRoleId(client);
  const hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);

  // Race-safe create: concurrent runs can both attempt the INSERT; the unique
  // email constraint lets exactly one win, everyone else falls through to inspect.
  const { rows: inserted } = await client.query(
    `INSERT INTO users (role_id, first_name, last_name, email, password_hash, status, is_active)
     VALUES ($1, 'Authority', 'System', $2, $3, 'approved', 1)
     ON CONFLICT (email) DO NOTHING
     RETURNING user_id`,
    [authorityRoleId, normalizedEmail, hash]
  );

  if (inserted.length) {
    const userId = inserted[0].user_id;
    await client.query(
      `INSERT INTO profiles (user_id, bio) VALUES ($1, 'System authority account')
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );
    return { action: 'created', userId };
  }

  const { rows: existing } = await client.query(
    `SELECT u.user_id, u.status, u.is_active, r.role_name
       FROM users u JOIN roles r ON r.role_id = u.role_id
      WHERE u.email = $1 LIMIT 1`,
    [normalizedEmail]
  );
  const row = existing[0];
  if (!row) {
    // Extremely unlikely (row deleted between the INSERT and this SELECT) —
    // treat as a plain conflict so the operator re-runs; never guess.
    throw new Error(`Account for ${normalizedEmail} disappeared during initialization — re-run the script.`);
  }

  // Invariant 3: never promote / take over an account that is not AUTHORITY.
  if (row.role_name !== 'AUTHORITY') {
    return { action: 'conflict', userId: row.user_id, role: row.role_name, status: row.status, isActive: row.is_active };
  }

  if (forcePassword) {
    await client.query(
      `UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE user_id = $2`,
      [hash, row.user_id]
    );
    return { action: 'password_updated', userId: row.user_id };
  }

  return { action: 'exists', userId: row.user_id, status: row.status, isActive: row.is_active };
}

/** Human-readable, credential-free report line for a seed result. */
export function describeAuthorityResult(email, result) {
  switch (result.action) {
    case 'created':
      return `Authority account created for ${email} (user #${result.userId}).`;
    case 'password_updated':
      return `Password updated for ${email} (user #${result.userId}). Existing sessions invalidated.`;
    case 'exists': {
      const healthy = result.status === 'approved' && Number(result.isActive) === 1;
      const base = `Authority account already exists for ${email} (user #${result.userId}) — no duplicate created, credentials untouched.`;
      return healthy
        ? base
        : `${base} WARNING: status='${result.status}', is_active=${result.isActive} — this account cannot log in until it is approved/active.`;
    }
    case 'conflict':
      return (
        `REFUSING to initialize: ${email} already belongs to user #${result.userId} with role ${result.role} ` +
        `(status='${result.status}'). That account is NOT the Authority account and is never promoted automatically. ` +
        `Resolve manually — either use a different AUTHORITY_EMAIL, or delete/transfer the conflicting ` +
        `registration — then re-run.`
      );
    default:
      return `Unexpected authority seed result for ${email}.`;
  }
}

/** Whether a result should fail the script (exit code 1). */
export function authorityResultIsFailure(result) {
  return result.action === 'conflict';
}

/** Whether a healthy 'exists'/'password_updated' needs no operator attention. */
export function authorityResultNeedsWarning(result) {
  return result.action === 'exists' && !(result.status === 'approved' && Number(result.isActive) === 1);
}
