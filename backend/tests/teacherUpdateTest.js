/**
 * teacherUpdateTest.js — Teacher Management UPDATE (PUT /api/teachers/:id).
 *
 * Covers the whole update contract used by the Manage Teachers page:
 *   A) Authorization — anonymous 401, MEMBER 403, ADMIN/AUTHORITY 200.
 *   B) Field updates — every editable field is written, the SAME teacher_id is
 *      kept, no duplicate row is created, created_at/created_by untouched.
 *   C) Images — add a photo to a teacher who had none, replace an existing
 *      photo (old stored file deleted only AFTER the swap), update other fields
 *      without a file (photo preserved, file kept), failed/invalid upload
 *      (422, previous photo and file untouched).
 *   D) Validation — missing name 422, non-numeric id 400, unknown id 404.
 *   E) Consistency — public directory and the profile endpoint return the
 *      updated values immediately after each write (no stale cache).
 *   F) Regressions — Add still works, Delete still works and removes the file.
 *
 * Requires: local PostgreSQL running (node tests/pgServer.js) with backend/.env
 * pointing at it, and the LOCAL upload driver (no Supabase/Cloudinary env).
 * NEVER runs against a remote DB (pgTestClient guard). Every fixture is
 * prefixed `tupd.` / `TUPD-` and removed afterwards, photo files included.
 *
 * Usage: cd backend && node tests/teacherUpdateTest.js   (npm run teacher-update-test)
 */
import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const stamp = Date.now();
const EMAIL = (tag) => `tupd.${tag}.${stamp}@example.com`;
const PASSWORD = 'Tupd1!pass';
const NAME = (tag) => `TUPD-${stamp}-${tag}`;

// 1×1 transparent PNG and a 1×1 PNG with different bytes (valid, distinct file).
const PNG_A = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex');
const PNG_B = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f6d', 'hex');

let passed = 0;
let failed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; failures.push(name); console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`);

async function main() {
  const { openTestDb } = await import('./pgTestClient.js');
  const { createApp } = await import('../src/app.js');
  const { uploadDir } = await import('../src/config/env.js');
  const { env } = await import('../src/config/env.js');

  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;

  async function call(method, p, { body, form, token } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${BASE}${p}`, {
      method,
      headers,
      body: form || (body ? JSON.stringify(body) : undefined),
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON answers are fine */ }
    return { status: res.status, json, message: json?.message || '' };
  }

  const fileOnDisk = (ref) => Boolean(ref) && fs.existsSync(path.join(uploadDir, path.basename(String(ref))));

  const teacherForm = (fields, image, filename = 'teacher.png', type = 'image/png') => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    if (image) fd.append('image', new Blob([image], { type }), filename);
    return fd;
  };

  let conn;
  try {
    conn = await openTestDb();
    if (env.storage.driver !== 'local') {
      console.error(`[test] this suite verifies local upload storage; UPLOAD_STORAGE=${env.storage.driver}`);
      process.exit(1);
    }

    section('Setup: fixtures (roles/users)');
    await conn.query(
      `INSERT INTO roles (role_name, description) VALUES
         ('VISITOR','x'),('MEMBER','x'),('ADMIN','x'),('AUTHORITY','x')
       ON CONFLICT DO NOTHING`
    );
    const hash = await bcrypt.hash(PASSWORD, 10);
    const mkUser = async (tag, role) => {
      const [res] = await conn.query(
        `INSERT INTO users (role_id, first_name, last_name, email, password_hash, status, is_active, token_version)
         SELECT role_id, ?, 'TeacherUpd', ?, ?, 'approved', 1, 0
           FROM roles WHERE role_name = ? RETURNING user_id`,
        [tag, EMAIL(tag), hash, role]
      );
      return Number(res.insertId);
    };
    const adminId = await mkUser('admin', 'ADMIN');
    const authorityId = await mkUser('authority', 'AUTHORITY');
    const memberId = await mkUser('member', 'MEMBER');

    const login = async (email) => {
      const res = await call('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
      return res.json?.data?.token || null;
    };
    const adminToken = await login(EMAIL('admin'));
    const authorityToken = await login(EMAIL('authority'));
    const memberToken = await login(EMAIL('member'));
    check('fixture logins work (admin/authority/member)', Boolean(adminToken && authorityToken && memberToken));

    // ── A) Authorization ────────────────────────────────────────────────
    section('A) Authorization');
    const probe = teacherForm({ name: NAME('AUTHZ') });
    const anon = await call('PUT', '/api/teachers/1', { form: teacherForm({ name: NAME('AUTHZ') }) });
    check('anonymous PUT -> 401', anon.status === 401, `status ${anon.status}`);
    const member = await call('PUT', '/api/teachers/1', { form: teacherForm({ name: NAME('AUTHZ') }), token: memberToken });
    check('MEMBER PUT -> 403', member.status === 403, `status ${member.status}`);
    const badToken = await call('PUT', '/api/teachers/1', { form: probe, token: 'not-a-token' });
    check('bogus token PUT -> 401', badToken.status === 401, `status ${badToken.status}`);

    // ── F1) Add still works (regression) ───────────────────────────────
    section('F) Add teacher still works (regression)');
    const created = await call('POST', '/api/teachers', {
      token: authorityToken,
      form: teacherForm({ name: NAME('CREATE'), subject: 'Mathematics' }),
    });
    const teacherId = Number(created.json?.data?.teacher_id);
    check('authority adds teacher -> 201', created.status === 201 && Number.isInteger(teacherId), `status ${created.status} ${created.message}`);
    const [beforeRows] = await conn.query('SELECT * FROM teachers WHERE teacher_id = ?', [teacherId]);
    const before = beforeRows[0];

    // ── B) Field updates ───────────────────────────────────────────────
    section('B) Field updates keep the id and create no duplicate');
    const upd = await call('PUT', `/api/teachers/${teacherId}`, {
      token: adminToken,
      form: teacherForm({
        name: NAME('UPDATED'),
        subject: 'Physics',
        designation: 'Senior Teacher',
        institution: 'Bilbilash Secondary School',
        description: 'Updated biography text.',
      }),
    });
    check('admin updates teacher -> 200', upd.status === 200, `status ${upd.status} ${upd.message}`);
    check('response reports the same teacher_id', Number(upd.json?.data?.teacher_id) === teacherId, String(upd.json?.data?.teacher_id));
    const [afterRows] = await conn.query('SELECT * FROM teachers WHERE teacher_id = ?', [teacherId]);
    const after = afterRows[0];
    check('name updated', after?.name === NAME('UPDATED'), String(after?.name));
    check('subject updated', after?.subject === 'Physics', String(after?.subject));
    check('designation updated', after?.designation === 'Senior Teacher', String(after?.designation));
    check('institution updated', after?.institution === 'Bilbilash Secondary School', String(after?.institution));
    check('description updated', after?.description === 'Updated biography text.', String(after?.description));
    check('created_at preserved (row updated, not recreated)',
      String(after?.created_at) === String(before?.created_at), `${before?.created_at} -> ${after?.created_at}`);
    check('created_by preserved', Number(after?.created_by) === Number(before?.created_by));
    const [dup] = await conn.query(`SELECT COUNT(*) AS n FROM teachers WHERE name LIKE ?`, [`TUPD-${stamp}%`]);
    check('exactly one record for this teacher (no duplicate)', Number(dup[0].n) === 1, `count ${dup[0].n}`);

    // ── E) Consistency across public endpoints ─────────────────────────
    section('E) Public directory + profile reflect the update');
    const list = await call('GET', '/api/teachers');
    const inList = (list.json?.data?.teachers || []).find((t) => Number(t.teacher_id) === teacherId);
    check('teacher directory shows updated fields',
      inList?.name === NAME('UPDATED') && inList?.subject === 'Physics' && inList?.designation === 'Senior Teacher',
      JSON.stringify(inList));
    const one = await call('GET', `/api/teachers/${teacherId}`);
    check('profile endpoint shows updated fields',
      one.json?.data?.teacher?.name === NAME('UPDATED') && one.json?.data?.teacher?.description === 'Updated biography text.',
      JSON.stringify(one.json?.data?.teacher));
    check('no auth material in teacher payload',
      !JSON.stringify(one.json).includes('password') && !JSON.stringify(one.json).includes('token_version'));

    // ── C1) Add an image to a teacher who had none ─────────────────────
    section('C1) Image added to a teacher who had none');
    const addPhoto = await call('PUT', `/api/teachers/${teacherId}`, {
      token: authorityToken,
      form: teacherForm({ name: NAME('UPDATED'), subject: 'Physics' }, PNG_A),
    });
    check('update with image -> 200', addPhoto.status === 200, `status ${addPhoto.status} ${addPhoto.message}`);
    const [withPhotoRows] = await conn.query('SELECT photo FROM teachers WHERE teacher_id = ?', [teacherId]);
    const photoA = withPhotoRows[0]?.photo;
    check('photo reference stored', Boolean(photoA), String(photoA));
    check('uploaded file exists on disk', fileOnDisk(photoA), String(photoA));
    const listPhoto = (await call('GET', '/api/teachers')).json?.data?.teachers?.find((t) => Number(t.teacher_id) === teacherId);
    check('directory exposes the new photo', listPhoto?.photo === photoA, String(listPhoto?.photo));

    // ── C2) Update other fields without selecting a new image ──────────
    section('C2) Update without a new image keeps the existing photo');
    const noImage = await call('PUT', `/api/teachers/${teacherId}`, {
      token: authorityToken,
      form: teacherForm({ name: NAME('UPDATED'), designation: 'Head of Science' }),
    });
    check('update without image -> 200', noImage.status === 200, `status ${noImage.status} ${noImage.message}`);
    const [noImageRows] = await conn.query('SELECT photo, designation FROM teachers WHERE teacher_id = ?', [teacherId]);
    check('photo reference unchanged', noImageRows[0]?.photo === photoA, `${photoA} -> ${noImageRows[0]?.photo}`);
    check('existing file still on disk', fileOnDisk(photoA));
    check('other field still updated', noImageRows[0]?.designation === 'Head of Science', String(noImageRows[0]?.designation));

    // ── C3) Replace the existing image ────────────────────────────────
    section('C3) Existing image replaced (old file cleaned up after the swap)');
    const replace = await call('PUT', `/api/teachers/${teacherId}`, {
      token: authorityToken,
      form: teacherForm({ name: NAME('UPDATED'), designation: 'Head of Science' }, PNG_B),
    });
    check('replace image -> 200', replace.status === 200, `status ${replace.status} ${replace.message}`);
    const [replacedRows] = await conn.query('SELECT photo FROM teachers WHERE teacher_id = ?', [teacherId]);
    const photoB = replacedRows[0]?.photo;
    check('photo reference changed', Boolean(photoB) && photoB !== photoA, `${photoA} -> ${photoB}`);
    check('new file exists on disk', fileOnDisk(photoB), String(photoB));
    check('old file removed from disk', !fileOnDisk(photoA), String(photoA));
    const afterReplace = (await call('GET', `/api/teachers/${teacherId}`)).json?.data?.teacher;
    check('profile shows the replacement photo', afterReplace?.photo === photoB, String(afterReplace?.photo));

    // ── C4) Failed image upload preserves everything ──────────────────
    section('C4) Invalid image upload is rejected and nothing is lost');
    const badImage = await call('PUT', `/api/teachers/${teacherId}`, {
      token: authorityToken,
      form: teacherForm({ name: NAME('SHOULD-NOT-APPLY') }, Buffer.from('this is not an image at all'), 'evil.png'),
    });
    check('non-image bytes -> 422', badImage.status === 422, `status ${badImage.status} ${badImage.message}`);
    const [badRows] = await conn.query('SELECT name, photo FROM teachers WHERE teacher_id = ?', [teacherId]);
    check('record untouched by the failed upload (name)', badRows[0]?.name === NAME('UPDATED'), String(badRows[0]?.name));
    check('existing photo preserved by the failed upload', badRows[0]?.photo === photoB, String(badRows[0]?.photo));
    check('existing photo file still on disk', fileOnDisk(photoB));
    const wrongType = await call('PUT', `/api/teachers/${teacherId}`, {
      token: authorityToken,
      form: teacherForm({ name: NAME('X') }, PNG_A, 'photo.txt', 'text/plain'),
    });
    check('non-image MIME -> 422', wrongType.status === 422, `status ${wrongType.status} ${wrongType.message}`);

    // ── D) Validation + not-found ─────────────────────────────────────
    section('D) Validation and lookup errors');
    const noName = await call('PUT', `/api/teachers/${teacherId}`, {
      token: authorityToken, form: teacherForm({ subject: 'Chemistry' }),
    });
    check('missing name -> 422', noName.status === 422, `status ${noName.status} ${noName.message}`);
    const [noNameRows] = await conn.query('SELECT name FROM teachers WHERE teacher_id = ?', [teacherId]);
    check('record not changed by a failed validation', noNameRows[0]?.name === NAME('UPDATED'), String(noNameRows[0]?.name));
    const badId = await call('PUT', '/api/teachers/abc', { token: authorityToken, form: teacherForm({ name: 'x' }) });
    check('non-numeric id -> 400', badId.status === 400, `status ${badId.status}`);
    const missing = await call('PUT', '/api/teachers/99999999', { token: authorityToken, form: teacherForm({ name: 'ghost' }) });
    check('unknown id -> 404', missing.status === 404, `status ${missing.status}`);

    // ── F2) Delete still works and removes the stored file ────────────
    section('F2) Delete teacher still works (regression)');
    const del = await call('DELETE', `/api/teachers/${teacherId}`, { token: authorityToken });
    check('authority deletes teacher -> 200', del.status === 200, `status ${del.status} ${del.message}`);
    const [goneRows] = await conn.query('SELECT teacher_id FROM teachers WHERE teacher_id = ?', [teacherId]);
    check('row is gone', goneRows.length === 0);
    check('deleted teacher photo removed from disk', !fileOnDisk(photoB), String(photoB));
    const gone = await call('GET', `/api/teachers/${teacherId}`);
    check('profile endpoint returns 404 after delete', gone.status === 404, `status ${gone.status}`);
  } finally {
    // Cleanup: own fixtures only (rows + upload files).
    if (conn) {
      const [rows] = await conn.query(`SELECT photo FROM teachers WHERE name LIKE ?`, [`TUPD-${stamp}%`]);
      for (const r of rows) {
        if (r.photo) { try { fs.unlinkSync(path.join(uploadDir, path.basename(String(r.photo)))); } catch { /* ignore */ } }
      }
      await conn.query(`DELETE FROM teachers WHERE name LIKE ?`, [`TUPD-${stamp}%`]);
      await conn.query(`DELETE FROM users WHERE email LIKE ?`, [`tupd.%.${stamp}@example.com`]);
      await conn.end();
    }
    await new Promise((r) => server.close(r));
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`TEACHER UPDATE TEST RESULT: ${passed} passed, ${failed} failed`);
  if (failures.length) console.log(`\nFailures:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('teacherUpdateTest crashed:', err);
  process.exit(1);
});
