import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { env, uploadDir, rootDir } from './config/env.js'; // rootDir = backend/
import { notFoundHandler, errorHandler, asyncHandler } from './middleware/errorHandler.js';
import { query } from './db/pool.js';

// Routes
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import profileRoutes from './routes/profileRoutes.js';
import directoryRoutes from './routes/directoryRoutes.js';
import jobRoutes from './routes/jobRoutes.js';
import visionRoutes from './routes/visionRoutes.js';
import helpRoutes from './routes/helpRoutes.js';
import eventRoutes from './routes/eventRoutes.js';
import noticeRoutes from './routes/noticeRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import pollRoutes from './routes/pollRoutes.js';
import galleryRoutes from './routes/galleryRoutes.js';
import teacherRoutes from './routes/teacherRoutes.js';
import bloodRoutes from './routes/bloodRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import statsRoutes from './routes/statsRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import contributionRoutes from './routes/contributionRoutes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Behind a reverse proxy (Render/Vercel/Nginx) this makes req.ip the real
  // client IP; harmless when not proxied.
  app.set('trust proxy', 1);

  // Minimal security headers (no extra dependency).
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // CORS: origins come from CORS_ORIGINS env (comma-separated). Local
  // development defaults keep localhost:5173 working with zero config.
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  // Health check — reports API + MySQL status without crashing when MySQL is down.
  app.get('/api/health', asyncHandler(async (_req, res) => {
    try {
      const rows = await query('SELECT 1 AS ok');
      res.json({ success: true, data: { status: 'ok', database: 'connected', db_ok: rows[0]?.ok === 1, time: new Date().toISOString() } });
    } catch (err) {
      res.status(200).json({
        success: true,
        data: {
          status: 'degraded',
          database: 'disconnected',
          db_error: err.code || err.message,
          hint: 'Check DATABASE_URL (or DB_*) in backend/.env, ensure PostgreSQL is running, and run: npm run init-db',
          time: new Date().toISOString(),
        },
      });
    }
  }));

  // Uploaded files are served under /uploads with no directory listing.
  app.use('/uploads', express.static(uploadDir, { fallthrough: false }));

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/directory', directoryRoutes);
  app.use('/api/jobs', jobRoutes);
  app.use('/api/visions', visionRoutes);
  app.use('/api/help', helpRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/notices', noticeRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/polls', pollRoutes);
  app.use('/api/gallery', galleryRoutes);
  app.use('/api/teachers', teacherRoutes);
  app.use('/api/blood', bloodRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/stats', statsRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/contributions', contributionRoutes);

  // OPTIONAL single-service production mode: when SERVE_FRONTEND_DIR points at
  // the built frontend (Vite dist), the backend serves it and falls back to
  // index.html for client-side routes (SPA refresh on /notifications etc.).
  // Unset (default): API-only — the frontend is deployed separately.
  if (env.serveFrontendDir) {
    const distDir = path.isAbsolute(env.serveFrontendDir)
      ? env.serveFrontendDir
      : path.resolve(rootDir, env.serveFrontendDir);
    app.use(express.static(distDir, { index: 'index.html' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
      res.sendFile(path.join(distDir, 'index.html'), (err) => {
        if (err) console.error('[spa] sendFile failed:', err.status, err.code, err.message);
      });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
