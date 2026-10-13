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
 * Two drivers, selected by env (UPLOAD_STORAGE / CLOUDINARY_URL):
 *   'local'      — current behavior: keep the multer-written file in
 *                  backend/uploads/ and store its filename in the DB.
 *   'cloudinary' — signed upload to Cloudinary (no SDK; plain HTTPS via
 *                  fetch). The DB stores the returned secure_url; the local
 *                  temp file is removed afterwards.
 *
 * DB columns keep the same shape either way: a REFERENCE string that is
 * either a bare filename (local) or an absolute https URL (cloudinary).
 * Frontend resolves it via utils.mediaUrl(); backend via resolveUploadRef().
 *
 * Credentials never live in code: CLOUDINARY_URL is read from the environment
 * (Render dashboard / backend/.env locally), e.g.
 *   CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name
 */
const isAbsoluteRef = (ref) => /^https?:\/\//i.test(String(ref || ''));

/** DB reference -> URL the browser can request. */
export function resolveUploadRef(ref) {
  if (!ref) return null;
  if (isAbsoluteRef(ref)) return ref;
  return `/uploads/${path.basename(String(ref))}`;
}

/**
 * Finalize a multer file into the reference to store in the DB.
 * Call AFTER assertImageMagic() and BEFORE the database write.
 * Local driver: returns the filename (unchanged legacy behavior).
 * Cloudinary driver: uploads, deletes the local temp file, returns secure_url.
 */
export async function persistUpload(file) {
  if (!file) return null;
  if (env.storage.driver === 'cloudinary') return cloudinaryUpload(file);
  return file.filename;
}

/** Remove a stored upload by its DB reference. Never throws (best-effort). */
export async function removeUpload(ref) {
  if (!ref) return false;
  if (isAbsoluteRef(ref)) {
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
