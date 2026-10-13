import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const rootDir = path.resolve(__dirname, '../..'); // backend/
export const uploadDir = path.join(rootDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// backend/.env is the source of truth for local development.
// override:true is required because the host environment may export unrelated
// variables (e.g. PORT=0) that would otherwise shadow our configuration.
dotenv.config({ path: path.join(rootDir, '.env'), override: true });

const required = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] Missing required environment variable: ${name}. Check backend/.env`);
    process.exit(1);
  }
  return v;
};

// Manual mobile-money receiving numbers (bKash / Nagad / Rocket). Each must be
// a real Bangladeshi mobile wallet number (11 digits starting 01). Unset => null
// (the UI shows a setup notice, never a fake placeholder number).
// Accepts +88/88 prefixes and stores the normalized 11-digit form.
const bdMobileNumber = (name) => {
  let v = (process.env[name] || '').trim().replace(/[\s-]/g, '');
  if (!v) return null;
  v = v.replace(/^\+?88/, '');
  if (!/^01[3-9]\d{8}$/.test(v)) {
    console.error(
      `[config] ${name}="${v}" is not a valid Bangladeshi mobile number (11 digits starting with 01). ` +
      'Fix backend/.env — refusing to serve a broken payment number.'
    );
    process.exit(1);
  }
  return v;
};

export const env = {
  port: parseInt(process.env.PORT, 10) || 5000,
  // Allowed browser origins for CORS (comma-separated). Defaults keep local
  // development working; production MUST set CORS_ORIGINS to the deployed
  // frontend origin(s), e.g. https://bilbilash.example.com.
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map((s) => s.trim()).filter(Boolean),
  // OPTIONAL single-service deployment: set to the built frontend folder
  // (e.g. SERVE_FRONTEND_DIR=../frontend/dist) and the backend serves the SPA
  // + falls back to index.html for client-side routes. Unset = API-only
  // (frontend deployed separately, e.g. Vercel/Netlify).
  serveFrontendDir: process.env.SERVE_FRONTEND_DIR || null,
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME || 'bilbilash_alumni',
  },
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  authorityEmail: required('AUTHORITY_EMAIL'),
  authorityPassword: required('AUTHORITY_PASSWORD'),
  // Email (password-reset OTP). All OPTIONAL: when unset, the app runs without
  // real email and the local-dev console OTP fallback stays available.
  email: {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT, 10) || 587,
    user: process.env.EMAIL_USER || '',
    appPassword: process.env.EMAIL_APP_PASSWORD || '',
    from: process.env.EMAIL_FROM || '',
  },
  // Explicit local-dev escape hatch: when '1' AND real email is NOT configured,
  // the forgot-password response may include the OTP (dev UI flow).
  allowDevOtp: process.env.ALLOW_DEV_OTP === '1',
  // Manual mobile-money providers (bKash / Nagad / Rocket). The association's
  // real receiving number is ONE centralized value per provider in
  // backend/.env — bKash: BKASH_NUMBER (Nagad/Rocket equivalents stay
  // optional). Unset => number is null and the UI shows a setup notice
  // instead of a placeholder. appUrl must only ever be an OFFICIALLY
  // documented gateway deep link (never guessed); it stays null — the UI
  // opens the app on phones via the provider's official app-store links.
  payments: {
    bkash: {
      number: bdMobileNumber('BKASH_NUMBER') ?? bdMobileNumber('PAYMENT_BKASH_NUMBER'),
      appUrl: process.env.PAYMENT_BKASH_APP_URL || null,
    },
    nagad: {
      number: bdMobileNumber('NAGAD_NUMBER') ?? bdMobileNumber('PAYMENT_NAGAD_NUMBER'),
      appUrl: process.env.PAYMENT_NAGAD_APP_URL || null,
    },
    rocket: {
      number: bdMobileNumber('ROCKET_NUMBER') ?? bdMobileNumber('PAYMENT_ROCKET_NUMBER'),
      appUrl: process.env.PAYMENT_ROCKET_APP_URL || null,
    },
  },
};
