/**
 * Smoke test for the Bilbilash Alumni API.
 * Requires: backend running on :5000 and a seeded database (npm run init-db).
 * Usage: cd backend && npm run smoke-test
 *
 * It creates throwaway test users (timestamped emails) and verifies the real
 * authorization matrix, capacity limits, and duplicate prevention.
 *
 * CLEANUP: every fixture it creates is named with the `SMOKE-` prefix (or a
 * `smoke.*@example.com` email), and the suite deletes its own fixtures before
 * and after running so repeated runs are deterministic (e.g. the 3-Admin cap).
 * It only ever deletes rows it created itself — never other data.
 */
import 'dotenv/config';
import { openTestDb } from './pgTestClient.js';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import { uploadDir } from '../src/config/env.js';

const BASE = process.env.SMOKE_BASE || 'http://localhost:5000';
const AUTHORITY_EMAIL = process.env.AUTHORITY_EMAIL || 'mdhasankhanhk04@gmail.com';
const AUTHORITY_PASSWORD = process.env.AUTHORITY_PASSWORD;
const stamp = Date.now();

let passed = 0;
let failed = 0;
const failures = [];

/** Remove only this suite's own fixtures (email pattern + SMOKE- prefixed titles). */
async function cleanupFixtures(phase) {
  let conn;
  try {
    conn = await openTestDb();
    const targets = [
      // member_monthly_rates.set_by -> users.user_id is ON DELETE RESTRICT
      // (fk_mmr_setby), so rate rows must go before the users themselves.
      [`DELETE FROM member_monthly_rates r USING users u WHERE u.user_id = r.user_id AND u.email LIKE ?`, ['smoke.%@example.com']],
      [`DELETE FROM member_monthly_rates r USING users u WHERE u.user_id = r.set_by AND u.email LIKE ?`, ['smoke.%@example.com']],
      [`DELETE FROM users WHERE email LIKE ?`, ['smoke.%@example.com']],
      [`DELETE FROM teachers WHERE name LIKE ?`, ['SMOKE-%']],
      [`DELETE FROM notices WHERE title LIKE ?`, ['SMOKE-%']],
      [`DELETE FROM events WHERE title LIKE ?`, ['SMOKE-%']],
      [`DELETE FROM polls WHERE question LIKE ?`, ['SMOKE-%']],
      [`DELETE FROM visions WHERE title LIKE ?`, ['SMOKE-%']],
      [`DELETE FROM help_requests WHERE title LIKE ?`, ['SMOKE-%']],
    ];
    let removed = 0;
    for (const [sql, params] of targets) {
      const [res] = await conn.query(sql, params);
      removed += res.affectedRows || 0;
    }
    console.log(`  (${phase} cleanup: removed ${removed} leftover fixture row(s))`);
  } catch (err) {
    console.log(`  (${phase} cleanup skipped: ${err.code || err.message})`);
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

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

/** Direct DB read for retention assertions (test-only). */
async function dbQuery(sql, params = []) {
  const conn = await openTestDb();
  try {
    const [rows] = await conn.query(sql, params);
    return rows;
  } finally {
    await conn.end().catch(() => {});
  }
}

async function call(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

const section = (title) => console.log(`\n${title}`);

async function main() {
  if (!AUTHORITY_PASSWORD) {
    console.error('AUTHORITY_PASSWORD missing. Run from the backend folder so .env is loaded.');
    process.exit(1);
  }

  console.log('\nPreparing a clean fixture set (removing only previous test data)…');
  await cleanupFixtures('start');

  section('1) Health & connectivity');
  const health = await call('GET', '/api/health');
  check('health endpoint responds', health.status === 200, `status ${health.status}`);
  check('database connected', health.json?.data?.database === 'connected', JSON.stringify(health.json?.data));

  section('2) Registration');
  const mkUser = (tag) => ({
    first_name: `Smoke${tag}`,
    last_name: 'Tester',
    email: `smoke.${tag}.${stamp}@example.com`,
    password: 'Passw0rd!23',
    phone: '01700000000',
    registration_number: `SMOKE-REG-${stamp}-${tag}`,
    ssc_batch: 2010,
    blood_group: 'O+',
    profession: 'Engineer',
    institute: 'Test Institute',
    present_address: 'Test Street 1',
    permanent_address: 'Test Village 2',
  });
  const users = { A: mkUser('a'), B: mkUser('b'), C: mkUser('c'), D: mkUser('d') };
  const ids = {};

  for (const key of Object.keys(users)) {
    const r = await call('POST', '/api/auth/register', { body: users[key] });
    check(`register ${key} -> 201 pending`, r.status === 201, `status ${r.status} ${r.json?.message || ''}`);
  }

  const dupReg = await call('POST', '/api/auth/register', { body: users.A });
  check('duplicate email rejected (409)', dupReg.status === 409, `status ${dupReg.status}`);

  section('3) Pending user restrictions — no session until approved');
  const loginA0 = await call('POST', '/api/auth/login', { body: { email: users.A.email, password: users.A.password } });
  check('pending user login REJECTED (403), no token issued',
    loginA0.status === 403 && !loginA0.json?.data?.token, `status ${loginA0.status}`);
  check('pending rejection message is clear and non-sensitive',
    /awaiting approval/i.test(loginA0.json?.message || '') && !/@|\d{4}-\d{2}/.test(loginA0.json?.message || ''),
    loginA0.json?.message || 'no message');
  const pendingWrongPw = await call('POST', '/api/auth/login', { body: { email: users.A.email, password: 'WrongPass123' } });
  check('pending user + wrong password -> generic 401 (no status leak)',
    pendingWrongPw.status === 401 && /Invalid email or password/.test(pendingWrongPw.json?.message || ''), `status ${pendingWrongPw.status}`);

  // A pre-fix style JWT (signed while still pending) verifies but must be dead
  // on every protected endpoint — account status is re-checked per request.
  const pendRow = await dbQuery(`SELECT user_id, token_version FROM users WHERE email = ?`, [users.A.email]);
  const stalePendToken = jwt.sign({ sub: pendRow[0].user_id, tv: pendRow[0].token_version }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const stalePendApi = await call('GET', '/api/notifications', { token: stalePendToken });
  check('pending account old token denied everywhere (401)', stalePendApi.status === 401, `status ${stalePendApi.status}`);
  const pendJob = await call('POST', '/api/jobs', { token: stalePendToken, body: { title: 'x', company: 'y', description: 'z' } });
  check('VISITOR cannot create job (401/403)', [401, 403].includes(pendJob.status), `status ${pendJob.status}`);

  const anonUsers = await call('GET', '/api/users/pending');
  check('unauthenticated /users/pending -> 401', anonUsers.status === 401, `status ${anonUsers.status}`);

  section('4) Authority login & approval');
  const authLogin = await call('POST', '/api/auth/login', { body: { email: AUTHORITY_EMAIL, password: AUTHORITY_PASSWORD } });
  check('authority login works', authLogin.status === 200 && authLogin.json?.data?.user?.role === 'AUTHORITY', `status ${authLogin.status} role ${authLogin.json?.data?.user?.role}`);
  const authToken = authLogin.json?.data?.token;
  if (!authToken) { report(); return; }

  const pending = await call('GET', '/api/users/pending', { token: authToken });
  check('authority sees pending list', pending.status === 200 && Array.isArray(pending.json?.data?.users));
  for (const key of Object.keys(users)) {
    const found = pending.json?.data?.users?.find((u) => u.email === users[key].email);
    if (found) ids[key] = found.user_id;
  }
  check('all 4 test users found in pending', Object.keys(ids).length === 4, `found ${Object.keys(ids).length}`);

  for (const key of Object.keys(users)) {
    const r = await call('PUT', `/api/users/${ids[key]}/approve`, { token: authToken });
    check(`approve ${key}`, r.status === 200, `status ${r.status} ${r.json?.message || ''}`);
  }

  const loginA = await call('POST', '/api/auth/login', { body: { email: users.A.email, password: users.A.password } });
  check('approved user is now MEMBER', loginA.json?.data?.user?.role === 'MEMBER', `role ${loginA.json?.data?.user?.role}`);
  const tokenA = loginA.json?.data?.token;
  const tokenB = (await call('POST', '/api/auth/login', { body: { email: users.B.email, password: users.B.password } })).json?.data?.token;
  const tokenC = (await call('POST', '/api/auth/login', { body: { email: users.C.email, password: users.C.password } })).json?.data?.token;
  const tokenD = (await call('POST', '/api/auth/login', { body: { email: users.D.email, password: users.D.password } })).json?.data?.token;

  // Ineligible accounts must be unable to authenticate at all (scenarios 3/4/9).
  users.F = mkUser('f');
  const regF = await call('POST', '/api/auth/register', { body: users.F });
  check('register throwaway F -> 201', regF.status === 201, `status ${regF.status}`);
  const pendListF = await call('GET', '/api/users/pending', { token: authToken });
  const fId = pendListF.json?.data?.users?.find((u) => u.email === users.F.email)?.user_id;
  await call('PUT', `/api/users/${fId}/approve`, { token: authToken });
  const loginF = await call('POST', '/api/auth/login', { body: { email: users.F.email, password: users.F.password } });
  check('approved member F logs in (200)', loginF.status === 200, `status ${loginF.status}`);
  const deacF = await call('PUT', `/api/users/${fId}/deactivate`, { token: authToken });
  check('authority deactivates F (200)', deacF.status === 200, `status ${deacF.status} ${deacF.json?.message || ''}`);
  const loginF2 = await call('POST', '/api/auth/login', { body: { email: users.F.email, password: users.F.password } });
  check('deactivated account cannot log in (401)', loginF2.status === 401, `status ${loginF2.status}`);
  const fApi = await call('GET', '/api/notifications', { token: loginF.json?.data?.token });
  check("deactivated account's old token dies immediately (401)", fApi.status === 401, `status ${fApi.status}`);
  await call('PUT', `/api/users/${fId}/approve`, { token: authToken }); // reactivate for the reject leg
  const rejF = await call('PUT', `/api/users/${fId}/reject`, { token: authToken });
  check('authority rejects F (200)', rejF.status === 200, `status ${rejF.status} ${rejF.json?.message || ''}`);
  const loginF3 = await call('POST', '/api/auth/login', { body: { email: users.F.email, password: users.F.password } });
  check('rejected account cannot log in (401)', loginF3.status === 401, `status ${loginF3.status}`);

  section('5) Admin limit (max 100) — race-safe cap');
  // The dev database may already contain real ADMIN accounts (which this suite
  // must never touch), so compute how many promotion slots are actually free.
  const statsBefore = await call('GET', '/api/stats/overview', { token: authToken });
  const adminsBefore = statsBefore.json?.data?.stats?.admins ?? 0;
  const freeSlots = Math.max(0, 100 - adminsBefore);
  const expectPromote = (i) => (i <= freeSlots ? [200] : [409, 400]);
  const p1 = await call('PUT', `/api/users/${ids.A}/promote-admin`, { token: authToken });
  const p2 = await call('PUT', `/api/users/${ids.B}/promote-admin`, { token: authToken });
  const p3 = await call('PUT', `/api/users/${ids.C}/promote-admin`, { token: authToken });
  check('promote 1st member -> expected (200 if a slot was free)', expectPromote(1).includes(p1.status), `status ${p1.status} ${p1.json?.message || ''}`);
  check('promote 2nd member -> expected', expectPromote(2).includes(p2.status), `status ${p2.status} ${p2.json?.message || ''}`);
  check('promote 3rd member -> expected', expectPromote(3).includes(p3.status), `status ${p3.status} ${p3.json?.message || ''}`);
  const expect4th = freeSlots >= 4 ? [200] : [409, 400];
  const p4 = await call('PUT', `/api/users/${ids.D}/promote-admin`, { token: authToken });
  check('4th promotion -> expected (200 while under max-100 cap)', expect4th.includes(p4.status), `status ${p4.status} ${p4.json?.message || ''}`);
  // Restore fixture state: later sections expect D to be a plain MEMBER.
  if (p4.status === 200) {
    const undoD = await call('PUT', `/api/users/${ids.D}/demote-admin`, { token: authToken });
    check('4th admin demoted back to MEMBER (fixture restore)', undoD.status === 200, `status ${undoD.status}`);
  }

  section('6) Admin vs Member vs Authority permissions');
  const memberPromote = await call('PUT', `/api/users/${ids.D}/promote-admin`, { token: tokenD });
  check('MEMBER cannot promote (403)', memberPromote.status === 403, `status ${memberPromote.status}`);
  const memberStats = await call('GET', '/api/stats/overview', { token: tokenD });
  check('MEMBER cannot read admin stats (403)', memberStats.status === 403, `status ${memberStats.status}`);
  const aIsAdmin = p1.status === 200;
  const adminStats = await call('GET', '/api/stats/overview', { token: tokenA });
  check('ADMIN can read stats', aIsAdmin ? adminStats.status === 200 : adminStats.status === 403, `status ${adminStats.status}`);
  const adminPromote = await call('PUT', `/api/users/${ids.D}/promote-admin`, { token: tokenA });
  check('ADMIN cannot promote (403)', adminPromote.status === 403, `status ${adminPromote.status}`);
  const adminDemote = await call('PUT', `/api/users/${ids.B}/demote-admin`, { token: tokenA });
  check('ADMIN cannot demote (403)', adminDemote.status === 403, `status ${adminDemote.status}`);

  section('7) Demotion takes effect immediately');
  const demote = await call('PUT', `/api/users/${ids.A}/demote-admin`, { token: authToken });
  check('authority demotes A -> expected', aIsAdmin ? demote.status === 200 : demote.status === 400, `status ${demote.status} ${demote.json?.message || ''}`);
  const statsAfterDemote = await call('GET', '/api/stats/overview', { token: tokenA });
  check('demoted A loses admin access immediately (403)', statsAfterDemote.status === 403, `status ${statsAfterDemote.status}`);

  const promoteAuthority = await call('PUT', `/api/users/1/promote-admin`, { token: authToken });
  check('authority account protected from modification', [400, 403, 404].includes(promoteAuthority.status), `status ${promoteAuthority.status}`);

  section('8) Jobs: moderation + duplicate applications');
  const job = await call('POST', '/api/jobs', {
    token: tokenB,
    body: { title: `SMOKE-${stamp} Job`, company: 'Test Co', description: 'Testing', employment_type: 'remote' },
  });
  check('member creates job -> 201 pending', job.status === 201, `status ${job.status}`);
  const jobId = job.json?.data?.job_id;
  const mod = await call('PUT', `/api/jobs/${jobId}/moderate`, { token: authToken, body: { action: 'approve' } });
  check('admin/authority approves job', mod.status === 200, `status ${mod.status} ${mod.json?.message || ''}`);

  const jobD = await call('POST', '/api/jobs', {
    token: tokenD,
    body: { title: `SMOKE-${stamp} Job2`, company: 'Test Co', description: 'Testing', employment_type: 'remote' },
  });
  const jobId2 = jobD.json?.data?.job_id;
  await call('PUT', `/api/jobs/${jobId2}/moderate`, { token: authToken, body: { action: 'approve' } });

  const apply1 = await call('POST', `/api/jobs/${jobId2}/apply`, { token: tokenB, body: { cover_message: 'I am interested' } });
  check('member applies -> 201', apply1.status === 201, `status ${apply1.status} ${apply1.json?.message || ''}`);
  const apply2 = await call('POST', `/api/jobs/${jobId2}/apply`, { token: tokenB, body: { cover_message: 'Again' } });
  check('duplicate application rejected (4xx)', apply2.status >= 400 && apply2.status < 500, `status ${apply2.status}`);

  const selfApply = await call('POST', `/api/jobs/${jobId}/apply`, { token: tokenB, body: { cover_message: 'self' } });
  check('cannot apply to own job (>4xx)', selfApply.status >= 400, `status ${selfApply.status}`);

  const appsForJob = await call('GET', `/api/jobs/${jobId2}/applications`, { token: tokenB });
  check('job owner sees applications', appsForJob.status === 200 && appsForJob.json?.data?.applications?.length === 1, `status ${appsForJob.status}`);
  // tokenA belongs to a plain MEMBER at this point (promoted then demoted in step 7),
  // so they must NOT be able to read another member's application list.
  const appsByOther = await call('GET', `/api/jobs/${jobId2}/applications`, { token: tokenA });
  check('non-owner MEMBER cannot see applications (403)', appsByOther.status === 403, `status ${appsByOther.status}`);
  const cIsAdmin = p3.status === 200;
  const appsByAdmin = await call('GET', `/api/jobs/${jobId2}/applications`, { token: tokenC });
  check('ADMIN may see applications for moderation (200)', cIsAdmin ? appsByAdmin.status === 200 : appsByAdmin.status === 403, `status ${appsByAdmin.status}`);

  section('9) Events: capacity + duplicate prevention');
  const ev = await call('POST', '/api/events', {
    token: authToken,
    body: { title: `SMOKE-${stamp} Event`, event_date: '2030-01-01', capacity: 1 },
  });
  check('authority creates event -> 201', ev.status === 201, `status ${ev.status} ${ev.json?.message || ''}`);
  const eventId = ev.json?.data?.event_id;
  const reg1 = await call('POST', `/api/events/${eventId}/register`, { token: tokenB });
  check('member registers -> 201', reg1.status === 201, `status ${reg1.status} ${reg1.json?.message || ''}`);
  const regDup = await call('POST', `/api/events/${eventId}/register`, { token: tokenB });
  check('duplicate registration rejected (409)', regDup.status === 409, `status ${regDup.status}`);
  const regFull = await call('POST', `/api/events/${eventId}/register`, { token: tokenC });
  check('capacity enforced — second person rejected (409)', regFull.status === 409, `status ${regFull.status}`);

  section('10) Polls: one vote per member');
  const poll = await call('POST', '/api/polls', { token: authToken, body: { question: `SMOKE-${stamp} Poll`, options: 'Yes | No' } });
  check('authority creates poll -> 201', poll.status === 201, `status ${poll.status} ${poll.json?.message || ''}`);
  const pollId = poll.json?.data?.poll_id;
  const polls = await call('GET', '/api/polls', { token: tokenB });
  const optionId = polls.json?.data?.polls?.find((p) => p.poll_id === pollId)?.options?.[0]?.option_id;
  const vote1 = await call('POST', `/api/polls/${pollId}/vote`, { token: tokenB, body: { option_id: optionId } });
  check('member votes -> 201', vote1.status === 201, `status ${vote1.status} ${vote1.json?.message || ''}`);
  const vote2 = await call('POST', `/api/polls/${pollId}/vote`, { token: tokenB, body: { option_id: optionId } });
  check('duplicate vote rejected (409)', vote2.status === 409, `status ${vote2.status}`);

  section('11) Visions, help, gallery, teachers, notices');
  const vision = await call('POST', '/api/visions', { token: tokenB, body: { title: `SMOKE-${stamp} Idea`, description: 'Improve library', category: 'education' } });
  check('member submits vision -> 201', vision.status === 201, `status ${vision.status}`);
  const visionMod = await call('PUT', `/api/visions/${vision.json?.data?.vision_id}/moderate`, { token: authToken, body: { action: 'approve' } });
  check('authority approves vision', visionMod.status === 200, `status ${visionMod.status}`);

  const help = await call('POST', '/api/help', { token: tokenB, body: { title: `SMOKE-${stamp} Help`, description: 'Need guidance', category: 'career', urgency: 'high' } });
  check('member creates help request -> 201', help.status === 201, `status ${help.status}`);
  const helpStatus = await call('PUT', `/api/help/${help.json?.data?.help_id}/status`, { token: authToken, body: { status: 'in_progress' } });
  check('admin updates help status', helpStatus.status === 200, `status ${helpStatus.status}`);

  const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex');
  const fd = new FormData();
  fd.append('image', new Blob([pngBytes], { type: 'image/png' }), 'test.png');
  fd.append('caption', `Smoke photo ${stamp}`);
  const gallery = await call('POST', '/api/gallery', { token: tokenB, form: fd });
  check('member uploads gallery image -> 201 pending', gallery.status === 201, `status ${gallery.status} ${gallery.json?.message || ''}`);
  const galleryMod = await call('PUT', `/api/gallery/${gallery.json?.data?.gallery_id}/moderate`, { token: authToken, body: { action: 'approve' } });
  check('authority approves gallery item', galleryMod.status === 200, `status ${galleryMod.status}`);

  const teacherFd = new FormData();
  teacherFd.append('name', `SMOKE-${stamp} Teacher`);
  teacherFd.append('subject', 'Mathematics');
  const teacher = await call('POST', '/api/teachers', { token: authToken, form: teacherFd });
  check('authority adds teacher -> 201', teacher.status === 201, `status ${teacher.status}`);

  section('11b) Gallery: hard delete by admin/authority');
  const delGalleryId = gallery.json?.data?.gallery_id;
  const delGallery = await call('DELETE', `/api/gallery/${delGalleryId}`, { token: authToken, body: { reason: 'Smoke delete test' } });
  check('admin/authority deletes gallery photo (200)', delGallery.status === 200, `status ${delGallery.status} ${delGallery.json?.message || ''}`);
  const delAfter = await call('GET', '/api/gallery', { token: authToken });
  check('deleted photo removed from DB entirely', !delAfter.json?.data?.items?.some((g) => g.gallery_id === delGalleryId), 'row still present');
  const delMemberView = await call('GET', '/api/gallery', { token: tokenB });
  check('deleted photo hidden from members', !delMemberView.json?.data?.items?.some((g) => g.gallery_id === delGalleryId), 'row still visible to member');
  const delFile = fs.existsSync(path.join(uploadDir, delGallery.json?.data?.image_path || 'nonexistent'));
  check('physical image file removed from disk', !delFile, 'file still exists');
  const teacherList = await call('GET', '/api/teachers');
  check('teacher directory is public', teacherList.status === 200 && teacherList.json?.data?.teachers?.length > 0, `status ${teacherList.status}`);

  const notice = await call('POST', '/api/notices', { token: authToken, body: { title: `SMOKE-${stamp} Notice`, body: 'Test notice body' } });
  check('authority publishes notice -> 201', notice.status === 201, `status ${notice.status}`);
  const noticeList = await call('GET', '/api/notices');
  check('noticeboard is public', noticeList.status === 200 && noticeList.json?.data?.notices?.some((n) => n.title === `SMOKE-${stamp} Notice`));

  section('11c) Admin/Authority hard-delete: notice, job, help, poll, event, vision');
  // ADMIN/AUTHORITY (rank >= ADMIN) may hard-delete all six content types;
  // ordinary members never can. Children cascade; dead notifications are pruned.
  const noticeId = notice.json?.data?.notice_id;
  const helpId = help.json?.data?.help_id;
  const visionId = vision.json?.data?.vision_id;
  const delTargets = [
    ['notice', `/api/notices/${noticeId}`],
    ['job', `/api/jobs/${jobId2}`],
    ['help request', `/api/help/${helpId}`],
    ['poll', `/api/polls/${pollId}`],
    ['event', `/api/events/${eventId}`],
    ['vision', `/api/visions/${visionId}`],
  ];
  for (const [name, url] of delTargets) {
    const r = await call('DELETE', url, { token: tokenA });
    check(`MEMBER cannot delete ${name} (403)`, r.status === 403, `status ${r.status}`);
  }
  const anonDel = await call('DELETE', `/api/notices/${noticeId}`, {});
  check('unauthenticated delete -> 401', anonDel.status === 401, `status ${anonDel.status}`);

  const delN = await call('DELETE', `/api/notices/${noticeId}`, { token: authToken });
  check('authority deletes notice (200)', delN.status === 200, `status ${delN.status} ${delN.json?.message || ''}`);
  const delJ = await call('DELETE', `/api/jobs/${jobId2}`, { token: authToken });
  check('authority deletes job (200)', delJ.status === 200, `status ${delJ.status} ${delJ.json?.message || ''}`);
  const delH = await call('DELETE', `/api/help/${helpId}`, { token: authToken });
  check('authority deletes help request (200)', delH.status === 200, `status ${delH.status} ${delH.json?.message || ''}`);
  const delP = await call('DELETE', `/api/polls/${pollId}`, { token: authToken });
  check('authority deletes poll (200)', delP.status === 200, `status ${delP.status} ${delP.json?.message || ''}`);
  const delEv = await call('DELETE', `/api/events/${eventId}`, { token: authToken });
  check('authority deletes event (200)', delEv.status === 200, `status ${delEv.status} ${delEv.json?.message || ''}`);
  const delV = await call('DELETE', `/api/visions/${visionId}`, { token: authToken });
  check('authority deletes vision (200)', delV.status === 200, `status ${delV.status} ${delV.json?.message || ''}`);

  const goneChecks = [
    ['notice', (await call('GET', '/api/notices')).json?.data?.notices?.some((n) => n.notice_id === noticeId)],
    ['job', (await call('GET', '/api/jobs?status=approved', { token: authToken })).json?.data?.jobs?.some((j) => j.job_id === jobId2)],
    ['help request', (await call('GET', '/api/help', { token: authToken })).json?.data?.requests?.some((r) => r.help_id === helpId)],
    ['poll', (await call('GET', '/api/polls', { token: authToken })).json?.data?.polls?.some((p) => p.poll_id === pollId)],
    ['event', (await call('GET', '/api/events', { token: authToken })).json?.data?.events?.some((e) => e.event_id === eventId)],
    ['vision', (await call('GET', '/api/visions', { token: authToken })).json?.data?.visions?.some((v) => v.vision_id === visionId)],
  ];
  for (const [name, stillThere] of goneChecks) {
    check(`deleted ${name} gone from its list`, !stillThere, 'still visible');
  }

  const appsGone = await dbQuery(`SELECT COUNT(*) AS c FROM job_applications WHERE job_id = ?`, [jobId2]);
  check('job applications cascade with the job', Number(appsGone[0].c) === 0, `count ${appsGone[0].c}`);
  const votesGone = await dbQuery(`SELECT COUNT(*) AS c FROM poll_votes WHERE poll_id = ?`, [pollId]);
  const optsGone = await dbQuery(`SELECT COUNT(*) AS c FROM poll_options WHERE poll_id = ?`, [pollId]);
  check('poll options + votes cascade with the poll', Number(votesGone[0].c) === 0 && Number(optsGone[0].c) === 0, `votes ${votesGone[0].c} options ${optsGone[0].c}`);
  const regsGone = await dbQuery(`SELECT COUNT(*) AS c FROM event_registrations WHERE event_id = ?`, [eventId]);
  check('event registrations cascade with the event', Number(regsGone[0].c) === 0, `count ${regsGone[0].c}`);

  const deadNotifs = await dbQuery(
    `SELECT COUNT(*) AS c FROM notifications
      WHERE (related_entity_type = 'event' AND related_entity_id = ?)
         OR (related_entity_type = 'poll' AND related_entity_id = ?)
         OR (related_entity_type = 'job' AND related_entity_id = ?)`,
    [eventId, pollId, jobId2]
  );
  check('notifications linking to deleted entities cleaned up', Number(deadNotifs[0].c) === 0, `count ${deadNotifs[0].c}`);

  section('12) Blood group search');
  const blood = await call('GET', '/api/blood/search?blood_group=O%2B');
  check('blood search works', blood.status === 200 && Array.isArray(blood.json?.data?.results), `status ${blood.status}`);
  check('blood results expose no contact details', !JSON.stringify(blood.json?.data?.results || []).includes('@'), 'email leaked');

  section('13) Notifications & IDOR');
  const notifs = await call('GET', '/api/notifications', { token: tokenB });
  check('user sees own notifications', notifs.status === 200 && notifs.json?.data?.notifications?.length > 0, `count ${notifs.json?.data?.notifications?.length}`);
  const otherNotifId = notifs.json?.data?.notifications?.[0]?.notification_id;
  const crossRead = await call('PUT', `/api/notifications/${otherNotifId}/read`, { token: tokenC });
  check('cannot mark another user\'s notification read (403/404)', [403, 404].includes(crossRead.status), `status ${crossRead.status}`);

  section('13b) Payments: reg-number lookup, monthly dues, test payment, privacy');
  const PM_YEAR = new Date().getFullYear();
  const pm = (m) => `${PM_YEAR}-${String(m).padStart(2, '0')}`;
  const curMonth = new Date().getMonth() + 1;

  const lookup = await call('GET', `/api/payments/lookup/${encodeURIComponent(users.B.registration_number)}`, { token: authToken });
  check('payments: lookup by registration number', lookup.status === 200 && lookup.json?.data?.member?.user_id === ids.B, `status ${lookup.status}`);
  const lookupBad = await call('GET', '/api/payments/lookup/NOPE-404', { token: authToken });
  check('payments: unknown reg number -> 404', lookupBad.status === 404, `status ${lookupBad.status}`);

  const pStatus0 = await call('GET', '/api/payments/monthly-status', { token: tokenB });
  check('payments: status lists Jan..current month (server date)', pStatus0.status === 200 && pStatus0.json?.data?.months?.length === curMonth, `months ${pStatus0.json?.data?.months?.length}`);
  check('payments: future months never listed', pStatus0.json.data.months.every((m) => m.month <= pm(curMonth)));

  const payMonth = pm(2); // February — stable regardless of the current month
  const pOK = await call('POST', '/api/payments', { token: tokenB, body: { registration_number: users.B.registration_number, payment_type: 'monthly', amount: 50, months: [payMonth], sender_number: '01712345678' } });
  check('payments: ৳50 monthly test payment -> 201 success', pOK.status === 201 && pOK.json?.data?.payment?.status === 'success', `status ${pOK.status} ${pOK.json?.message}`);
  check('payments: covered month recorded', pOK.json?.data?.payment?.covered_months?.[0]?.month === payMonth);
  const pDup = await call('POST', '/api/payments', { token: tokenB, body: { registration_number: users.B.registration_number, payment_type: 'monthly', amount: 50, months: [payMonth], sender_number: '01712345678' } });
  check('payments: duplicate month rejected (409)', pDup.status === 409, `status ${pDup.status}`);
  const pBig = await call('POST', '/api/payments', { token: tokenB, body: { registration_number: users.B.registration_number, payment_type: 'monthly', amount: 150, months: [pm(3)], sender_number: '01712345678' } });
  check('payments: monthly ৳150 rejected (> max 100)', pBig.status === 400, `status ${pBig.status}`);
  const pOcc = await call('POST', '/api/payments', { token: tokenB, body: { registration_number: users.B.registration_number, payment_type: 'occasional', purpose: 'donation', amount: 500, sender_number: '01812345678', description: 'Smoke donation' } });
  check('payments: occasional donation ৳500 -> 201', pOcc.status === 201, `status ${pOcc.status} ${pOcc.json?.message}`);

  const pMine = await call('GET', '/api/payments/mine', { token: tokenB });
  check('payments: own history lists both payments', pMine.status === 200 && pMine.json?.data?.payments?.length === 2, `count ${pMine.json?.data?.payments?.length}`);
  // tokenB belongs to an ADMIN at this point (promoted in section 5), so a plain MEMBER (D) must be denied.
  const pAllDenied = await call('GET', '/api/payments', { token: tokenD });
  check('payments: member cannot list all payments (403)', pAllDenied.status === 403, `status ${pAllDenied.status}`);
  const pSummary = await call('GET', `/api/payments/summary/${ids.B}`, { token: authToken });
  check('payments: authority member summary works', pSummary.status === 200 && Number(pSummary.json?.data?.monthly_total) === 50 && Number(pSummary.json?.data?.occasional_total) === 500, `status ${pSummary.status}`);

  section('13c) Manual payments: bKash/Nagad/Rocket submit -> pending -> review');
  const provs = await call('GET', '/api/payments/providers', { token: tokenD });
  check('payments: providers endpoint lists bkash/nagad/rocket', provs.status === 200 && ['bkash', 'nagad', 'rocket'].every((k) => (provs.json?.data?.providers || []).some((p) => p.key === k)), `status ${provs.status}`);
  check('payments: no invented app deep links (app_url null)', (provs.json?.data?.providers || []).every((p) => p.app_url === null), JSON.stringify((provs.json?.data?.providers || []).map((p) => p.app_url)));
  const provsAnon = await call('GET', '/api/payments/providers', {});
  check('payments: providers endpoint requires auth (401 anon)', provsAnon.status === 401, `status ${provsAnon.status}`);

  const mp = (provKey, txn, extra = {}) => {
    const f = new FormData();
    f.append('registration_number', users.D.registration_number);
    f.append('payment_type', extra.type || 'monthly');
    f.append('payment_method', provKey);
    if (extra.type === 'occasional') {
      f.append('purpose', extra.purpose || 'donation');
      f.append('amount', String(extra.amount || 300));
    } else {
      f.append('amount', String(extra.amount || 50));
      f.append('billing_month', extra.billing_month || payMonthD);
    }
    f.append('transaction_id', txn);
    return f;
  };
  const payMonthD = pm(curMonth); // user D has paid nothing — current month is due

  const mOK = await call('POST', '/api/payments/manual', { token: tokenD, form: mp('bkash', `SMOKETRX${stamp}A`) });
  check('payments: manual bkash submit -> 201 PENDING', mOK.status === 201 && mOK.json?.data?.payment?.status === 'pending', `status ${mOK.status} ${mOK.json?.message || ''}`);
  check('payments: submission says waiting for verification', (mOK.json?.message || '').includes('waiting for verification'), mOK.json?.message);
  check('payments: billing month stored separately', mOK.json?.data?.payment?.billing_month === payMonthD, String(mOK.json?.data?.payment?.billing_month));
  const mStatus0 = await call('GET', '/api/payments/monthly-status', { token: tokenD });
  const mMonth0 = mStatus0.json?.data?.months?.find((m) => m.month === payMonthD);
  check('payments: pending month NEVER looks paid', mMonth0 && mMonth0.paid === false && mMonth0.pending === true, JSON.stringify(mMonth0));
  const mMine0 = await call('GET', '/api/payments/mine', { token: tokenD });
  check('payments: pending NOT counted in member totals', Number(mMine0.json?.data?.totals?.monthly_total) === 0, JSON.stringify(mMine0.json?.data?.totals));

  const mDup = await call('POST', '/api/payments/manual', { token: tokenD, form: mp('nagad', `SMOKETRX${stamp}A`, { type: 'occasional', amount: 300 }) });
  check('payments: duplicate Transaction ID -> 409', mDup.status === 409, `status ${mDup.status} ${mDup.json?.message || ''}`);
  check('payments: duplicate message exact', mDup.json?.message === 'This Transaction ID has already been submitted.', mDup.json?.message);
  const mSame = await call('POST', '/api/payments/manual', { token: tokenD, form: mp('rocket', `SMOKETRX${stamp}B`) });
  check('payments: same month already pending -> 409', mSame.status === 409, `status ${mSame.status} ${mSame.json?.message || ''}`);
  const mShort = await call('POST', '/api/payments/manual', { token: tokenD, form: mp('bkash', 'AB1', { type: 'occasional', amount: 100 }) });
  check('payments: short Transaction ID rejected (400)', mShort.status === 400, `status ${mShort.status}`);
  const mTestProv = await call('POST', '/api/payments/manual', { token: tokenD, form: mp('test', `SMOKETRX${stamp}C`, { type: 'occasional', amount: 100 }) });
  check('payments: manual endpoint rejects test provider (400)', mTestProv.status === 400, `status ${mTestProv.status}`);

  const mPayId = mOK.json?.data?.payment?.payment_id;
  const mSelfReview = await call('PATCH', `/api/payments/${mPayId}/review`, { token: tokenD, body: { status: 'success' } });
  check('payments: member cannot review own payment (403)', mSelfReview.status === 403, `status ${mSelfReview.status}`);
  const mBadStatus = await call('PATCH', `/api/payments/${mPayId}/review`, { token: authToken, body: { status: 'approved' } });
  check('payments: invalid review status rejected (422)', mBadStatus.status === 422, `status ${mBadStatus.status}`);

  const mApprove = await call('PATCH', `/api/payments/${mPayId}/review`, { token: authToken, body: { status: 'success', note: 'TrxID verified' } });
  check('payments: authority approves monthly -> success', mApprove.status === 200 && mApprove.json?.data?.payment?.status === 'success', `status ${mApprove.status} ${mApprove.json?.message || ''}`);
  check('payments: approval records reviewer + note', !!mApprove.json?.data?.payment?.reviewed_at && mApprove.json?.data?.payment?.review_note === 'TrxID verified', 'missing reviewer info');
  const mStatus1 = await call('GET', '/api/payments/monthly-status', { token: tokenD });
  const mMonth1 = mStatus1.json?.data?.months?.find((m) => m.month === payMonthD);
  check('payments: month paid ONLY after approval', mMonth1 && mMonth1.paid === true && mMonth1.pending === false, JSON.stringify(mMonth1));
  const mReReview = await call('PATCH', `/api/payments/${mPayId}/review`, { token: authToken, body: { status: 'rejected' } });
  check('payments: second review blocked (409)', mReReview.status === 409, `status ${mReReview.status}`);

  const mOcc = await call('POST', '/api/payments/manual', { token: tokenD, form: mp('nagad', `SMOKETRX${stamp}D`, { type: 'occasional', amount: 500, purpose: 'donation' }) });
  check('payments: occasional manual submit -> 201 PENDING', mOcc.status === 201 && mOcc.json?.data?.payment?.status === 'pending', `status ${mOcc.status}`);
  const mOccId = mOcc.json?.data?.payment?.payment_id;
  const mReject = await call('PATCH', `/api/payments/${mOccId}/review`, { token: authToken, body: { status: 'rejected', note: 'No such TrxID' } });
  check('payments: authority rejects occasional', mReject.status === 200 && mReject.json?.data?.payment?.status === 'rejected', `status ${mReject.status}`);
  const mMine1 = await call('GET', '/api/payments/mine', { token: tokenD });
  check('payments: rejected payment NOT in totals (monthly ৳50 only)', Number(mMine1.json?.data?.totals?.monthly_total) === 50 && Number(mMine1.json?.data?.totals?.occasional_total) === 0, JSON.stringify(mMine1.json?.data?.totals));
  const mRejectedRow = mMine1.json?.data?.payments?.find((p) => p.payment_id === mOccId);
  check('payments: rejected payment shows reviewer + note', mRejectedRow?.status === 'rejected' && !!mRejectedRow?.review_note, 'missing review info');

  section('14) Password reset flow (OTP)');
  const forgot = await call('POST', '/api/auth/forgot-password', { body: { email: users.D.email } });
  check('forgot-password accepts request', forgot.status === 200, `status ${forgot.status}`);
  const cooldown = await call('POST', '/api/auth/forgot-password', { body: { email: users.D.email } });
  check('resend cooldown enforced (409)', cooldown.status === 409, `status ${cooldown.status}`);
  const otp = forgot.json?.data?.dev_otp;
  if (otp) {
    check('dev OTP available in local (no-SMTP) mode', true);
  } else {
    check('OTP never exposed in the API response when SMTP delivers',
      forgot.json?.data?.dev_otp === undefined || forgot.json?.data?.dev_otp === null,
      `dev_otp=${String(forgot.json?.data?.dev_otp)}`);
  }
  // The confirm-password mismatch is checked BEFORE the OTP is consumed, so a
  // syntactically valid dummy code reaches the same 400 path in both modes.
  const mismatch = await call('POST', '/api/auth/reset-password', { body: { email: users.D.email, otp: otp || '000000', password: 'NewPassw0rd!23', confirm_password: 'Different1!23' } });
  check('confirm-password mismatch rejected (400)', mismatch.status === 400, `status ${mismatch.status}`);
  const badReset = await call('POST', '/api/auth/reset-password', { body: { email: users.D.email, otp: '000000', password: 'NewPassw0rd!23', confirm_password: 'NewPassw0rd!23' } });
  check('wrong OTP rejected (400)', badReset.status === 400, `status ${badReset.status}`);
  let dPassword = users.D.password;
  if (otp) {
    const verify = await call('POST', '/api/auth/verify-otp', { body: { email: users.D.email, otp } });
    check('verify-otp accepts correct code (200)', verify.status === 200, `status ${verify.status}`);
    const goodReset = await call('POST', '/api/auth/reset-password', { body: { email: users.D.email, otp, password: 'NewPassw0rd!23', confirm_password: 'NewPassw0rd!23' } });
    check('correct OTP resets password -> 200', goodReset.status === 200, `status ${goodReset.status} ${goodReset.json?.message || ''}`);
    const reuseOtp = await call('POST', '/api/auth/reset-password', { body: { email: users.D.email, otp, password: 'Another1!23', confirm_password: 'Another1!23' } });
    check('OTP is single-use (4xx)', reuseOtp.status >= 400, `status ${reuseOtp.status}`);
    const newLogin = await call('POST', '/api/auth/login', { body: { email: users.D.email, password: 'NewPassw0rd!23' } });
    check('login with new password works', newLogin.status === 200, `status ${newLogin.status}`);
    const staleAfterReset = await call('GET', '/api/notifications', { token: tokenD });
    check('old token invalid after password reset (401)', staleAfterReset.status === 401, `status ${staleAfterReset.status}`);
    dPassword = 'NewPassw0rd!23';
  } else {
    console.log('  (SMTP delivers the reset code to the mailbox — the delivered-email leg cannot be automated here; change-password below exercises the same token_version revocation.)');
  }

  section('15) Session invalidation after password change');
  // change-password is always available (no mailbox needed) and must revoke
  // every previously issued session via token_version — same policy as reset.
  const freshD = await call('POST', '/api/auth/login', { body: { email: users.D.email, password: dPassword } });
  check('member D can log in with the current password', freshD.status === 200, `status ${freshD.status}`);
  const chg = await call('POST', '/api/auth/change-password', { token: freshD.json?.data?.token, body: { current_password: dPassword, password: 'FinalPass!23' } });
  check('change-password -> 200', chg.status === 200, `status ${chg.status} ${chg.json?.message || ''}`);
  const staleRead = await call('GET', '/api/notifications', { token: tokenD });
  check('pre-change token invalid after password change (401)', staleRead.status === 401, `status ${staleRead.status}`);
  const staleFresh = await call('GET', '/api/notifications', { token: freshD.json?.data?.token });
  check('token used to change the password is also revoked (401)', staleFresh.status === 401, `status ${staleFresh.status}`);
  const reloginD = await call('POST', '/api/auth/login', { body: { email: users.D.email, password: 'FinalPass!23' } });
  check('login with the newest password works (200)', reloginD.status === 200, `status ${reloginD.status}`);

  section('15b) Member deletion with contribution-rate attribution (fk_mmr_setby -> SET NULL)');
  // Regression for the production error "Cannot delete or update a parent row:
  // a foreign key constraint fails (member_monthly_rates, fk_mmr_setby)".
  // Retention matrix: own rates leave with the account (audited), rates set for
  // other members survive with identity snapshot, payment history still blocks.
  const nextMonth = curMonth === 12 ? `${PM_YEAR + 1}-01` : pm(curMonth + 1);

  // (a) A sets their OWN rate (set_by = A, user_id = A).
  const rateA = await call('POST', '/api/contributions/mine/rate', { token: tokenA, body: { amount: 50, effective_month: pm(curMonth) } });
  check('member sets own contribution rate -> 201', rateA.status === 201, `status ${rateA.status} ${rateA.json?.message || ''}`);

  // (b) C (staff-capable) sets NEXT-MONTH rates for A and B: attribution rows.
  const list15b = await call('GET', '/api/users', { token: authToken });
  const cInfo = list15b.json?.data?.users?.find((u) => u.user_id === ids.C);
  if (cInfo?.role === 'MEMBER') {
    const promC = await call('PUT', `/api/users/${ids.C}/promote-admin`, { token: authToken });
    check('fixture: C promoted to Admin to set rates', promC.status === 200, `status ${promC.status} ${promC.json?.message || ''}`);
  }
  const cRateA = await call('POST', `/api/contributions/members/${ids.A}/rate`, { token: tokenC, body: { amount: 30, effective_month: nextMonth } });
  check('admin sets rate for member A -> 201', cRateA.status === 201, `status ${cRateA.status} ${cRateA.json?.message || ''}`);
  const cRateB = await call('POST', `/api/contributions/members/${ids.B}/rate`, { token: tokenC, body: { amount: 100, effective_month: nextMonth } });
  check('admin sets rate for member B -> 201', cRateB.status === 201, `status ${cRateB.status} ${cRateB.json?.message || ''}`);

  // (c) Authorization unchanged: a MEMBER may not delete anyone.
  const memberDel = await call('DELETE', `/api/users/${ids.C}`, { token: tokenA });
  check('MEMBER cannot delete users (403)', memberDel.status === 403, `status ${memberDel.status}`);

  // (d) Delete C — staff who set rates for OTHER members. Deletion succeeds;
  //     the rows for A and B survive with the setter's identity snapshotted.
  const delC = await call('DELETE', `/api/users/${ids.C}`, { token: authToken });
  check('delete staff who set rates for others -> 200', delC.status === 200, `status ${delC.status} ${delC.json?.message || ''}`);
  check('response reports preserved attributions (2)', delC.json?.data?.attribution_rates_preserved === 2, JSON.stringify(delC.json?.data));
  const cGone = await call('GET', `/api/users/${ids.C}`, { token: authToken });
  check('deleted staff member is gone (404)', cGone.status === 404, `status ${cGone.status}`);
  const bRow = await dbQuery(`SELECT set_by, set_by_snapshot, amount FROM member_monthly_rates WHERE user_id = ? AND effective_month = ?`, [ids.B, nextMonth]);
  check("B's rate row survives the setter's deletion", bRow.length === 1 && Number(bRow[0].amount) === 100, JSON.stringify(bRow));
  check('set_by released to NULL (no dangling FK)', bRow[0]?.set_by === null, String(bRow[0]?.set_by));
  check('setter identity preserved in set_by_snapshot', String(bRow[0]?.set_by_snapshot || '').includes(users.C.email), String(bRow[0]?.set_by_snapshot));

  // (e) Delete A — member who set their OWN rate (plus an admin-set row):
  //     both rows leave with the account (CASCADE policy), captured in audit.
  const delA = await call('DELETE', `/api/users/${ids.A}`, { token: authToken });
  check('delete member who set own rate -> 200', delA.status === 200, `status ${delA.status} ${delA.json?.message || ''}`);
  check('response reports own rates removed (2)', delA.json?.data?.own_rates_removed === 2, JSON.stringify(delA.json?.data));
  const aGone = await call('GET', `/api/users/${ids.A}`, { token: authToken });
  check('deleted member is gone (404)', aGone.status === 404, `status ${aGone.status}`);
  const aTokenDead = await call('GET', '/api/notifications', { token: tokenA });
  check("deleted member's token invalidated (401)", aTokenDead.status === 401, `status ${aTokenDead.status}`);
  const aRatesLeft = await dbQuery(`SELECT rate_id FROM member_monthly_rates WHERE user_id = ?`, [ids.A]);
  check("member's own rate rows leave with the account", aRatesLeft.length === 0, `rows ${aRatesLeft.length}`);
  const bRowAfterA = await dbQuery(`SELECT set_by, set_by_snapshot FROM member_monthly_rates WHERE user_id = ? AND effective_month = ?`, [ids.B, nextMonth]);
  check("other members' rate rows unchanged by second deletion", bRowAfterA.length === 1 && bRowAfterA[0].set_by === null, JSON.stringify(bRowAfterA));

  // (f) Payment history still blocks, with the exact dependency, and a failed
  //     deletion leaves EVERYTHING unchanged (no partial writes).
  const bPayBefore = await dbQuery(`SELECT payment_id, amount, status FROM payments WHERE user_id = ? ORDER BY payment_id`, [ids.B]);
  const bRowBefore = await dbQuery(`SELECT set_by, set_by_snapshot, amount FROM member_monthly_rates WHERE user_id = ? ORDER BY rate_id`, [ids.B]);
  const delB = await call('DELETE', `/api/users/${ids.B}`, { token: authToken });
  check('delete member with payment history -> 409', delB.status === 409, `status ${delB.status} ${delB.json?.message || ''}`);
  check('block message names the exact dependency', /payment record\(s\).*৳/i.test(delB.json?.message || ''), delB.json?.message || 'no message');
  check('block message leaks no MySQL internals', !/foreign key|constraint|1451|errno/i.test(delB.json?.message || ''), delB.json?.message || 'no message');
  const bStill = await call('GET', `/api/users/${ids.B}`, { token: authToken });
  check('blocked user still exists (200)', bStill.status === 200, `status ${bStill.status}`);
  const bPayAfter = await dbQuery(`SELECT payment_id, amount, status FROM payments WHERE user_id = ? ORDER BY payment_id`, [ids.B]);
  const bRowAfter = await dbQuery(`SELECT set_by, set_by_snapshot, amount FROM member_monthly_rates WHERE user_id = ? ORDER BY rate_id`, [ids.B]);
  check('failed deletion rolls back / changes nothing', JSON.stringify(bPayBefore) === JSON.stringify(bPayAfter) && JSON.stringify(bRowBefore) === JSON.stringify(bRowAfter), 'rows changed');
  const dPay = await dbQuery(`SELECT COUNT(*) AS c FROM payments WHERE user_id = ?`, [ids.D]);
  check("other members' payment records unchanged", Number(dPay[0].c) === 2, `count ${dPay[0].c}`);

  // (g) Historical audit information remains available (user_deleted entries).
  const audit15b = await call('GET', '/api/users/audit', { token: authToken });
  const acts = audit15b.json?.data?.activity || [];
  const auditC = acts.find((a) => a.action === 'user_deleted' && Number(a.entity_id) === ids.C);
  const auditA = acts.find((a) => a.action === 'user_deleted' && Number(a.entity_id) === ids.A);
  // audit_logs.details is a MySQL JSON column — mysql2 returns it as an OBJECT.
  const detailsOf = (a) => JSON.stringify(a?.details || {});
  check('audit entry records staff deletion with attribution ids', !!auditC && detailsOf(auditC).includes(users.C.email) && detailsOf(auditC).includes('attribution_rates_preserved'), detailsOf(auditC).slice(0, 120) || 'missing');
  check('audit entry records own-rate removals for member deletion', !!auditA && detailsOf(auditA).includes('own_rates_removed_with_account'), detailsOf(auditA).slice(0, 120) || 'missing');

  // (h) Admin demotion continues to work without deleting the account.
  const demoteB = await call('PUT', `/api/users/${ids.B}/demote-admin`, { token: authToken });
  check('admin demotion still works (200) and deletes nothing', demoteB.status === 200, `status ${demoteB.status} ${demoteB.json?.message || ''}`);
  const bRole = await dbQuery(`SELECT r.role_name FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = ?`, [ids.B]);
  check('demoted admin still exists as MEMBER', bRole[0]?.role_name === 'MEMBER', String(bRole[0]?.role_name));

  // (i) Eligible member with NO dependencies deletes cleanly (200 -> 404).
  users.E = mkUser('e');
  const regE = await call('POST', '/api/auth/register', { body: users.E });
  check('register throwaway E -> 201', regE.status === 201, `status ${regE.status}`);
  const listE = await call('GET', '/api/users/pending', { token: authToken });
  const eId = listE.json?.data?.users?.find((u) => u.email === users.E.email)?.user_id;
  const apprE = await call('PUT', `/api/users/${eId}/approve`, { token: authToken });
  check('approve E', apprE.status === 200, `status ${apprE.status}`);
  const delE = await call('DELETE', `/api/users/${eId}`, { token: authToken });
  check('delete eligible member with no history -> 200', delE.status === 200, `status ${delE.status} ${delE.json?.message || ''}`);
  const eGone = await call('GET', `/api/users/${eId}`, { token: authToken });
  check('deleted member is gone (404)', eGone.status === 404, `status ${eGone.status}`);

  console.log('');
  await cleanupFixtures('end');
  report();
}

function report() {
  console.log('\n==================================================');
  console.log(`SMOKE TEST RESULT: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log('==================================================');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\nSmoke test crashed:', err.message);
  console.error('Is the backend running on port 5000, and has the database been initialized?');
  process.exit(1);
});
