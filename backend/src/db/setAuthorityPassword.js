import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { query, queryOne, pool } from '../db/pool.js';

/**
 * Set (or create) the AUTHORITY account password from backend/.env.
 *
 * Usage:  cd backend && npm run authority:set-password
 *
 * - Reads AUTHORITY_EMAIL and AUTHORITY_PASSWORD from backend/.env
 * - Hashes the password with bcrypt (never stored or printed in plain text)
 * - Creates the Authority account if it does not exist
 * - Bumps token_version so any existing sessions are logged out
 *
 * The password itself is never echoed to the terminal.
 */
async function main() {
  const email = String(env.authorityEmail).trim().toLowerCase();
  const password = env.authorityPassword;

  if (!password || password.length < 8) {
    console.error('[authority] AUTHORITY_PASSWORD in backend/.env must be at least 8 characters.');
    process.exit(1);
  }

  const role = await queryOne(`SELECT role_id FROM roles WHERE role_name = 'AUTHORITY' LIMIT 1`);
  if (!role) {
    console.error('[authority] AUTHORITY role missing. Run: npm run init-db');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  const existing = await queryOne('SELECT user_id FROM users WHERE email = ? LIMIT 1', [email]);

  if (existing) {
    await query(
      `UPDATE users SET password_hash = ?, role_id = ?, status = 'approved', is_active = 1,
                        token_version = token_version + 1
        WHERE user_id = ?`,
      [hash, role.role_id, existing.user_id]
    );
    console.log(`[authority] Password updated for ${email} (user #${existing.user_id}). Existing sessions invalidated.`);
  } else {
    const res = await query(
      `INSERT INTO users (role_id, first_name, last_name, email, password_hash, status, is_active)
       VALUES (?, 'Authority', 'System', ?, ?, 'approved', 1)
       RETURNING user_id`,
      [role.role_id, email, hash]
    );
    await query(`INSERT INTO profiles (user_id, bio) VALUES (?, 'System authority account')`, [res.insertId]);
    console.log(`[authority] Authority account created for ${email} (user #${res.insertId}).`);
  }

  console.log('[authority] Done. Log in with the email/password now stored in backend/.env.');
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
