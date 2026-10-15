import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const rootDir = path.resolve(__dirname, '../..'); // backend/
export const uploadDir = path.join(rootDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// backend/.env fills in values for LOCAL development only. Real environment
// variables (Render/Vercel/platform) always win — 12-factor style; a committed
// or stale .env can never shadow production configuration. (PORT=0-style host
// noise is already neutralized by the fallbacks below, e.g. `|| 5000`.)
dotenv.config({ path: path.join(rootDir, '.env') });

const required = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] Missing required environment variable: ${name}. Check backend/.env`);
    process.exit(1);
  }
  return v;
};

// Manual mobile-money receiving numbers (bKash / Nagad / Rocket). Each must be
// a real Bangladeshi mobile wallet number (11 digits starting 01). Unset =>
// null (the UI shows a setup notice, never a fake placeholder number).
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
    // Supabase (or any managed PostgreSQL): set DATABASE_URL — the full
    // `postgres://…` connection string (pooler URL recommended on Render).
    // sslmode inside the URL is honored (sslmode=require → TLS on).
    connectionString: process.env.DATABASE_URL || null,
    ssl: process.env.DB_SSL === 'true' || /sslmode=(require|prefer|verify-ca|verify-full)/i.test(process.env.DATABASE_URL || ''),
    // Local development fallback (docker/local PostgreSQL) via individual vars.
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME || 'bilbilash_alumni',
  },
  // Upload storage driver. Local disk is EPHEMERAL on Render — production
  // must use persistent object storage. Selection order:
  //   1. explicit UPLOAD_STORAGE=local|cloudinary|supabase
  //   2. 'cloudinary' when CLOUDINARY_URL is set
  //   3. 'supabase' when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set
  //   4. 'local' (development default)
  // SUPABASE_SERVICE_ROLE_KEY is a SERVER-ONLY secret: never sent to the
  // browser, never committed, never included in any VITE_ variable.
  storage: {
    driver: process.env.UPLOAD_STORAGE
      || (process.env.CLOUDINARY_URL ? 'cloudinary'
        : (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'local')),
    cloudinaryUrl: process.env.CLOUDINARY_URL || '',
    // Test-only override of the API host (never set in production).
    cloudinaryBase: process.env.CLOUDINARY_BASE_URL || null,
    supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    // Test-only override of the Storage REST host (never set in production).
    supabaseBase: process.env.SUPABASE_STORAGE_BASE || null,
  },
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  authorityEmail: required('AUTHORITY_EMAIL'),
  authorityPassword: required('AUTHORITY_PASSWORD'),
  // Email (password-reset OTP). All OPTIONAL: when unset, the app runs without
  // real email and the local-dev console OTP fallback stays available.
  email: {
    // PRODUCTION transport: an email provider's HTTPS API (port 443), because
    // Render Free blocks outbound SMTP (25/465/587) entirely. Choose one of
    // 'resend' | 'brevo' | 'sendgrid' and set EMAIL_API_KEY + EMAIL_FROM.
    provider: (process.env.EMAIL_PROVIDER || '').trim().toLowerCase(),
    apiKey: (process.env.EMAIL_API_KEY || '').trim(),
    // TEST-ONLY override of the provider API host (never set in production).
    apiBaseUrl: process.env.EMAIL_PROVIDER_BASE_URL || null,
    // Per-attempt timeout for the provider API call (ms).
    apiTimeoutMs: parseInt(process.env.EMAIL_PROVIDER_TIMEOUT_MS, 10) || 8000,
    // LOCAL-DEV transport: SMTP — used only when EMAIL_PROVIDER is unset.
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

// Fail fast on a misspelled email provider: a typo would otherwise silently
// disable delivery (the OTP flow would 400 in production with no clue why).
if (env.email.provider && !['resend', 'brevo', 'sendgrid'].includes(env.email.provider)) {
  console.error(
    `[config] EMAIL_PROVIDER="${env.email.provider}" is not supported. Use one of: resend, brevo, sendgrid.`
  );
  process.exit(1);
}
