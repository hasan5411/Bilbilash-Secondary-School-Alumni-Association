/**
 * Authority-initialization test suite.
 *
 * Verifies the secure initial-Authority mechanism end to end (master spec §6):
 *   1. The AUTHORITY role is resolved from the real `roles` table (never hardcoded).
 *   2. `npm run init-db` (the REAL script, run as a subprocess) is idempotent:
 *      repeated runs never duplicate the account and never change its password.
 *   3. The seed is create-only and race-safe (parallel runs → exactly one account).
 *   4. An existing NON-authority account holding AUTHORITY_EMAIL is NEVER
 *      promoted or taken over (privilege-escalation guard) — by the module AND
 *      by the real init-db script (exit code 1, row untouched).
 *   5. Correct Authority credentials log in (200, role AUTHORITY); wrong
 *      password and unknown email are rejected 401 with the SAME message
 *      (no account enumeration); pending members get 403 and no token.
 *   6. Authorization: authority can approve members and read the authority-only
 *      audit trail; pending accounts are blocked on every request; members and
 *      anonymous callers cannot approve or promote anyone; the Authority
 *      account itself cannot be modified through the API; public registration
 *      can never smuggle role/status.
 *   7. `npm run authority:set-password` (REAL script) recovers the password of
 *      an AUTHORITY account and refuses to touch any other role.
 *   8. No credential (password) ever appears in script output or API responses.
 *
 * Requires: backend running on :5000 and the embedded/local database
 * (same setup as the other suites). Fixtures use `authoritytest.%@example.com`
 * and are deleted by this suite only.
 *
 * Usage: cd backend && npm run authority-init-test
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { openTestDb } from './pgTestClient.js';
import { pool } from '../src/db/pool.js';
import { ensureAuthorityAccount, resolveAuthorityRoleId } from '../src/db/authoritySeed.js';
import { signToken } from '../src/utils/jwt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.join(__dirname, '..');
const BASE = process.env.SMOKE_BASE || 'http://localhost:5000';

const stamp = Date.now();
const TEST_AUTHORITY_EMAIL = `authoritytest.authority.${stamp}@example.com`;
const TEST_AUTHORITY_PASSWORD = 'Authority-Test-Pass!23';
const CONFLICT_EMAIL = `authoritytest.conflict.${stamp}@example.com`;
const CONFLICT_PASSWORD = 'Conflict-Test-Pass!23';
const MEMBER_EMAIL = `authoritytest.member.${stamp}@example.com`;
const MEMBER_PASSWORD = 'Member-Test-Pass!23';

const ENV_EMAIL = String(process.env.AUTHORITY_EMAIL || '').trim().toLowerCase();
const ENV_PASSWORD = process.env.AUTHORITY_PASSWORD || '';

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

const section = (title) => console.log(`\n${title}`);

/** Direct DB access (test-only) with the mysql2-style shape used by suites. */
async function db(sql, params = []) {
  const conn = await openTestDb();
  try {
    const [rows] = await conn.query(sql, params);
    return rows;
  } finally {
    await conn.end().catch(() => {});
  }
}

async function call(method, pathName, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${pathName}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

/** Run a REAL project script (init-db / authority:set-password) as a subprocess. */
function runScript(scriptRelPath, envOverrides = {}) {
  try {
    const stdout = execFileSync(process.execPath, [path.join('src', scriptRelPath)], {
      cwd: BACKEND_DIR,
      env: { ...process.env, ...envOverrides },
      encoding: 'utf8',
    });
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

async function authorityRowCount(email) {
  const rows = await db('SELECT COUNT(*) AS cnt FROM users WHERE email = ?', [email]);
  return Number(rows[0].cnt);
}

async function authoritySnapshot(email) {
  const rows = await db(
    `SELECT u.user_id, u.password_hash, u.status, u.is_active, u.token_version, r.role_name
       FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.email = ? LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

async function cleanup() {
  try {
    await db(`DELETE FROM password_resets WHERE user_id IN (SELECT user_id FROM users WHERE email LIKE ?)`, ['authoritytest.%@example.com']);
    await db(`DELETE FROM member_monthly_rates WHERE user_id IN (SELECT user_id FROM users WHERE email LIKE ?)`, ['authoritytest.%@example.com']);
    await db(`DELETE FROM users WHERE email LIKE ?`, ['authoritytest.%@example.com']);
    console.log('  (fixtures cleaned: authoritytest.%@example.com)');
  } catch (err) {
    console.log(`  (cleanup skipped: ${err.code || err.message})`);
  }
}

async function main() {
  if (!ENV_EMAIL || !ENV_PASSWORD) {
    console.error('AUTHORITY_EMAIL / AUTHORITY_PASSWORD missing. Run from the backend folder so .env is loaded.');
    process.exit(1);
  }
  await cleanup();

  // ─────────────────────────────────────────────────────────────
  section('1) Role schema inspection (no hardcoded role ids)');
  const authRoleId = await resolveAuthorityRoleId(pool);
  check('AUTHORITY role exists in roles table', Number.isInteger(Number(authRoleId)), String(authRoleId));
  const roleRows = await db(`SELECT role_id, role_name FROM roles ORDER BY role_id`);
  const names = roleRows.map((r) => r.role_name);
  check('all four roles seeded', ['VISITOR', 'MEMBER', 'ADMIN', 'AUTHORITY'].every((n) => names.includes(n)), names.join(','));
  const visitorRole = roleRows.find((r) => r.role_name === 'VISITOR');
  check('AUTHORITY role_id differs from VISITOR role_id (seed order respected)',
    Number(authRoleId) !== Number(visitorRole?.role_id),
    `authority=${authRoleId} visitor=${visitorRole?.role_id}`);

  // ─────────────────────────────────────────────────────────────
  section('2) Real script: npm run init-db is idempotent and credential-safe');
  const envBefore = await authoritySnapshot(ENV_EMAIL);
  const run1 = runScript('db/initDb.js');
  check('init-db run #1 exits 0', run1.code === 0, run1.out.split('\n').slice(-4).join(' | '));
  check('init-db run #1 created or kept exactly one Authority account', await authorityRowCount(ENV_EMAIL) === 1);
  const envAfter1 = await authoritySnapshot(ENV_EMAIL);
  const run2 = runScript('db/initDb.js');
  check('init-db run #2 exits 0 (idempotent)', run2.code === 0, run2.out.split('\n').slice(-4).join(' | '));
  check('init-db run #2 created NO duplicate account', await authorityRowCount(ENV_EMAIL) === 1);
  const envAfter2 = await authoritySnapshot(ENV_EMAIL);
  check('existing Authority password hash untouched by re-run',
    envAfter1 && envAfter2 && envAfter1.password_hash === envAfter2.password_hash);
  check('run #2 reports "already exists" (no silent overwrite)',
    /already exists/.test(run2.out), run2.out.trim().split('\n').slice(-3).join(' | '));
  if (envBefore) {
    check('account that existed before was NOT modified at all',
      envBefore.password_hash === envAfter2.password_hash
      && envBefore.token_version === envAfter2.token_version
      && envBefore.role_name === envAfter2.role_name);
  }
  check('init-db never prints AUTHORITY_PASSWORD', !run1.out.includes(ENV_PASSWORD) && !run2.out.includes(ENV_PASSWORD));

  // ─────────────────────────────────────────────────────────────
  section('3) Seed module: create-only, race-safe, validated');
  const created = await ensureAuthorityAccount(pool, { email: TEST_AUTHORITY_EMAIL, password: TEST_AUTHORITY_PASSWORD });
  check('fresh email → action "created"', created.action === 'created', JSON.stringify(created));
  const snap = await authoritySnapshot(TEST_AUTHORITY_EMAIL);
  const snapRoleRows = await db('SELECT role_id FROM users WHERE user_id = ?', [snap.user_id]);
  check('created row holds the AUTHORITY role_id resolved from roles table (not hardcoded)',
    snap?.role_name === 'AUTHORITY' && Number(snapRoleRows[0].role_id) === Number(authRoleId),
    `role_id=${snapRoleRows[0].role_id} expected=${authRoleId}`);
  check('created row is approved + active', snap?.status === 'approved' && Number(snap?.is_active) === 1, JSON.stringify(snap));
  check('password verifies with bcrypt (same method as login)', await bcrypt.compare(TEST_AUTHORITY_PASSWORD, snap.password_hash));
  const profRows = await db('SELECT bio FROM profiles WHERE user_id = ?', [snap.user_id]);
  check('profile row created for the account', profRows.length === 1 && profRows[0].bio === 'System authority account');

  const again = await ensureAuthorityAccount(pool, { email: TEST_AUTHORITY_EMAIL, password: TEST_AUTHORITY_PASSWORD });
  const snapAgain = await authoritySnapshot(TEST_AUTHORITY_EMAIL);
  check('re-run → action "exists" with same user_id', again.action === 'exists' && Number(again.userId) === Number(snap.user_id), JSON.stringify(again));
  check('re-run did not change the password hash', snapAgain.password_hash === snap.password_hash);
  check('re-run did not change role/status/token_version',
    snapAgain.role_name === 'AUTHORITY' && snapAgain.status === 'approved' && snapAgain.token_version === snap.token_version);
  check('still exactly one account', await authorityRowCount(TEST_AUTHORITY_EMAIL) === 1);

  const PAR_EMAIL = `authoritytest.parallel.${stamp}@example.com`;
  const [p1, p2] = await Promise.all([
    ensureAuthorityAccount(pool, { email: PAR_EMAIL, password: TEST_AUTHORITY_PASSWORD }),
    ensureAuthorityAccount(pool, { email: PAR_EMAIL, password: TEST_AUTHORITY_PASSWORD }),
  ]);
  const actions = [p1.action, p2.action].sort();
  check('concurrent initialization → exactly one "created", one "exists"',
    actions.join(',') === 'created,exists', `${p1.action} / ${p2.action}`);
  check('concurrent initialization → exactly one row', await authorityRowCount(PAR_EMAIL) === 1);

  let shortPasswordThrew = false;
  try { await ensureAuthorityAccount(pool, { email: `authoritytest.short.${stamp}@example.com`, password: 'short' }); }
  catch { shortPasswordThrew = true; }
  check('password shorter than 8 chars is rejected', shortPasswordThrew);
  let emptyEmailThrew = false;
  try { await ensureAuthorityAccount(pool, { email: '  ', password: TEST_AUTHORITY_PASSWORD }); }
  catch { emptyEmailThrew = true; }
  check('empty AUTHORITY_EMAIL is rejected', emptyEmailThrew);

  // ─────────────────────────────────────────────────────────────
  section('4) Privilege-escalation guard: a member owning AUTHORITY_EMAIL is never promoted');
  const reg = await call('POST', '/api/auth/register', {
    body: {
      first_name: 'ConfTest', last_name: 'Tester', email: CONFLICT_EMAIL,
      password: CONFLICT_PASSWORD, phone: '01700000001',
      registration_number: `AUTHTEST-REG-${stamp}`, ssc_batch: 2011, blood_group: 'B+',
      present_address: 'Dhaka', permanent_address: 'Dhaka',
      role: 'AUTHORITY', status: 'approved', // must be IGNORED by registration
    },
  });
  check('registration with role:"AUTHORITY" in body still succeeds (field ignored)', reg.status === 201, JSON.stringify(reg.json));
  const conflictSnap0 = await authoritySnapshot(CONFLICT_EMAIL);
  check('registered account is a pending VISITOR (no privileges smuggled)',
    conflictSnap0?.role_name === 'VISITOR' && conflictSnap0?.status === 'pending', JSON.stringify(conflictSnap0));

  const conflict = await ensureAuthorityAccount(pool, { email: CONFLICT_EMAIL, password: TEST_AUTHORITY_PASSWORD });
  const conflictSnap1 = await authoritySnapshot(CONFLICT_EMAIL);
  check('seed returns "conflict" for a non-authority account', conflict.action === 'conflict', JSON.stringify(conflict));
  check('conflicting account NOT promoted (role stays VISITOR)', conflictSnap1.role_name === 'VISITOR');
  check('conflicting account NOT approved (status stays pending)', conflictSnap1.status === 'pending');
  check('conflicting account password NOT overwritten', conflictSnap1.password_hash === conflictSnap0.password_hash);

  const initConflict = runScript('db/initDb.js', { AUTHORITY_EMAIL: CONFLICT_EMAIL });
  const conflictSnap2 = await authoritySnapshot(CONFLICT_EMAIL);
  check('real init-db REFUSES (exit 1) when AUTHORITY_EMAIL is taken by a member', initConflict.code === 1, `code ${initConflict.code}`);
  check('init-db refusal output is actionable and credential-free',
    /REFUSING/.test(initConflict.out) && !initConflict.out.includes(CONFLICT_PASSWORD) && !initConflict.out.includes(ENV_PASSWORD));
  check('init-db refusal left the member row completely untouched',
    conflictSnap2.password_hash === conflictSnap0.password_hash
    && conflictSnap2.role_name === 'VISITOR' && conflictSnap2.status === 'pending');

  // ─────────────────────────────────────────────────────────────
  section('5) Login: correct credentials work, wrong ones fail safely');
  const okLogin = await call('POST', '/api/auth/login', { body: { email: TEST_AUTHORITY_EMAIL, password: TEST_AUTHORITY_PASSWORD } });
  check('correct Authority credentials → 200', okLogin.status === 200, JSON.stringify(okLogin.json));
  check('logged-in account has role AUTHORITY', okLogin.json?.data?.user?.role === 'AUTHORITY');
  const authorityToken = okLogin.json?.data?.token;
  const me = await call('GET', '/api/auth/me', { token: authorityToken });
  check('Bearer token accepted by /api/auth/me', me.status === 200 && me.json?.data?.user?.role === 'AUTHORITY');

  const wrongPw = await call('POST', '/api/auth/login', { body: { email: TEST_AUTHORITY_EMAIL, password: 'WrongPassword!123' } });
  check('wrong password → 401', wrongPw.status === 401, `status ${wrongPw.status}`);
  const unknown = await call('POST', '/api/auth/login', { body: { email: `authoritytest.nobody.${stamp}@example.com`, password: 'Whatever!12345' } });
  check('unknown email → 401', unknown.status === 401, `status ${unknown.status}`);
  check('unknown email and wrong password are indistinguishable (no enumeration)',
    wrongPw.json?.message === unknown.json?.message && /Invalid email or password/.test(unknown.json?.message || ''),
    `wrong=${wrongPw.json?.message} unknown=${unknown.json?.message}`);
  const leaky = JSON.stringify(wrongPw.json) + JSON.stringify(unknown.json);
  check('401 bodies leak no hash/token/stack', !/password_hash|token|stack/i.test(leaky), leaky.slice(0, 200));

  // ─────────────────────────────────────────────────────────────
  section('6) Authorization matrix: only the intended privileges');
  // Pending member: register (login must fail with 403 and no token).
  const memberReg = await call('POST', '/api/auth/register', {
    body: {
      first_name: 'AuthTest', last_name: 'Member', email: MEMBER_EMAIL,
      password: MEMBER_PASSWORD, phone: '01700000002',
      registration_number: `AUTHTEST-MEM-${stamp}`, ssc_batch: 2012, blood_group: 'O+',
      present_address: 'Dhaka', permanent_address: 'Dhaka',
    },
  });
  check('member registration → 201', memberReg.status === 201, JSON.stringify(memberReg.json));
  const pendingLogin = await call('POST', '/api/auth/login', { body: { email: MEMBER_EMAIL, password: MEMBER_PASSWORD } });
  check('pending member login → 403 (no token issued)', pendingLogin.status === 403 && !pendingLogin.json?.data?.token, JSON.stringify(pendingLogin.json));

  const memberSnap = await authoritySnapshot(MEMBER_EMAIL);
  // Simulate an OLD JWT held by the still-pending account (authenticate must block it).
  const stalePendingToken = signToken({ user_id: memberSnap.user_id, token_version: memberSnap.token_version });
  const staleBlocked = await call('GET', '/api/profile', { token: stalePendingToken });
  check('pending account with a valid-shaped JWT is blocked on protected routes (401)',
    staleBlocked.status === 401, `status ${staleBlocked.status}`);

  // Anonymous + non-privileged callers cannot approve or promote.
  const anonApprove = await call('PUT', `/api/users/${memberSnap.user_id}/approve`);
  check('anonymous approve attempt → 401', anonApprove.status === 401, `status ${anonApprove.status}`);
  const anonPromote = await call('PUT', `/api/users/${memberSnap.user_id}/promote-admin`);
  check('anonymous promote attempt → 401', anonPromote.status === 401, `status ${anonPromote.status}`);
  const bogusApprove = await call('PUT', `/api/users/${memberSnap.user_id}/approve`, { token: 'not.a.real.token' });
  check('garbage token → 401', bogusApprove.status === 401, `status ${bogusApprove.status}`);

  // Authority CAN do the intended moderation work.
  const pendingList = await call('GET', '/api/users/pending', { token: authorityToken });
  const listed = (pendingList.json?.data?.users || pendingList.json?.data || []).some?.((u) => u?.email === MEMBER_EMAIL)
    || JSON.stringify(pendingList.json).includes(MEMBER_EMAIL);
  check('authority sees the pending member in the moderation queue', pendingList.status === 200 && listed, `status ${pendingList.status}`);
  const approve = await call('PUT', `/api/users/${memberSnap.user_id}/approve`, { token: authorityToken });
  check('authority approves the pending member → 200', approve.status === 200, JSON.stringify(approve.json));
  const memberAfter = await authoritySnapshot(MEMBER_EMAIL);
  check('approval flips status→approved and role→MEMBER', memberAfter?.status === 'approved' && memberAfter?.role_name === 'MEMBER', JSON.stringify(memberAfter));

  // The Authority account itself is protected from modification through the API.
  const envSnap = await authoritySnapshot(TEST_AUTHORITY_EMAIL);
  const selfDeactivate = await call('PUT', `/api/users/${envSnap.user_id}/deactivate`, { token: authorityToken });
  check('Authority account cannot be deactivated through the API (403)',
    selfDeactivate.status === 403, `status ${selfDeactivate.status} ${JSON.stringify(selfDeactivate.json)}`);

  // Approved member: limited privileges.
  const memberLogin = await call('POST', '/api/auth/login', { body: { email: MEMBER_EMAIL, password: MEMBER_PASSWORD } });
  check('approved member can now log in → 200', memberLogin.status === 200, JSON.stringify(memberLogin.json));
  const memberToken = memberLogin.json?.data?.token;
  check('approved member has role MEMBER', memberLogin.json?.data?.user?.role === 'MEMBER');
  const memberAudit = await call('GET', '/api/users/audit', { token: memberToken });
  check('member cannot read the authority-only audit trail (403)', memberAudit.status === 403, `status ${memberAudit.status}`);
  const memberApproveOther = await call('PUT', `/api/users/${envSnap.user_id}/approve`, { token: memberToken });
  check('member cannot approve anyone (403)', memberApproveOther.status === 403, `status ${memberApproveOther.status}`);
  const memberPromote = await call('PUT', `/api/users/${envSnap.user_id}/promote-admin`, { token: memberToken });
  check('member cannot grant roles (403)', memberPromote.status === 403, `status ${memberPromote.status}`);
  const authorityAudit = await call('GET', '/api/users/audit', { token: authorityToken });
  check('authority CAN read the audit trail (intended privilege)', authorityAudit.status === 200, `status ${authorityAudit.status}`);

  // ─────────────────────────────────────────────────────────────
  section('7) Real script: npm run authority:set-password recovery');
  const testSnapBefore = await authoritySnapshot(TEST_AUTHORITY_EMAIL);
  const recovery = runScript('db/setAuthorityPassword.js', {
    AUTHORITY_EMAIL: TEST_AUTHORITY_EMAIL,
    AUTHORITY_PASSWORD: TEST_AUTHORITY_PASSWORD,
  });
  const testSnapAfter = await authoritySnapshot(TEST_AUTHORITY_EMAIL);
  check('set-password exits 0 for an AUTHORITY account', recovery.code === 0, recovery.out.trim().split('\n').slice(-3).join(' | '));
  check('recovery re-hashed the SAME password (old sessions dead via token_version)',
    testSnapAfter.password_hash !== testSnapBefore.password_hash
    && Number(testSnapAfter.token_version) === Number(testSnapBefore.token_version) + 1
    && await bcrypt.compare(TEST_AUTHORITY_PASSWORD, testSnapAfter.password_hash));
  check('recovery kept role AUTHORITY + approved status',
    testSnapAfter.role_name === 'AUTHORITY' && testSnapAfter.status === 'approved');
  check('set-password never prints the password', !recovery.out.includes(TEST_AUTHORITY_PASSWORD) && !recovery.out.includes(ENV_PASSWORD));
  check('still exactly one account after recovery run', await authorityRowCount(TEST_AUTHORITY_EMAIL) === 1);

  const recoveryConflict = runScript('db/setAuthorityPassword.js', {
    AUTHORITY_EMAIL: CONFLICT_EMAIL,
    AUTHORITY_PASSWORD: TEST_AUTHORITY_PASSWORD,
  });
  const conflictSnap3 = await authoritySnapshot(CONFLICT_EMAIL);
  check('set-password REFUSES a non-authority account (exit 1)', recoveryConflict.code === 1, `code ${recoveryConflict.code}`);
  check('refused account untouched (password/role/status unchanged)',
    conflictSnap3.password_hash === conflictSnap0.password_hash
    && conflictSnap3.role_name === 'VISITOR' && conflictSnap3.status === 'pending');

  // ─────────────────────────────────────────────────────────────
  section('8) Summary');
  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('  Failures:');
    for (const f of failures) console.log(`   - ${f}`);
  }
}

main()
  .catch((err) => {
    console.error('\nSUITE ERROR:', err);
    failed++;
  })
  .finally(async () => {
    await cleanup();
    try { await pool.end(); } catch { /* ignore */ }
    process.exit(failed ? 1 : 0);
  });
