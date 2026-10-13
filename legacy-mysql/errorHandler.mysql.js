import { ApiError } from '../utils/errors.js';

const DB_ERROR_CODES = [
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'ER_BAD_HOST_ERROR',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'PROTOCOL_CONNECTION_LOST',
  'ER_NO_SUCH_TABLE',
];

/** mysql2 connection pools can reject with AggregateError; dig out the real code/message. */
function dbFailure(err) {
  const candidates = [err, ...(Array.isArray(err?.errors) ? err.errors : [])];
  for (const e of candidates) {
    if (e && DB_ERROR_CODES.includes(e.code)) return e;
    if (typeof e?.message === 'string' && /Access denied for user|Unknown database|ECONNREFUSED|connect ETIMEDOUT/i.test(e.message)) return e;
  }
  return null;
}

/** Central error middleware — always JSON, never leaks stack traces or database details. */
export function errorHandler(err, _req, res, _next) {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Internal server error';

  // MySQL duplicate entry (e.g. UNIQUE constraint race) -> 409
  if (err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062)) {
    status = 409;
    message = 'Duplicate entry: this record already exists.';
  }

  // MySQL foreign-key RESTRICT (errno 1451, e.g. fk_mmr_setby on delete) -> 409.
  // Services pre-check their references and answer with a tailored message; this
  // is the race-condition safety net so a raw "Cannot delete or update a parent
  // row…" never reaches the UI.
  if (err && (err.code === 'ER_ROW_IS_REFERENCED_2' || err.errno === 1451)) {
    status = 409;
    message = 'This account is referenced by historical records (contribution rates, payments, or audit history) ' +
      'that must be preserved. Deactivate the account instead of deleting it.';
  }

  if (dbFailure(err)) {
    status = 503;
    message = 'Database is unavailable. Check the DB_* settings in backend/.env, confirm MySQL is running, then run: npm run init-db';
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

  res.status(status).json({ success: false, message });
}

/** Wrapper for async route handlers. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** 404 for unknown API routes. */
export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
}
