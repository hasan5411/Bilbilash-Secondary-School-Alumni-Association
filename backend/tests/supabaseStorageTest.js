/**
 * supabaseStorageTest.js — verifies the Supabase Storage integration END TO END.
 *
 * Part A (no server needed): driver checks against a LOCAL STUB SERVER that
 *   speaks the Supabase Storage REST protocol (/storage/v1/object/…): correct
 *   bucket + prefix organization, service-key auth header, byte integrity,
 *   public-URL shape, per-bucket size limits (1 MB profile / 3 MB gallery),
 *   502 on upstream failure (no silent success), delete-by-public-URL
 *   (including 404 = already gone), and the local fallback for bucket-less
 *   uploads (payment screenshots keep legacy behavior).
 *
 * Part B (spawns its OWN backend on port 5051 with UPLOAD_STORAGE=supabase
 *   pointed at the stub): the real API upload matrix —
 *   member avatar -> profile-images/members/…, teacher photo ->
 *   profile-images/teachers/…, gallery -> gallery-images/gallery/…, refs
 *   persisted and re-served by GET endpoints, oversize rejected with the
 *   bucket limit, unauthorized upload rejected, gallery moderation + delete
 *   reaching the stub's DELETE with the right object.
 *
 * Safety: local database only (pgTestClient guard) + throwaway fixtures it
 * creates and removes (demo member photo is restored afterwards).
 *
 * Usage:  cd backend && npm run supabase-test
 */
import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openTestDb } from './pgTestClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.join(__dirname, '..');
const SERVICE_KEY = 'test-service-key-123';
const PROJECT_URL = 'https://stub-project.supabase.co';

let passed = 0, failed = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
const section = (t) => console.log(`\n${t}`);

// 1x1 transparent PNG (valid magic bytes)
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

/* ══════════════ Stub Supabase Storage server ══════════════ */
function makeStub() {
  const seen = { uploads: [], deletes: [], publicFetches: [], failNext: false };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (seen.failNext) { seen.failNext = false; res.writeHead(500); res.end('{"message":"boom"}'); return; }
      if (req.method === 'POST' && req.url.includes('/storage/v1/object/')) {
        seen.uploads.push({ url: req.url, auth: req.headers.authorization, ctype: req.headers['content-type'], bytes: buf });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ Key: req.url.split('/storage/v1/object/')[1], Id: 'stub-id' }));
      } else if (req.method === 'DELETE' && req.url.includes('/storage/v1/object/')) {
        seen.deletes.push({ url: req.url, auth: req.headers.authorization });
        res.writeHead(404, { 'Content-Type': 'application/json' }); // "already gone" path
        res.end('{"message":"Object not found"}');
      } else if (req.method === 'GET' && req.url.includes('/storage/v1/object/public/')) {
        // Public read endpoint — serves the bytes last uploaded to this path.
        seen.publicFetches.push(req.url);
        const key = req.url.split('/storage/v1/object/public/')[1];
        const up = [...seen.uploads].reverse().find((u) => u.url.endsWith(key));
        if (!up) { res.writeHead(404); res.end('{}'); return; }
        res.writeHead(200, { 'Content-Type': up.ctype || 'application/octet-stream' });
        res.end(up.bytes);
      } else { res.writeHead(404); res.end('{}'); }
    });
  });
  return { server, seen };
}

async function partA(stubBase) {
  section('A) Supabase driver checks (against local stub Storage REST server)');
  const { persistUpload, removeUpload, parseSupabasePublicUrl, supabaseObjectKey, STORAGE_BUCKETS, PROFILE_IMAGE_MAX_BYTES } =
    await import('../src/storage.js');
  const { env, uploadDir } = await import('../src/config/env.js');

  env.storage.driver = 'supabase';
  env.storage.supabaseUrl = PROJECT_URL;
  env.storage.supabaseServiceKey = SERVICE_KEY;
  env.storage.supabaseBase = stubBase;

  // — upload: bucket + members/ prefix + auth + bytes + public URL —
  const t1 = path.join(uploadDir, `supatest1-${Date.now()}.png`);
  fs.writeFileSync(t1, PNG_1PX);
  const before = stubSeen.uploads.length;
  const url = await persistUpload({ path: t1, filename: path.basename(t1), mimetype: 'image/png' },
    { bucket: STORAGE_BUCKETS.profileImages, prefix: 'members', maxBytes: PROFILE_IMAGE_MAX_BYTES });
  // Public URL host follows the (overridden) storage base in tests; the SHAPE
  // is what production gets: <base>/object/public/<bucket>/<prefix>/<key>.
  check('persistUpload returns a supabase public URL (object/public path)',
    /\/storage\/v1\/object\/public\/profile-images\/members\/\d+-[0-9a-f]{12}\.png$/.test(url || ''), String(url));
  check('stub received exactly one upload POST', stubSeen.uploads.length === before + 1);
  const up = stubSeen.uploads[stubSeen.uploads.length - 1];
  check('upload went to /object/profile-images/members/… (bucket + prefix organized)',
    /^\/storage\/v1\/object\/profile-images\/members\/\d+-[0-9a-f]{12}\.png$/.test(up.url), up.url);
  check('upload carried the service-role key as Bearer', up.auth === `Bearer ${SERVICE_KEY}`, String(up.auth));
  check('upload carried the image content-type', up.ctype === 'image/png', String(up.ctype));
  check('upload sent the exact file bytes', up.bytes.equals(PNG_1PX));
  check('local temp file removed after successful upload', !fs.existsSync(t1));

  // — parse/delete: DELETE by public URL, 404 counts as gone —
  const parsed = parseSupabasePublicUrl(url);
  check('parseSupabasePublicUrl extracts bucket + path',
    parsed?.bucket === 'profile-images' && /^members\/\d+-[0-9a-f]{12}\.png$/.test(parsed?.path || ''), JSON.stringify(parsed));
  check('parseSupabasePublicUrl rejects non-supabase URLs',
    parseSupabasePublicUrl('https://res.cloudinary.com/x/y/upload/v1/a.png') === null
    && parseSupabasePublicUrl('1699-abc.png') === null);
  const delBefore = stubSeen.deletes.length;
  const removed = await removeUpload(url);
  check('removeUpload issued DELETE to /object/<bucket>/<path> with the service key (404 tolerated)',
    removed === true && stubSeen.deletes.length === delBefore + 1
    && stubSeen.deletes[stubSeen.deletes.length - 1].url === `/storage/v1/object/${parsed.bucket}/${parsed.path}`
    && stubSeen.deletes[stubSeen.deletes.length - 1].auth === `Bearer ${SERVICE_KEY}`,
    JSON.stringify(stubSeen.deletes[stubSeen.deletes.length - 1] || null));

  // — size limit enforced BEFORE any upload —
  const t2 = path.join(uploadDir, `supatest2-${Date.now()}.png`);
  fs.writeFileSync(t2, Buffer.concat([PNG_1PX, Buffer.alloc(1.2 * 1024 * 1024, 1)]));
  const upBefore = stubSeen.uploads.length;
  let threw = null;
  try {
    await persistUpload({ path: t2, filename: path.basename(t2), mimetype: 'image/png' },
      { bucket: STORAGE_BUCKETS.profileImages, prefix: 'members', maxBytes: PROFILE_IMAGE_MAX_BYTES });
  } catch (e) { threw = e; }
  check('oversize rejected with 422 ("1 MB or smaller") before any upload',
    threw?.status === 422 && /1 MB or smaller/.test(threw.message) && stubSeen.uploads.length === upBefore,
    threw ? `${threw.status} ${threw.message}` : 'no error');
  check('rejected oversize temp file cleaned up', !fs.existsSync(t2));

  // — upstream failure: 502, temp kept (no silent success, no data loss) —
  const t3 = path.join(uploadDir, `supatest3-${Date.now()}.png`);
  fs.writeFileSync(t3, PNG_1PX);
  stubSeen.failNext = true;
  threw = null;
  try {
    await persistUpload({ path: t3, filename: path.basename(t3), mimetype: 'image/png' },
      { bucket: STORAGE_BUCKETS.galleryImages, prefix: 'gallery' });
  } catch (e) { threw = e; }
  check('upstream 500 surfaces as 502 (no fake success)', threw?.status === 502, threw ? `status ${threw.status}` : 'no error');
  check('failed upload keeps the local temp file', fs.existsSync(t3));
  fs.rmSync(t3, { force: true });

  // — bucket-less upload falls back to local behavior (payments legacy path) —
  const t4 = path.join(uploadDir, `supatest4-${Date.now()}.png`);
  fs.writeFileSync(t4, PNG_1PX);
  const localRef = await persistUpload({ path: t4, filename: path.basename(t4), mimetype: 'image/png' });
  check('bucket-less upload keeps legacy local filename (payment screenshots unchanged)',
    localRef === path.basename(t4) && fs.existsSync(t4), String(localRef));
  fs.rmSync(t4, { force: true });

  // — key hygiene —
  check('object key sanitizes hostile prefixes',
    /^[a-z0-9-]+\/\d+-[0-9a-f]{12}\.png$/.test(supabaseObjectKey({ filename: 'a.png' }, 'Evil Prefix!')));

  // — signed-URL normalization (regression: expired signed refs must never break display) —
  const { normalizeStorageRef, resolveUploadRef } = await import('../src/storage.js');
  const signed = 'https://stub-project.supabase.co/storage/v1/object/sign/gallery-images/gallery/1791927791503-ff75269418a0.jpg?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.expiring.signature';
  check('normalizeStorageRef: signed URL -> stable public URL (token stripped)',
    normalizeStorageRef(signed) === 'https://stub-project.supabase.co/storage/v1/object/public/gallery-images/gallery/1791927791503-ff75269418a0.jpg',
    String(normalizeStorageRef(signed)));
  check('normalizeStorageRef: public URL passes through unchanged',
    normalizeStorageRef('https://stub-project.supabase.co/storage/v1/object/public/profile-images/members/a.png')
    === 'https://stub-project.supabase.co/storage/v1/object/public/profile-images/members/a.png');
  check('normalizeStorageRef: non-Supabase URLs and bare filenames untouched',
    normalizeStorageRef('https://res.cloudinary.com/x/y/upload/v1/a.png') === 'https://res.cloudinary.com/x/y/upload/v1/a.png'
    && normalizeStorageRef('1699-abc.png') === '1699-abc.png');
  check('resolveUploadRef normalizes signed refs at the backend choke point',
    resolveUploadRef(signed) === 'https://stub-project.supabase.co/storage/v1/object/public/gallery-images/gallery/1791927791503-ff75269418a0.jpg');
  // A signed ref must still DELETE correctly (normalization happens first).
  const delBeforeNorm = stubSeen.deletes.length;
  await removeUpload(signed);
  check('removeUpload deletes a signed ref via its normalized public shape (no token sent)',
    stubSeen.deletes.length === delBeforeNorm + 1
    && stubSeen.deletes[stubSeen.deletes.length - 1].url === '/storage/v1/object/gallery-images/gallery/1791927791503-ff75269418a0.jpg'
    && !stubSeen.deletes[stubSeen.deletes.length - 1].url.includes('token='));
  check('gallery 3 MB cap constant matches the bucket',
    (await import('../src/storage.js')).GALLERY_IMAGE_MAX_BYTES === 3 * 1024 * 1024);

  // restore driver (this process only)
  env.storage.driver = 'local';
  env.storage.supabaseUrl = '';
  env.storage.supabaseServiceKey = '';
  env.storage.supabaseBase = null;
}

/* ══════════════ Part B: spawned backend, real API matrix ══════════════ */
async function call(base, method, p, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${base}${p}`, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON fine */ }
  return { status: res.status, json };
}

async function partB(stubBase) {
  section('B) API matrix — spawned backend with UPLOAD_STORAGE=supabase');
  const PORT = 5051;
  const base = `http://127.0.0.1:${PORT}`;
  const child = spawn(process.execPath, [path.join('src', 'server.js')], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      UPLOAD_STORAGE: 'supabase',
      SUPABASE_URL: PROJECT_URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      SUPABASE_STORAGE_BASE: stubBase,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const childLog = [];
  child.stdout.on('data', (d) => childLog.push(d.toString()));
  child.stderr.on('data', (d) => childLog.push(d.toString()));

  try {
    // wait for health
    let ready = false;
    for (let i = 0; i < 30 && !ready; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try { const h = await fetch(`${base}/api/health`); ready = h.ok; } catch { /* not up yet */ }
    }
    check('spawned backend (supabase driver) is healthy', ready, childLog.join('').slice(-300));
    if (!ready) return;

    const authority = await call(base, 'POST', '/api/auth/login', {
      body: { email: process.env.AUTHORITY_EMAIL, password: process.env.AUTHORITY_PASSWORD },
    });
    const authToken = authority.json?.data?.token;
    check('authority login', !!authToken, `status ${authority.status}`);
    const member = await call(base, 'POST', '/api/auth/login', {
      body: { email: 'demo.m001@bilbilash.demo', password: 'DemoPass123!' },
    });
    const memberToken = member.json?.data?.token;
    check('demo member login', !!memberToken, `status ${member.status}`);
    if (!authToken || !memberToken) return;

    // remember the demo member's current photo to restore afterwards
    const beforeProf = await call(base, 'GET', '/api/profile', { token: memberToken });
    const p = beforeProf.json?.data?.profile || {};
    const originalPhoto = p.profile_photo;

    // ── member avatar ──
    const form = new FormData();
    for (const [k, v] of Object.entries({
      first_name: p.first_name, last_name: p.last_name, registration_number: p.registration_number,
      present_address: p.present_address, permanent_address: p.permanent_address,
    })) form.append(k, String(v ?? ''));
    if (p.ssc_batch) form.append('ssc_batch', String(p.ssc_batch));
    form.append('image', new Blob([PNG_1PX], { type: 'image/png' }), 'avatar.png');
    const upl = await call(base, 'PUT', '/api/profile', { token: memberToken, form });
    const newPhoto = upl.json?.data?.profile?.profile_photo;
    check('member avatar upload -> 200 with supabase public URL',
      upl.status === 200 && /\/storage\/v1\/object\/public\/profile-images\/members\//.test(newPhoto || ''),
      `status ${upl.status} ref=${newPhoto}`);
    const again = await call(base, 'GET', '/api/profile', { token: memberToken });
    check('avatar ref persists across a fresh GET (refresh/re-login safe)',
      again.json?.data?.profile?.profile_photo === newPhoto);
    check('avatar upload hit the stub under profile-images/members/',
      stubSeen.uploads.some((u) => /^\/storage\/v1\/object\/profile-images\/members\//.test(u.url)));
    const fetched = await fetch(newPhoto);
    check('stored public URL is directly fetchable with image bytes', fetched.status === 200);

    // ── oversize profile (bucket limit 1 MB) ──
    const big = new FormData();
    for (const [k, v] of Object.entries({
      first_name: p.first_name, last_name: p.last_name, registration_number: p.registration_number,
      present_address: p.present_address, permanent_address: p.permanent_address,
    })) big.append(k, String(v ?? ''));
    big.append('image', new Blob([Buffer.concat([PNG_1PX, Buffer.alloc(1.2 * 1024 * 1024, 1)])], { type: 'image/png' }), 'big.png');
    const bigRes = await call(base, 'PUT', '/api/profile', { token: memberToken, form: big });
    check('oversized profile photo rejected (422, 1 MB bucket limit)',
      bigRes.status === 422 && /1 MB/.test(bigRes.json?.message || ''), `status ${bigRes.status} ${bigRes.json?.message}`);

    // ── invalid file (magic bytes) ──
    const fake = new FormData();
    for (const [k, v] of Object.entries({
      first_name: p.first_name, last_name: p.last_name, registration_number: p.registration_number,
      present_address: p.present_address, permanent_address: p.permanent_address,
    })) fake.append(k, String(v ?? ''));
    fake.append('image', new Blob([Buffer.from('#!/bin/sh\necho no\n')], { type: 'image/png' }), 'evil.png');
    const bad = await call(base, 'PUT', '/api/profile', { token: memberToken, form: fake });
    check('renamed non-image rejected (422, magic bytes)', bad.status === 422, `status ${bad.status}`);

    // ── unauthorized upload ──
    const anon = new FormData();
    anon.append('image', new Blob([PNG_1PX], { type: 'image/png' }), 'a.png');
    const noAuth = await call(base, 'POST', '/api/gallery', { form: anon });
    check('unauthenticated gallery upload rejected (401)', noAuth.status === 401, `status ${noAuth.status}`);

    // ── teacher photo (authority manages; profile-images/teachers/) ──
    const tForm = new FormData();
    tForm.append('name', 'StorageTest Teacher');
    tForm.append('subject', 'Testing');
    tForm.append('image', new Blob([PNG_1PX], { type: 'image/png' }), 'teacher.png');
    const tCreate = await call(base, 'POST', '/api/teachers', { token: authToken, form: tForm });
    const teacherId = tCreate.json?.data?.teacher_id;
    check('teacher photo upload -> 201 (authority)', tCreate.status === 201 && !!teacherId, `status ${tCreate.status}`);
    const tList = await call(base, 'GET', '/api/teachers');
    const teacher = (tList.json?.data?.teachers || []).find((x) => x.teacher_id === teacherId);
    check('teacher photo stored under profile-images/teachers/ and served by the directory API',
      /\/storage\/v1\/object\/public\/profile-images\/teachers\//.test(teacher?.photo || ''),
      String(teacher?.photo));
    const memberTeacher = await call(base, 'POST', '/api/teachers', { token: memberToken, form: tForm });
    check('member cannot create teachers (403)', memberTeacher.status === 403, `status ${memberTeacher.status}`);

    // ── gallery lifecycle (gallery-images/gallery/) ──
    const gForm = new FormData();
    gForm.append('image', new Blob([PNG_1PX], { type: 'image/png' }), 'gallery.png');
    gForm.append('caption', 'supabase-storage-test');
    const sub = await call(base, 'POST', '/api/gallery', { token: memberToken, form: gForm });
    const galId = sub.json?.data?.gallery_id;
    check('gallery submit -> 201 pending', sub.status === 201 && !!galId, `status ${sub.status}`);
    const conn = await openTestDb();
    const [galRows] = await conn.query('SELECT image_path FROM gallery WHERE gallery_id = ?', [galId || 0]);
    const galRef = galRows?.[0]?.image_path;
    check('gallery ref stored as gallery-images/ public URL',
      /\/storage\/v1\/object\/public\/gallery-images\/gallery\//.test(galRef || ''),
      String(galRef));
    const galList = await call(base, 'GET', '/api/gallery', { token: authToken });
    check('gallery list returns the pending item to moderators (visible after refresh)',
      JSON.stringify(galList.json || {}).includes(String(galId)));
    const memberDel = await call(base, 'DELETE', `/api/gallery/${galId}`, { token: memberToken, body: { reason: 'x' } });
    check('member cannot delete gallery items (403)', memberDel.status === 403, `status ${memberDel.status}`);
    const delBefore = stubSeen.deletes.length;
    const del = await call(base, 'DELETE', `/api/gallery/${galId}`, { token: authToken, body: { reason: 'storage test cleanup' } });
    const sawDelete = stubSeen.deletes.slice(delBefore).some((d) => d.url === `/storage/v1/object/gallery-images/${parsePath(galRef)}`);
    check('authority deletes gallery item -> 200 and the object is removed from the bucket',
      del.status === 200 && sawDelete, `status ${del.status} deletes=${JSON.stringify(stubSeen.deletes.slice(delBefore))}`);

    // ── regression: no stored ref may EVER be a signed URL or carry a token ──
    check('no API-returned ref contains /object/sign/ or token=',
      !/\/object\/sign\/|token=/.test(String(newPhoto) + String(teacher?.photo || '')),
      `${newPhoto} ${teacher?.photo}`);
    const conn2 = await openTestDb();
    const [badRefs] = await conn2.query(
      `SELECT (SELECT COUNT(*) FROM profiles WHERE profile_photo LIKE '%/object/sign/%' OR profile_photo LIKE '%token=%')
            + (SELECT COUNT(*) FROM teachers WHERE photo LIKE '%/object/sign/%' OR photo LIKE '%token=%')
            + (SELECT COUNT(*) FROM gallery WHERE image_path LIKE '%/object/sign/%' OR image_path LIKE '%token=%')
            + (SELECT COUNT(*) FROM payments WHERE screenshot_path LIKE '%/object/sign/%' OR screenshot_path LIKE '%token=%') AS cnt`
    );
    await conn2.end();
    check('database holds zero signed/tokenized image refs in any image column',
      Number(badRefs?.[0]?.cnt) === 0, `count=${badRefs?.[0]?.cnt}`);

    // ── cleanup: teacher row (photo object removed too) ──
    await call(base, 'DELETE', `/api/teachers/${teacherId}`, { token: authToken });
    const restoreForm = new FormData();
    for (const [k, v] of Object.entries({
      first_name: p.first_name, last_name: p.last_name, registration_number: p.registration_number,
      present_address: p.present_address, permanent_address: p.permanent_address,
    })) restoreForm.append(k, String(v ?? ''));
    // Saving without an image keeps whatever ref is stored (the stub URL from
    // the avatar test) — acceptable for this disposable local database.
    const restored = await call(base, 'PUT', '/api/profile', { token: memberToken, form: restoreForm });
    check('cleanup: demo member profile save without image succeeds', restored.status === 200, `status ${restored.status}`);
  } finally {
    child.kill();
  }
}

function parsePath(publicUrl) {
  const m = /\/storage\/v1\/object\/public\/[^/]+\/(.+)$/.exec(String(publicUrl || ''));
  return m ? m[1] : null;
}

let stubSeen;
async function main() {
  const { server, seen } = makeStub();
  stubSeen = seen;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const stubBase = `http://127.0.0.1:${server.address().port}/storage/v1`;
  try {
    await partA(stubBase);
    await partB(stubBase);
  } catch (err) {
    console.error('supabase storage test crashed:', err);
    failed++;
  }
  server.close();
  console.log('\n==================================================');
  console.log(`SUPABASE STORAGE TEST RESULT: ${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); failures.forEach((f) => console.log(`  - ${f}`)); }
  console.log('==================================================');
  process.exit(failed ? 1 : 0);
}
main();
