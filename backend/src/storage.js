import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env, uploadDir } from './config/env.js';
import { ApiError } from './utils/errors.js';

/**
 * Upload storage abstraction.
 *
 * WHY: Render's local disk is EPHEMERAL — every deploy/restart wipes
 * backend/uploads/, so profile photos, gallery images, teacher photos and
 * payment screenshots would vanish in production. Persistent object storage
 * is required there; local disk stays the default for development.
 *
 * Three drivers, selected by env (UPLOAD_STORAGE / CLOUDINARY_URL /
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — see config/env.js):
 *   'local'      — current behavior: keep the multer-written file in
 *                  backend/uploads/ and store its filename in the DB.
 *   'cloudinary' — signed upload to Cloudinary (no SDK; plain HTTPS via
 *                  fetch). The DB stores the returned secure_url; the local
 *                  temp file is removed afterwards.
 *   'supabase'   — upload to Supabase Storage REST API with the SERVER-ONLY
 *                  service-role key (no SDK). Two existing buckets are used:
 *                    profile-images  (members/ + teachers/ prefixes, 1 MB cap)
 *                    gallery-images  (gallery/ prefix, 3 MB cap)
 *                  The DB stores the object's public URL; the local temp file
 *                  is removed afterwards. Uploads go through this backend, so
 *                  Storage policies never need to allow anonymous writes.
 *
 * DB columns keep the same shape either way: a REFERENCE string that is
 * either a bare filename (local) or an absolute https URL (cloudinary or
 * supabase). Frontend resolves it via utils.mediaUrl(); backend via
 * resolveUploadRef().
 *
 * Credentials never live in code: they are read from the environment (Render
 * dashboard / backend/.env locally), e.g.
 *   CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name
 *   SUPABASE_URL=https://<project-ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role key>   (server-only secret!)
 */
const isAbsoluteRef = (ref) => /^https?:\/\//i.test(String(ref || ''));

// ── Buckets & limits (must match the Supabase bucket settings) ──────────────
export const STORAGE_BUCKETS = {
  profileImages: 'profile-images', // member avatars + teacher photos
  galleryImages: 'gallery-images', // alumni gallery photos
};
export const PROFILE_IMAGE_MAX_BYTES = 1 * 1024 * 1024; // 1 MB — profile-images bucket limit
export const GALLERY_IMAGE_MAX_BYTES = 3 * 1024 * 1024; // 3 MB — gallery-images bucket limit

/**
 * Normalize a Supabase Storage reference to its STABLE PUBLIC form.
 *
 * Signed URLs (`/storage/v1/object/sign/<bucket>/<path>?token=…`) are
 * short-lived by design — they expire and the image404s afterwards. Our own
 * upload path never produces them (only `/object/public/…`), but refs can
 * arrive signed from outside (Supabase dashboard "Get URL", hand-edited DB
 * rows). Both buckets are PUBLIC, so every such ref is rewritten to the
 * permanent public form and the expiring token is stripped.
 * Non-Supabase URLs and non-absolute refs are returned unchanged.
 */
export function normalizeStorageRef(ref) {
  const s = String(ref || '');
  const m = /(\/storage\/v1\/object\/)(?:sign|public|authenticated)\/([^?#]+)/.exec(s);
  if (!m) return ref;
  return `${s.slice(0, m.index)}${m[1]}public/${m[2]}`;
}

/** DB reference -> URL the browser can request. */
export function resolveUploadRef(ref) {
  if (!ref) return null;
  if (isAbsoluteRef(ref)) return normalizeStorageRef(ref);
  return `/uploads/${path.basename(String(ref))}`;
}

/**
 * Finalize a multer file into the reference to store in the DB.
 * Call AFTER assertImageMagic() and BEFORE the database write.
 *   opts.bucket   — Supabase bucket name (required for the supabase driver;
 *                   without a bucket the file stays local — legacy behavior).
 *   opts.prefix   — optional object prefix ('members' | 'teachers' | 'gallery').
 *   opts.maxBytes — per-target size cap, enforced for EVERY driver (the bucket
 *                   limits: 1 MB profile/teacher, 3 MB gallery).
 * Local driver: returns the filename (unchanged legacy behavior).
 * Cloudinary driver: uploads, deletes the local temp file, returns secure_url.
 * Supabase driver: uploads, deletes the local temp file, returns the public URL.
 */
export async function persistUpload(file, { bucket = null, prefix = null, maxBytes = null } = {}) {
  if (!file) return null;
  if (maxBytes) {
    const size = fs.statSync(file.path).size;
    if (size > maxBytes) {
      const mb = (maxBytes / (1024 * 1024)).toFixed(0);
      // Rejected before any upload — drop the multer temp file immediately.
      try { fs.unlinkSync(file.path); } catch { /* ignore */ }
      throw new ApiError(422, `Image must be ${mb} MB or smaller`);
    }
  }
  if (env.storage.driver === 'supabase' && bucket) return supabaseUpload(file, { bucket, prefix });
  if (env.storage.driver === 'cloudinary') return cloudinaryUpload(file);
  return file.filename;
}

/** Remove a stored upload by its DB reference. Never throws (best-effort). */
export async function removeUpload(ref) {
  if (!ref) return false;
  if (isAbsoluteRef(ref)) {
    // A signed ref (hand-pasted from the dashboard) still deletes correctly:
    // normalize to the public shape first — the token is never needed.
    ref = normalizeStorageRef(ref);
    // Shape-dispatch: a Supabase public URL is destroyed via the Storage API
    // regardless of the currently selected driver (the object lives there).
    const supa = parseSupabasePublicUrl(ref);
    if (supa) {
      try { return await supabaseDestroy(ref); } catch { return false; }
    }
    if (env.storage.driver !== 'cloudinary') return false;
    try { await cloudinaryDestroy(ref); return true; } catch { return false; }
  }
  try {
    // basename() keeps the deletion inside uploadDir even on a poisoned DB value.
    fs.unlinkSync(path.join(uploadDir, path.basename(String(ref))));
    return true;
  } catch {
    return false; // file may already be gone
  }
}

// ── Supabase Storage driver (REST via fetch; Node 18+ global fetch) ─────────

function supabaseConfig() {
  const s = env.storage;
  if (!s.supabaseUrl || !s.supabaseServiceKey) {
    throw new ApiError(500, 'Upload storage is set to supabase but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured');
  }
  const apiBase = s.supabaseBase || `${s.supabaseUrl}/storage/v1`;
  return { apiBase, publicBase: `${apiBase}/object/public`, serviceKey: s.supabaseServiceKey };
}

/** Parse …/storage/v1/object/public/<bucket>/<path> → { bucket, path } | null. */
export function parseSupabasePublicUrl(ref) {
  const m = /\/storage\/v1\/object\/public\/([A-Za-z0-9_-]+)\/(.+)$/.exec(String(ref || ''));
  if (!m) return null;
  try { return { bucket: m[1], path: decodeURIComponent(m[2]) }; } catch { return { bucket: m[1], path: m[2] }; }
}

/** Sanitized object key: optional prefix + timestamp + random + original extension. */
export function supabaseObjectKey(file, prefix) {
  const safePrefix = String(prefix || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const ext = path.extname(file.filename || '').toLowerCase() || '.bin';
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  return safePrefix ? `${safePrefix}/${name}` : name;
}

async function supabaseUpload(file, { bucket, prefix }) {
  const cfg = supabaseConfig();
  const key = supabaseObjectKey(file, prefix);
  const bytes = fs.readFileSync(file.path);
  const res = await fetch(`${cfg.apiBase}/object/${bucket}/${key}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.serviceKey}`,
      'Content-Type': file.mimetype || 'application/octet-stream',
      'x-upsert': 'false',
    },
    body: bytes,
  });
  if (!res.ok) {
    // Never leak upstream response bodies to clients; the status is enough.
    throw new ApiError(502, `Image storage upload failed (${res.status}). Please try again.`);
  }
  // The temp local copy is no longer needed.
  try { fs.unlinkSync(file.path); } catch { /* ignore */ }
  return `${cfg.publicBase}/${bucket}/${key}`;
}

async function supabaseDestroy(ref) {
  const parsed = parseSupabasePublicUrl(ref);
  if (!parsed) return false;
  const cfg = supabaseConfig();
  const res = await fetch(`${cfg.apiBase}/object/${parsed.bucket}/${parsed.path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${cfg.serviceKey}` },
  });
  // 404 = already gone; both count as "no longer present".
  return res.ok || res.status === 404;
}

// ── Cloudinary driver (REST via fetch; Node 18+ global fetch/FormData) ──────

function cloudinaryConfig() {
  const raw = env.storage.cloudinaryUrl;
  if (!raw) {
    throw new ApiError(500, 'Upload storage is set to cloudinary but CLOUDINARY_URL is not configured');
  }
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(raw);
  if (!m) throw new ApiError(500, 'CLOUDINARY_URL must look like cloudinary://api_key:api_secret@cloud_name');
  return {
    apiKey: m[1],
    apiSecret: m[2],
    cloudName: m[3],
    base: env.storage.cloudinaryBase || 'https://api.cloudinary.com',
  };
}

/** Cloudinary signature: sha1 of alphabetically sorted key=value params + secret. */
export function cloudinarySignature(params, apiSecret) {
  const qs = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(qs + apiSecret).digest('hex');
}

async function cloudinaryUpload(file) {
  const cfg = cloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { timestamp };
  const signature = cloudinarySignature(params, cfg.apiSecret);

  const form = new FormData();
  const bytes = fs.readFileSync(file.path);
  form.append('file', new Blob([bytes]), file.filename);
  form.append('api_key', cfg.apiKey);
  form.append('timestamp', String(timestamp));
  form.append('signature', signature);

  const res = await fetch(`${cfg.base}/v1_1/${cfg.cloudName}/image/upload`, { method: 'POST', body: form });
  if (!res.ok) {
    throw new ApiError(502, `Image storage upload failed (${res.status}). Please try again.`);
  }
  const json = await res.json();
  if (!json.secure_url) throw new ApiError(502, 'Image storage upload failed (no secure_url)');
  // The temp local copy is no longer needed.
  try { fs.unlinkSync(file.path); } catch { /* ignore */ }
  return json.secure_url;
}

async function cloudinaryDestroy(ref) {
  const cfg = cloudinaryConfig();
  // secure_url shape: https://res.cloudinary.com/<cloud>/image/upload/v1234/<public_id>.<ext>
  const m = /\/upload\/(?:v\d+\/)?(.+?)\.\w+(?:\?.*)?$/.exec(ref);
  if (!m) return;
  const publicId = m[1];
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = cloudinarySignature({ public_id: publicId, timestamp }, cfg.apiSecret);
  const form = new FormData();
  form.append('public_id', publicId);
  form.append('timestamp', String(timestamp));
  form.append('api_key', cfg.apiKey);
  form.append('signature', signature);
  await fetch(`${cfg.base}/v1_1/${cfg.cloudName}/image/destroy`, { method: 'POST', body: form });
}
