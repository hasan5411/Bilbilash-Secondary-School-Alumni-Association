import { createApp } from './app.js';
import { env } from './config/env.js';
import { closePool } from './db/pool.js';

const app = createApp();
const server = app.listen(env.port, () => {
  console.log(`[backend] BILBILASH Alumni API listening on port ${env.port}`);
  console.log(`[backend] Health check: /api/health`);
});

/**
 * Graceful shutdown: stop accepting new connections, drain the PostgreSQL
 * pool, then exit. Render sends SIGTERM on every deploy/restart; without this
 * the process is killed mid-query and in-flight requests are dropped.
 */
function shutdown(signal) {
  console.log(`[backend] ${signal} received — draining connections…`);
  server.close(async () => {
    try { await closePool(); } catch { /* pool already gone */ }
    process.exit(0);
  });
  // Hard deadline so a stuck socket can never wedge a deploy.
  const force = setTimeout(() => process.exit(1), 10_000);
  if (typeof force.unref === 'function') force.unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
