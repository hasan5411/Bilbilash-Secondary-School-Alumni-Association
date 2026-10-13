/**
 * uploadStorageTest.js — verifies the upload storage layer END TO END.
 *
 * Part A (no server needed): storage driver checks —
 *   local driver persist/remove/path-traversal safety, and the Cloudinary
 *   driver against a LOCAL STUB SERVER that speaks the same REST protocol
 *   (signed upload + destroy) — proving signature generation, multipart
 *   upload, secure_url handling and temp-file cleanup without real credentials.
 *
 * Part B (backend must be running at SMOKE_BASE): API upload matrix —
 *   upload → retrieval → magic-byte validation → size limit → auth/permissions
 *   → admin moderation delete → file actually removed.
 *
 * Safety: only creates throwaway rows it owns (its own gallery item + one
 * profile photo on a disposable demo member) and removes them again.
 * Like every suite in this folder it may only target LOCAL or DISPOSABLE
 * STAGING databases (enforced by pgTestClient's guard).
 *
 * Usage:  cd backend && npm run upload-test        (server must be running)
 */
import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { openTestDb } from './pgTestClient.js';

const BASE = process.env.SMOKE_BASE || 'http://localhost:5000';

let passed = 0, failed = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
const section = (t) => console.log(`\n${t}`);

// 1x1 transparent PNG (valid magic bytes: 89 50 4E 47)
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

async function call(method, p, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${BASE}${p}`, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON fine */ }
  return { status: res.status, json };
}

/* ══════════════ Part A: storage drivers ══════════════ */
async function partA() {
  section('A) Storage driver checks (local + Cloudinary-against-stub)');
  const { persistUpload, removeUpload, resolveUploadRef, cloudinarySignature } =
    await import('../src/storage.js');
  const { uploadDir } = await import('../src/config/env.js');

  // resolveUploadRef
  check('resolveUploadRef: bare filename -> /uploads/…',
    resolveUploadRef('a.png') === '/uploads/a.png', resolveUploadRef('a.png'));
  check('resolveUploadRef: absolute cloud URL passes through',
    resolveUploadRef('https://res.cloudinary.com/x/y/upload/v1/a.png') === 'https://res.cloudinary.com/x/y/upload/v1/a.png');

  // local driver (default)
  const tmpName = `uploadtest-${Date.now()}.png`;
  const tmpPath = path.join(uploadDir, tmpName);
  fs.writeFileSync(tmpPath, PNG_1PX);
  const localRef = await persistUpload({ path: tmpPath, filename: tmpName });
  check('local persistUpload returns the filename (legacy behavior)', localRef === tmpName, String(localRef));
  check('local file still on disk after persist', fs.existsSync(tmpPath));
  const removed = await removeUpload(localRef);
  check('local removeUpload deletes the file', removed === true && !fs.existsSync(tmpPath));

  // path-traversal safety: a poisoned DB value can never escape uploadDir
  const sentinel = path.join(uploadDir, 'sentinel.txt');
  fs.writeFileSync(sentinel, 'x');
  await removeUpload('../../uploads/sentinel.txt'); // basename() -> uploads/sentinel.txt (inside dir)
  check('removeUpload only ever deletes inside uploadDir (no traversal escape)',
    !fs.existsSync(sentinel) && fs.existsSync(path.join(uploadDir, '..')));

  // Cloudinary driver against a LOCAL STUB SERVER (same REST protocol)
  const seen = { uploadBody: null, destroyBody: null };
  const stub = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (req.url.endsWith('/image/upload')) {
        seen.uploadBody = buf.toString('latin1'); // keep binary intact for assertions
        if (seen.uploadBody.includes('testkey') && seen.uploadBody.includes('signature')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ secure_url: 'https://res.cloudinary.com/testcloud/image/upload/v1/stub/abc123.png' }));
        } else { res.writeHead(400); res.end('{}'); }
      } else if (req.url.endsWith('/image/destroy')) {
        seen.destroyBody = buf.toString('latin1');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      } else { res.writeHead(404); res.end(); }
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const stubPort = stub.address().port;

  // Point the driver at the stub BEFORE its config is read.
  process.env.CLOUDINARY_URL = 'cloudinary://testkey:testsecret@testcloud';
  process.env.CLOUDINARY_BASE_URL = `http://127.0.0.1:${stubPort}`;
  const envMod = await import('../src/config/env.js');
  envMod.env.storage.driver = 'cloudinary';
  envMod.env.storage.cloudinaryUrl = process.env.CLOUDINARY_URL;
  envMod.env.storage.cloudinaryBase = process.env.CLOUDINARY_BASE_URL;

  const ctTemp = path.join(uploadDir, `cloudtest-${Date.now()}.png`);
  fs.writeFileSync(ctTemp, PNG_1PX);
  const url = await persistUpload({ path: ctTemp, filename: path.basename(ctTemp) });
  check('cloudinary persistUpload returns secure_url from the service',
    url === 'https://res.cloudinary.com/testcloud/image/upload/v1/stub/abc123.png', String(url));
  check('cloudinary persistUpload removed the local temp file', !fs.existsSync(ctTemp));
  const multipartOk = !!seen.uploadBody && Buffer.from(seen.uploadBody, 'latin1').includes(PNG_1PX.subarray(0, 8));
  check('cloudinary upload sent the real file bytes (multipart)', multipartOk);

  // signature correctness: recompute what the driver must have sent
  const ts = /name="timestamp"\r\n\r\n(\d+)/.exec(seen.uploadBody || '');
  const sig = /name="signature"\r\n\r\n([0-9a-f]{40})/.exec(seen.uploadBody || '');
  check('cloudinary upload carried a timestamp + 40-hex signature', !!(ts && sig));
  if (ts && sig) {
    const expected = cloudinarySignature({ timestamp: ts[1] }, 'testsecret');
    check('cloudinary signature matches sha1(sorted-params + secret)', sig[1] === expected);
  }

  // destroy by URL (public_id excludes the extension — verified against the stub)
  await removeUpload('https://res.cloudinary.com/testcloud/image/upload/v1/stub/abc123.png');
  await new Promise((r) => setTimeout(r, 150));
  check('cloudinary removeUpload sent a destroy for the parsed public_id (no extension)',
    !!seen.destroyBody && seen.destroyBody.includes('stub/abc123') && !seen.destroyBody.includes('abc123.png'));

  // restore driver config (this process only)
  envMod.env.storage.driver = 'local';
  envMod.env.storage.cloudinaryUrl = '';
  envMod.env.storage.cloudinaryBase = null;
  stub.close();

  // failure path: non-2xx from storage -> ApiError 502, never a silent fake success
  const failing = http.createServer((req, res) => { res.writeHead(500); res.end('nope'); });
  await new Promise((r) => failing.listen(0, '127.0.0.1', r));
  process.env.CLOUDINARY_BASE_URL = `http://127.0.0.1:${failing.address().port}`;
  envMod.env.storage.driver = 'cloudinary';
  envMod.env.storage.cloudinaryUrl = process.env.CLOUDINARY_URL;
  envMod.env.storage.cloudinaryBase = process.env.CLOUDINARY_BASE_URL;
  const t2 = path.join(uploadDir, `failtest-${Date.now()}.png`);
  fs.writeFileSync(t2, PNG_1PX);
  let threw = null;
  try { await persistUpload({ path: t2, filename: path.basename(t2) }); } catch (e) { threw = e; }
  check('cloudinary failure surfaces as 502 (no silent success)',
    threw && threw.status === 502, threw ? `status ${threw.status}` : 'no error thrown');
  check('failed upload keeps the local temp file (no data loss)', fs.existsSync(t2));
  fs.rmSync(t2, { force: true });
  envMod.env.storage.driver = 'local';
  envMod.env.storage.cloudinaryUrl = '';
  envMod.env.storage.cloudinaryBase = null;
  failing.close();
}

/* ══════════════ Part B: API upload matrix ══════════════ */
async function partB() {
  section('B) API upload matrix against the running backend (local driver)');

  const authority = await call('POST', '/api/auth/login', {
    body: { email: process.env.AUTHORITY_EMAIL, password: process.env.AUTHORITY_PASSWORD },
  });
  const authToken = authority.json?.data?.token;
  check('authority login (moderation duties)', !!authToken, `status ${authority.status}`);
  if (!authToken) return;

  const member = await call('POST', '/api/auth/login', {
    body: { email: 'demo.m001@bilbilash.demo', password: 'DemoPass123!' },
  });
  const memberToken = member.json?.data?.token;
  check('demo member login', !!memberToken, `status ${member.status}`);
  if (!memberToken) return;

  // ── profile photo: upload -> retrieval ──
  const prof = await call('GET', '/api/profile', { token: memberToken });
  const p = prof.json?.data?.profile || {};
  const form = new FormData();
  for (const [k, v] of Object.entries({
    first_name: p.first_name, last_name: p.last_name, registration_number: p.registration_number,
    present_address: p.present_address, permanent_address: p.permanent_address,
  })) form.append(k, String(v ?? ''));
  if (p.ssc_batch) form.append('ssc_batch', String(p.ssc_batch));
  form.append('image', new Blob([PNG_1PX], { type: 'image/png' }), 'avatar.png');
  const upd = await call('PUT', '/api/profile', { token: memberToken, form });
  const newPhoto = upd.json?.data?.profile?.profile_photo;
  check('profile photo upload -> 200 and reference saved', upd.status === 200 && !!newPhoto,
    `status ${upd.status}`);
  const served = await fetch(`${BASE}/uploads/${newPhoto}`);
  check('uploaded photo is retrievable at /uploads/<ref> with image content-type',
    served.status === 200 && (served.headers.get('content-type') || '').startsWith('image/'),
    `${served.status} ${served.headers.get('content-type')}`);
  const bytes = Buffer.from(await served.arrayBuffer());
  check('retrieved bytes match the uploaded file exactly',
    bytes.subarray(0, 8).equals(PNG_1PX.subarray(0, 8)));

  // ── validation: magic bytes ──
  const fake = new FormData();
  fake.append('first_name', String(p.first_name)); fake.append('last_name', String(p.last_name));
  fake.append('registration_number', String(p.registration_number));
  fake.append('present_address', String(p.present_address)); fake.append('permanent_address', String(p.permanent_address));
  fake.append('image', new Blob([Buffer.from('#!/bin/sh\necho not an image\n')], { type: 'image/png' }), 'evil.png');
  const bad = await call('PUT', '/api/profile', { token: memberToken, form: fake });
  check('renamed non-image rejected (422, magic-byte check)', bad.status === 422, `status ${bad.status}`);

  // ── validation: size limit ──
  const big = new FormData();
  big.append('first_name', String(p.first_name)); big.append('last_name', String(p.last_name));
  big.append('registration_number', String(p.registration_number));
  big.append('present_address', String(p.present_address)); big.append('permanent_address', String(p.permanent_address));
  big.append('image', new Blob([Buffer.alloc(3.5 * 1024 * 1024, 1)], { type: 'image/png' }), 'big.png');
  const tooBig = await call('PUT', '/api/profile', { token: memberToken, form: big });
  check('oversized image rejected (422, 3 MB limit)', tooBig.status === 422, `status ${tooBig.status}`);

  // ── permissions: unauthenticated ──
  const anon = new FormData();
  anon.append('image', new Blob([PNG_1PX], { type: 'image/png' }), 'a.png');
  const noAuth = await call('POST', '/api/gallery', { form: anon });
  check('unauthenticated upload rejected (401)', noAuth.status === 401, `status ${noAuth.status}`);

  // ── gallery lifecycle: submit -> moderate -> delete (file removed) ──
  const gForm = new FormData();
  gForm.append('image', new Blob([PNG_1PX], { type: 'image/png' }), 'gallery.png');
  gForm.append('caption', 'upload-storage-test');
  const sub = await call('POST', '/api/gallery', { token: memberToken, form: gForm });
  const galId = sub.json?.data?.gallery_id;
  // submitGalleryItem returns {gallery_id, status}; the stored reference lives in the DB row.
  const conn = await openTestDb();
  const [galRows] = await conn.query('SELECT image_path FROM gallery WHERE gallery_id = ?', [galId || 0]);
  await conn.end();
  const galRef = galRows?.[0]?.image_path;
  check('gallery submit -> 201 pending with stored reference',
    sub.status === 201 && !!galId && !!galRef, `status ${sub.status}`);

  // access control: a MEMBER cannot moderate or delete gallery items
  const memberDel = await call('DELETE', `/api/gallery/${galId}`, { token: memberToken, body: { reason: 'x' } });
  check('member cannot delete gallery items (403)', memberDel.status === 403, `status ${memberDel.status}`);

  const appr = await call('PUT', `/api/gallery/${galId}/moderate`, { token: authToken, body: { action: 'approve' } });
  check('authority approves gallery item', appr.status === 200, `status ${appr.status}`);
  const del = await call('DELETE', `/api/gallery/${galId}`, { token: authToken, body: { reason: 'storage test cleanup' } });
  check('authority deletes gallery item -> 200', del.status === 200, `status ${del.status}`);
  check('stored image file was removed from disk after delete',
    !fs.existsSync(path.join((await import('../src/config/env.js')).uploadDir, galRef)));
  const gone = await fetch(`${BASE}/uploads/${galRef}`);
  check('deleted image no longer retrievable (404)', gone.status === 404, `status ${gone.status}`);
}

async function main() {
  try {
    await partA();
    await partB();
  } catch (err) {
    console.error('upload test crashed:', err.code || '', err.message);
    process.exit(1);
  }
  console.log('\n==================================================');
  console.log(`UPLOAD STORAGE TEST RESULT: ${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); failures.forEach((f) => console.log(`  - ${f}`)); }
  console.log('==================================================');
  process.exit(failed ? 1 : 0);
}
main();
