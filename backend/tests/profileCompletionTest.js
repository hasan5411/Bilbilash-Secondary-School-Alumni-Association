/**
 * Profile Completion Percentage — automated test suite.
 *
 * Usage:  cd backend && npm run profile-test     (backend must be running on :5000)
 *
 * The completion denominator is EXACTLY the Profile Update form's inputs
 * (14 fields — see src/utils/profileCompletion.js).
 *
 * Sections:
 *   1. Unit — calculation formula, rounding, empty/whitespace/null/invalid
 *      values, the "phone/profession/institute/blood empty ≠ 100%" scenario,
 *      no-config safety (no server needed).
 *   2. Unit — color thresholds at 49/50/84/85/100 (frontend util, no server).
 *   3. Live API — real registration → approval → login → GET/PUT behaviour,
 *      photo upload, admin member detail, cross-user access control.
 *
 * FIXTURES: this suite only ever creates/deletes its own record
 * (pct.member@bilbilash.demo / PCT-MEMBER01) and its own photo file. It
 * pre-cleans leftovers from crashed runs, so repeated runs are deterministic.
 * No other user's data is touched.
 */
import 'dotenv/config';
import { openTestDb } from './pgTestClient.js';
import fs from 'node:fs';
import path from 'node:path';
import { uploadDir } from '../src/config/env.js';
import { computeProfileCompletion, COMPLETION_FIELDS } from '../src/utils/profileCompletion.js';
import { completionColor, COMPLETION_COLORS } from '../../frontend/src/utils/completion.js';

const BASE = process.env.SMOKE_BASE || 'http://localhost:5000';
const AUTHORITY_EMAIL = process.env.AUTHORITY_EMAIL || 'mdhasankhanhk04@gmail.com';
const AUTHORITY_PASSWORD = process.env.AUTHORITY_PASSWORD;

const FIX_EMAIL = 'pct.member@bilbilash.demo';
const FIX_PASSWORD = 'PctTest12345!';
const FIX_REG = 'PCT-MEMBER01';
const FIX_LIKE = 'pct.%@bilbilash.demo';

// Minimal valid 1×1 PNG (passes multer fileFilter + assertImageMagic).
const PNG_1X1 = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C489' +
  '0000000D49444154789C62000100000500010D0A2DB40000000049454E44AE426082',
  'hex'
);

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(method, p, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${p}`, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON is fine */ }
  return { status: res.status, json };
}

function dbConn() {
  return openTestDb();
}

async function dbQuery(sql, params = []) {
  const conn = await dbConn();
  try {
    const [rows] = await conn.query(sql, params);
    return rows;
  } finally {
    await conn.end().catch(() => {});
  }
}

/** Remove ONLY this suite's fixture (its photo file first, then the row). */
async function cleanupFixture() {
  let conn;
  try {
    conn = await dbConn();
    const [photos] = await conn.query(
      `SELECT p.profile_photo FROM profiles p JOIN users u ON u.user_id = p.user_id
        WHERE u.email LIKE ? AND p.profile_photo IS NOT NULL`, [FIX_LIKE]
    );
    // Notifications FK to users — delete explicitly (same pattern as seedDemo).
    await conn.query(`DELETE FROM notifications n USING users u WHERE u.user_id = n.recipient_id AND u.email LIKE ?`, [FIX_LIKE]);
    const [res] = await conn.query(`DELETE FROM users WHERE email LIKE ?`, [FIX_LIKE]);
    for (const row of photos) {
      if (!row.profile_photo) continue;
      try { fs.unlinkSync(path.join(uploadDir, row.profile_photo)); } catch { /* already gone */ }
    }
    if (res.affectedRows) console.log(`  (pre/cleanup: removed ${res.affectedRows} fixture row(s))`);
  } catch (err) {
    console.log(`  (cleanup skipped: ${err.code || err.message})`);
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* Section 1 — unit: calculation                                       */
/* ------------------------------------------------------------------ */
function unitCalculation() {
  console.log('\n[1] Unit — completion calculation (14 profile-form fields)');

  const FULL = {
    first_name: 'Ayesha', last_name: 'Khan', phone: '01712345678',
    registration_number: 'REG-1', ssc_batch: 2001, blood_group: 'A+',
    active_donor: 0, profession: 'Engineer', institute: 'Bilbilash High School',
    present_address: 'Village Bilbilash', permanent_address: 'Village Bilbilash',
    bio: 'Hello there', facebook_url: 'https://www.facebook.com/user',
    profile_photo: '169.png',
  };

  check('completion configuration = the 14 profile-update-form fields',
    COMPLETION_FIELDS.join(',') === 'first_name,last_name,phone,registration_number,ssc_batch,blood_group,active_donor,profession,institute,present_address,permanent_address,bio,facebook_url,profile_photo',
    COMPLETION_FIELDS.join(','));
  check('configuration has exactly 14 fields', COMPLETION_FIELDS.length === 14, String(COMPLETION_FIELDS.length));

  check('no completed fields → 0%', computeProfileCompletion({}) === 0, String(computeProfileCompletion({})));
  check('all values null → 0%', computeProfileCompletion(Object.fromEntries(COMPLETION_FIELDS.map((f) => [f, null]))) === 0);
  check('all values empty string → 0%', computeProfileCompletion(Object.fromEntries(COMPLETION_FIELDS.map((f) => [f, '']))) === 0);
  check('all values whitespace-only → 0%', computeProfileCompletion(Object.fromEntries(COMPLETION_FIELDS.map((f) => [f, '   ']))) === 0);
  check('all fields valid → 100%', computeProfileCompletion(FULL) === 100, String(computeProfileCompletion(FULL)));

  // ── The reported bug scenario: phone / profession / institute / blood empty.
  const noContact = { ...FULL, phone: null, profession: '', institute: '   ', blood_group: null };
  const noContactPct = computeProfileCompletion(noContact);
  check('phone + profession + institute + blood empty → NOT 100% (71%)',
    noContactPct !== 100 && noContactPct === 71, String(noContactPct));

  // Required-only + photo (no phone/ssc/blood/profession/institute/bio/fb/active_donor).
  const requiredOnly = {
    first_name: 'A', last_name: 'B', registration_number: 'R',
    present_address: 'P1', permanent_address: 'P2', profile_photo: 'x.png',
  };
  check('registration-required + photo only → 43% (not 100%)',
    computeProfileCompletion(requiredOnly) === 43, String(computeProfileCompletion(requiredOnly)));

  const optionalOnly = {
    phone: '01712345678', ssc_batch: 2001, blood_group: 'A+', profession: 'Doctor',
    institute: 'Bilbilash', active_donor: 0,
  };
  check('optional fields filled but required missing → 43% (not 100%)',
    computeProfileCompletion(optionalOnly) === 43, String(computeProfileCompletion(optionalOnly)));

  check('auth/system fields alone → 0%', computeProfileCompletion({
    email: 'x@y.z', password_hash: '$2a$12$abc', token_version: 3, status: 'approved',
    user_id: 12, role: 'MEMBER', created_at: '2024-01-01',
  }) === 0);

  check('saved active_donor=false counts as a filled form field (1/14 → 7%)',
    computeProfileCompletion({ active_donor: 0 }) === 7, String(computeProfileCompletion({ active_donor: 0 })));
  check('active_donor null does NOT count',
    computeProfileCompletion({ active_donor: null }) === 0);

  // Invalid values (violating existing validation rules) are incomplete.
  check('first_name over 60 chars → invalid → 93%',
    computeProfileCompletion({ ...FULL, first_name: 'x'.repeat(61) }) === 93);
  check('blood_group outside enum → invalid → 93%',
    computeProfileCompletion({ ...FULL, blood_group: 'A++' }) === 93);
  check('ssc_batch out of range (1800) → invalid → 93%',
    computeProfileCompletion({ ...FULL, ssc_batch: 1800 }) === 93);
  check('ssc_batch non-integer → invalid → 93%',
    computeProfileCompletion({ ...FULL, ssc_batch: 2001.5 }) === 93);
  check('ssc_batch numeric string "2001" is valid → 100%',
    computeProfileCompletion({ ...FULL, ssc_batch: '2001' }) === 100);
  check('facebook_url not a Facebook URL → invalid → 93%',
    computeProfileCompletion({ ...FULL, facebook_url: 'https://example.com/x' }) === 93);
  check('facebook_url valid (www.facebook.com) counts',
    computeProfileCompletion(FULL) === 100);
  check('bio over 500 chars → invalid → 93%',
    computeProfileCompletion({ ...FULL, bio: 'y'.repeat(501) }) === 93);
  check('whitespace-only phone → incomplete → 93%',
    computeProfileCompletion({ ...FULL, phone: '   ' }) === 93);
  check('photo must be a saved reference (empty → 93%)',
    computeProfileCompletion({ ...FULL, profile_photo: '' }) === 93);
  check('photo whitespace-only → incomplete → 93%',
    computeProfileCompletion({ ...FULL, profile_photo: '   ' }) === 93);

  check('rounding: 1/14 → 7%', computeProfileCompletion({ first_name: 'A' }) === 7, String(computeProfileCompletion({ first_name: 'A' })));
  check('rounding: 7/14 → 50%', computeProfileCompletion({
    first_name: 'A', last_name: 'B', phone: '017', registration_number: 'R',
    ssc_batch: 2001, blood_group: 'A+', active_donor: 1,
  }) === 50, String(computeProfileCompletion({ first_name: 'A', last_name: 'B', phone: '017', registration_number: 'R', ssc_batch: 2001, blood_group: 'A+', active_donor: 1 })));
  check('rounding: 13/14 → 93%', computeProfileCompletion({ ...FULL, profile_photo: null }) === 93);

  check('no fields configured → null (no div-by-zero, no misleading 100%)',
    computeProfileCompletion(FULL, []) === null, String(computeProfileCompletion(FULL, [])));
}

/* ------------------------------------------------------------------ */
/* Section 2 — unit: color thresholds                                  */
/* ------------------------------------------------------------------ */
function unitColors() {
  console.log('\n[2] Unit — color thresholds (frontend util)');
  const R = COMPLETION_COLORS.red, O = COMPLETION_COLORS.orange, G = COMPLETION_COLORS.green;

  check('brand colors match spec', R === '#DC2626' && O === '#F59E0B' && G === '#16A34A', `${R}/${O}/${G}`);
  check('0% → red', completionColor(0) === R, completionColor(0));
  check('49% → red', completionColor(49) === R, completionColor(49));
  check('50% → orange', completionColor(50) === O, completionColor(50));
  check('84% → orange', completionColor(84) === O, completionColor(84));
  check('85% → green', completionColor(85) === G, completionColor(85));
  check('100% → green', completionColor(100) === G, completionColor(100));
  check('typical values: 71 orange, 79 orange, 93 green',
    completionColor(71) === O && completionColor(79) === O && completionColor(93) === G);
  check('non-finite input falls back to red (defensive)',
    completionColor('n/a') === R && completionColor(null) === R && completionColor(undefined) === R);
}

/* ------------------------------------------------------------------ */
/* Section 3 — live API                                                */
/* ------------------------------------------------------------------ */
/** All profile-form fields, as the real Profile form submits them. */
function baseForm() {
  const fd = new FormData();
  fd.append('first_name', 'Pct');
  fd.append('last_name', 'Member');
  fd.append('registration_number', FIX_REG);
  fd.append('phone', '01700000000');
  fd.append('ssc_batch', '2001');
  fd.append('blood_group', 'B+');
  fd.append('active_donor', 'false');
  fd.append('profession', 'Engineer');
  fd.append('institute', 'Bilbilash High School');
  fd.append('present_address', 'Test Present Address 1');
  fd.append('permanent_address', 'Test Permanent Address 1');
  fd.append('bio', 'Profile completion test bio');
  fd.append('facebook_url', 'https://www.facebook.com/pcttest');
  return fd;
}

async function expectStill(token, expected, label) {
  const g = await call('GET', '/api/profile', { token });
  const value = g.json?.data?.profile?.profile_completion;
  check(label, value === expected, `got ${String(value)}, want ${expected}`);
}

async function liveApi() {
  console.log('\n[3] Live API (backend on ' + BASE + ')');

  const probe = await call('POST', '/api/auth/login', {
    body: { email: AUTHORITY_EMAIL, password: AUTHORITY_PASSWORD },
  }).catch((e) => ({ status: 0, json: null, err: e }));
  if (probe.status === 0) {
    check('backend reachable', false, String(probe.err?.message || 'connection failed'));
    return;
  }
  const adminToken = probe.json?.data?.token;
  check('authority login (admin-gated test setup)', probe.status === 200 && !!adminToken, `status ${probe.status}`);
  if (!adminToken) return;
  const authorityId = probe.json?.data?.user?.user_id;

  await cleanupFixture(); // idempotent re-runs

  // --- registration -------------------------------------------------
  const reg = await call('POST', '/api/auth/register', { body: {
    first_name: 'Pct', last_name: 'Member', email: FIX_EMAIL, password: FIX_PASSWORD,
    phone: '01700000000', registration_number: FIX_REG, ssc_batch: 2001,
    blood_group: 'B+', profession: 'Engineer', institute: 'Bilbilash High School',
    present_address: 'Test Present Address 1', permanent_address: 'Test Permanent Address 1',
  } });
  check('register fixture → 201', reg.status === 201, `status ${reg.status}: ${reg.json?.message || ''}`);
  if (reg.status !== 201) return;

  // --- pending login MUST be blocked (security regression) ----------
  const pend = await call('POST', '/api/auth/login', { body: { email: FIX_EMAIL, password: FIX_PASSWORD } });
  check('pending member login → 403', pend.status === 403, `status ${pend.status}`);
  check('pending login issues NO token', !pend.json?.data?.token);
  check('pending message explains approval wait',
    /approval/i.test(pend.json?.message || ''), pend.json?.message || '');

  // --- approve ------------------------------------------------------
  const list = await call('GET', '/api/users/pending?limit=200', { token: adminToken });
  const target = (list.json?.data?.users || []).find((u) => u.email === FIX_EMAIL);
  check('fixture appears in pending queue', !!target);
  if (!target) { await cleanupFixture(); return; }
  const ap = await call('PUT', `/api/users/${target.user_id}/approve`, { token: adminToken });
  check('authority approves fixture → 200', ap.status === 200, `status ${ap.status}`);

  // --- login as approved MEMBER ------------------------------------
  const login = await call('POST', '/api/auth/login', { body: { email: FIX_EMAIL, password: FIX_PASSWORD } });
  check('approved member login → 200', login.status === 200, `status ${login.status}`);
  const token = login.json?.data?.token;
  check('login role is MEMBER', login.json?.data?.user?.role === 'MEMBER', String(login.json?.data?.user?.role));
  if (!token) { await cleanupFixture(); return; }

  // --- GET after registration: 11 of 14 form fields ------------------
  // filled: first, last, phone, reg, ssc, blood, profession, institute,
  // addresses(2), active_donor(default false = filled) = 11
  // empty:  bio, facebook_url, profile_photo → 11/14 = 79%
  const g1 = await call('GET', '/api/profile', { token });
  const p1 = g1.json?.data?.profile;
  check('GET /api/profile → 200', g1.status === 200, `status ${g1.status}`);
  check('fresh registration → 79% (11 of 14 form fields)', p1?.profile_completion === 79, String(p1?.profile_completion));
  check('API value equals utility recomputation from the same saved row',
    computeProfileCompletion(p1) === p1?.profile_completion, String(computeProfileCompletion(p1)));
  check('profile GET exposes no credential fields',
    p1?.password_hash === undefined && p1?.token_version === undefined);

  const g2 = await call('GET', '/api/profile', { token });
  check('reload returns the same value', g2.json?.data?.profile?.profile_completion === 79,
    String(g2.json?.data?.profile?.profile_completion));

  // --- successful update: fill bio + facebook, spoof percentage ------
  const spoof = baseForm();
  spoof.set('profile_completion', '100'); // client must NEVER be trusted
  const u1 = await call('PUT', '/api/profile', { token, form: spoof });
  check('successful profile update → 200', u1.status === 200, `status ${u1.status}: ${u1.json?.message || ''}`);
  // 13/14 now filled — only profile_photo missing.
  check('client-submitted percentage is ignored (server computes 93%)',
    u1.json?.data?.profile?.profile_completion === 93, String(u1.json?.data?.profile?.profile_completion));
  check('form values actually saved', u1.json?.data?.profile?.profession === 'Engineer'
    && u1.json?.data?.profile?.bio === 'Profile completion test bio'
    && u1.json?.data?.profile?.facebook_url === 'https://www.facebook.com/pcttest');

  // --- failed updates leave the value unchanged ---------------------
  const ws = baseForm();
  ws.set('present_address', '   ');
  const u2 = await call('PUT', '/api/profile', { token, form: ws });
  check('whitespace-only required field → 422', u2.status === 422, `status ${u2.status}`);
  await expectStill(token, 93, 'failed update (whitespace) leaves percentage unchanged');

  const missing = baseForm();
  missing.delete('last_name');
  const u3 = await call('PUT', '/api/profile', { token, form: missing });
  check('missing required field → 422', u3.status === 422, `status ${u3.status}`);
  await expectStill(token, 93, 'failed update (missing field) leaves percentage unchanged');

  // --- photo upload → 14/14 = 100% ----------------------------------
  const withPhoto = baseForm();
  withPhoto.append('image', new Blob([PNG_1X1], { type: 'image/png' }), 'pixel.png');
  const u4 = await call('PUT', '/api/profile', { token, form: withPhoto });
  check('profile photo upload → 200', u4.status === 200, `status ${u4.status}: ${u4.json?.message || ''}`);
  const photoName = u4.json?.data?.profile?.profile_photo;
  check('saved photo reference returned', typeof photoName === 'string' && photoName.endsWith('.png'), String(photoName));
  check('all 14 form fields filled → 100%', u4.json?.data?.profile?.profile_completion === 100,
    String(u4.json?.data?.profile?.profile_completion));

  const rows = await dbQuery(
    `SELECT p.profile_photo FROM profiles p JOIN users u ON u.user_id = p.user_id WHERE u.email = ?`, [FIX_EMAIL]
  );
  check('photo persisted in database', rows[0]?.profile_photo === photoName,
    `${rows[0]?.profile_photo} !== ${photoName}`);

  const g3 = await call('GET', '/api/profile', { token });
  check('reload after photo → 100%', g3.json?.data?.profile?.profile_completion === 100,
    String(g3.json?.data?.profile?.profile_completion));

  const noNewPhoto = baseForm();
  const u5 = await call('PUT', '/api/profile', { token, form: noNewPhoto });
  check('update without new photo keeps photo + 100%',
    u5.status === 200 && u5.json?.data?.profile?.profile_photo === photoName
    && u5.json?.data?.profile?.profile_completion === 100,
    `${u5.status} ${u5.json?.data?.profile?.profile_completion}`);

  // --- admin/authority: that member's own completion ----------------
  const detail = await call('GET', `/api/users/${target.user_id}`, { token: adminToken });
  check('admin member detail → 200', detail.status === 200, `status ${detail.status}`);
  const du = detail.json?.data?.user;
  check("admin sees that member's completion from THEIR data", du?.profile_completion === 100,
    String(du?.profile_completion));
  check('admin detail returns the right member', du?.email === FIX_EMAIL, String(du?.email));
  check('credentials stripped from member detail', du?.password_hash === undefined && du?.token_version === undefined);

  // --- member cannot read other users' completion -------------------
  const cross = await call('GET', `/api/users/${authorityId}`, { token });
  check('member blocked from another profile → 403', cross.status === 403, `status ${cross.status}`);
  check('no completion data leaked on 403', cross.json?.data?.user?.profile_completion === undefined);

  const own = await call('GET', '/api/profile', { token });
  check('profile GET returns own record only', own.json?.data?.profile?.email === FIX_EMAIL);

  // --- THE REPORTED BUG, live: phone/profession/institute/blood emptied
  const hollow = baseForm();
  hollow.set('phone', '');
  hollow.set('blood_group', '');
  hollow.set('profession', '');
  hollow.set('institute', '');
  const u6 = await call('PUT', '/api/profile', { token, form: hollow });
  check('emptying phone/blood/profession/institute → 200', u6.status === 200, `status ${u6.status}`);
  const hollowPct = u6.json?.data?.profile?.profile_completion;
  check('…and completion drops to 71% — NOT 100%', hollowPct === 71 && hollowPct !== 100, String(hollowPct));
  await expectStill(token, 71, 'reload confirms 71% after those fields emptied');

  await cleanupFixture();
  if (photoName) {
    try { fs.unlinkSync(path.join(uploadDir, photoName)); } catch { /* already removed with fixture */ }
  }
}

/* ------------------------------------------------------------------ */
async function main() {
  unitCalculation();
  unitColors();
  await liveApi();

  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('Failures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  // No forced process.exit(): on Windows, exiting while fetch keep-alive
  // sockets are closing trips a libuv teardown assertion (see seedDemo.js).
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error('profile completion test crashed:', e.message);
  process.exitCode = 1;
});
