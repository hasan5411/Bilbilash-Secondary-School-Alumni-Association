import { unauthorized, forbidden } from '../utils/errors.js';
import { verifyToken } from '../utils/jwt.js';
import { queryOne } from '../db/pool.js';

const ROLE_RANK = { VISITOR: 1, MEMBER: 2, ADMIN: 3, AUTHORITY: 4 };

/**
 * Verifies the JWT, then RE-LOADS the user + role from MySQL on every request.
 * The token only identifies the user — role/status/active always come from the DB,
 * so forged payload claims, demoted users, and stale tokens are handled correctly.
 */
export async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) throw unauthorized();
    const token = header.slice(7).trim();
    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      throw unauthorized('Invalid or expired token. Please log in again.');
    }

    const user = await queryOne(
      `SELECT u.user_id, u.first_name, u.last_name, u.email, u.status, u.is_active,
              u.token_version, r.role_name
         FROM users u JOIN roles r ON r.role_id = u.role_id
        WHERE u.user_id = ? LIMIT 1`,
      [payload.sub]
    );

    if (!user || !user.is_active) throw unauthorized('Account not found or deactivated');
    if (user.token_version !== payload.tv) throw unauthorized('Session expired. Please log in again.');
    // Account-status gate on EVERY request: an old JWT held by a pending,
    // rejected or deactivated account is dead immediately — no re-login needed
    // to lose access, and no status can be refreshed client-side.
    if (user.status === 'pending') throw unauthorized('Your membership is awaiting approval. Please wait for an administrator to approve it.');
    if (user.status !== 'approved') throw unauthorized('Account is not active');

    req.user = user; // { user_id, first_name, last_name, email, status, role_name, ... }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * requireApproved — any authenticated user whose account status is 'approved'
 * (any role). Pending users are rejected: authenticate() already re-reads the
 * status from the DB on every request, so this stays correct after approval.
 */
export function requireApproved(req, _res, next) {
  if (req.user && req.user.status === 'approved') return next();
  return next(forbidden('You must be an approved member to view full profile details.'));
}

/**
 * requireRole('MEMBER')            -> rank >= MEMBER (ADMIN, AUTHORITY also pass)
 * requireRole(['ADMIN'])           -> rank >= ADMIN
 * requireRole(['AUTHORITY'])       -> only AUTHORITY
 * requireRole('ANY')               -> any authenticated user
 */
export function requireRole(allowed) {
  const minRank = allowed === 'ANY' ? 1 : ROLE_RANK[Array.isArray(allowed) ? allowed[0] : allowed];
  if (!minRank) throw new Error(`requireRole: invalid role spec "${allowed}"`);
  return (req, _res, next) => {
    if (ROLE_RANK[req.user.role_name] >= minRank) return next();
    return next(forbidden(`Requires ${allowed === 'ANY' ? 'a logged-in user' : `role ${allowed}`} or higher`));
  };
}
