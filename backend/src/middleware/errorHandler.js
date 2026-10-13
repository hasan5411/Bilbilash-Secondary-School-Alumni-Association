import { ApiError } from '../utils/errors.js';

// PostgreSQL (node-postgres) connection/auth/catalog failures → 503.
const DB_ERROR_CODES = [
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNRESET',
  'EPIPE',
  '28P01', // invalid_password
  '28000', // invalid_authorization_specification
  '3D000', // invalid_catalog_name (database does not exist)
  '53300', // too_many_connections
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08006', // connection_failure
  '08003', // connection_does_not_exist
  '08000', // connection_exception
];

/** node-pg can reject with an AggregateError (parallel pool connections); dig out the real code/message. */
function dbFailure(err) {
  const candidates = [err, ...(Array.isArray(err?.errors) ? err.errors : [])];
  for (const e of candidates) {
    if (e && DB_ERROR_CODES.includes(e.code)) return e;
    if (typeof e?.message === 'string' && /ECONNREFUSED|connect ETIMEDOUT|getaddrinfo ENOTFOUND|Connection terminated|password authentication failed/i.test(e.message)) return e;
  }
  return null;
}

/** Central error middleware — always JSON, never leaks stack traces or database details. */
export function errorHandler(err, _req, res, _next) {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Internal server error';

  // PostgreSQL UNIQUE violation (e.g. constraint race) -> 409
  if (err && err.code === '23505') {
    status = 409;
    message = 'Duplicate entry: this record already exists.';
  }

  // PostgreSQL foreign-key violation (RESTRICT/SET NULL, e.g. fk_mmr_setby on
  // delete) -> 409. Services pre-check their references and answer with a
  // tailored message; this is the race-condition safety net so a raw
  // "update or delete on table … violates foreign key …" never reaches the UI.
  if (err && err.code === '23503') {
    status = 409;
    message = 'This account is referenced by historical records (contribution rates, payments, or audit history) ' +
      'that must be preserved. Deactivate the account instead of deleting it.';
  }

  // CHECK / NOT NULL violations — the request itself is invalid -> 422.
  if (err && (err.code === '23514' || err.code === '23502')) {
    status = 422;
    message = 'One of the submitted values is not allowed.';
  }

  // Log every unexpected error server-side WITH its stack for diagnosis…
  if (!(err instanceof ApiError)) {
    console.error('[error]', err.status || '', err.code || '', err.message, err.stack || '');
  }

  // …but never echo raw internals (SQL, file paths, TypeErrors) to clients.
  // Only purpose-built ApiErrors (4xx messages written for humans) pass through.
  if (status >= 500 && !(err instanceof ApiError)) {
    status = 500;
    message = 'Internal server error. The incident has been logged — please try again later.';
  }

  // MySQL connectivity/availability failures answer 503 with an actionable,
  // non-sensitive hint. Applied AFTER the generic 500 clamp above, because a
  // DB outage must not be flattened back into an undifferentiated 500.
  if (dbFailure(err)) {
    status = 503;
    message = 'Database is unavailable. Check DATABASE_URL (or DB_*) in backend/.env, confirm PostgreSQL is reachable, then run: npm run init-db';
  }

  res.status(status).json({ success: false, message });
}

/** Wrapper for async route handlers. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** 404 for unknown API routes. */
export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
}
