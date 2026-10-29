/**
 * eventRegViewerTest.js — Event Management → "View Registrations".
 *
 * Covers the new GET /api/events/:id/registrations endpoint:
 *   A) Authorization matrix — anonymous/bogus token 401, MEMBER and VISITOR
 *      403, ADMIN and AUTHORITY 200 (the endpoint's whole purpose).
 *   B) Data correctness — one event's list contains ONLY that event's
 *      registrants, total matches event_registrations / registration_count,
 *      empty events report 0, missing optional profile fields come back null
 *      instead of dropping the row, no auth material in the payload.
 *   C) Inputs — non-numeric id 400, unknown id 404.
 *   D) Regressions — member registration, duplicate registration (409),
 *      cancellation, My Registrations, event list/get/create still work.
 *
 * Requires: local embedded PostgreSQL running (node tests/pgServer.js) with
 * backend/.env pointing at it. NEVER runs against a remote DB (pgTestClient
 * guard). Fixtures are prefixed `evreg.` / `EVRG-` and deleted afterwards.
 *
 * Usage: cd backend && node tests/eventRegViewerTest.js   (npm run event-reg-test)
 */
import 'dotenv/config';
import http from 'node:http';
import bcrypt from 'bcryptjs';

const stamp = Date.now();
const EMAIL = (tag) => `evreg.${tag}.${stamp}@example.com`;
const PASSWORD = 'EvReg1!pass';
const TITLE = { a: `EVRG-${stamp}-PICNIC`, b: `EVRG-${stamp}-REUNION`, c: `EVRG-${stamp}-EMPTY` };

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

  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${server.address().port}`;

  async function call(method, p, body, token) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${BASE}${p}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON fine */ }
    return { status: res.status, json, message: json?.message || '' };
  }

  let conn;
  try {
    conn = await openTestDb();

    // ── Fixtures: one ADMIN, one AUTHORITY, one MEMBER, one VISITOR ────────
    section('Setup: fixtures (roles/users/events)');
    await conn.query(
      `INSERT INTO roles (role_name, description) VALUES
         ('VISITOR','x'),('MEMBER','x'),('ADMIN','x'),('AUTHORITY','x')
       ON CONFLICT DO NOTHING`
    );
    const hash = await bcrypt.hash(PASSWORD, 10);
    const mkUser = async (tag, role, phone) => {
      const [res] = await conn.query(
        `INSERT INTO users (role_id, first_name, last_name, email, password_hash, phone, status, is_active, token_version)
         SELECT role_id, ?, 'Viewer', ?, ?, ?, 'approved', 1, 0
           FROM roles WHERE role_name = ? RETURNING user_id`,
        [tag, EMAIL(tag), hash, phone ?? null, role]
      );
      return Number(res.insertId);
    };
    const ids = {
      admin: await mkUser('admin', 'ADMIN', '01700000001'),
      authority: await mkUser('authority', 'AUTHORITY', '01700000002'),
      m1: await mkUser('m1', 'MEMBER', '01711111111'),
      m2: await mkUser('m2', 'MEMBER', '01722222222'),
      m3: await mkUser('m3', 'MEMBER', null),
      visitor: await mkUser('visitor', 'VISITOR', null),
    };
    check('fixtures created', Object.values(ids).every((n) => n > 0), JSON.stringify(ids));

    // m1/m3 have profile rows (ssc_batch); m2 deliberately has NONE so the
    // LEFT JOIN / missing-optional-field rendering is exercised.
    await conn.query(
      `INSERT INTO profiles (user_id, ssc_batch) SELECT user_id, 2010 FROM users WHERE email = ?`,
      [EMAIL('m1')]
    );
    await conn.query(
      `INSERT INTO profiles (user_id, ssc_batch) SELECT user_id, 2005 FROM users WHERE email = ?`,
      [EMAIL('m3')]
    );

    const tok = {};
    for (const tag of ['admin', 'authority', 'm1', 'm2', 'm3', 'visitor']) {
      const r = await call('POST', '/api/auth/login', { email: EMAIL(tag), password: PASSWORD });
      tok[tag] = r.json?.data?.token || null;
      check(`login as ${tag} issues a token`, Boolean(tok[tag]), `status ${r.status} ${r.message}`);
    }

    // Events: A (picnic) gets m1+m2, B (reunion) gets m3, C stays empty.
    const mkEvent = async (title) => {
      const r = await call('POST', '/api/events', { title, event_date: '2026-12-05', capacity: 50, location: 'School Ground' }, tok.admin);
      check(`admin creates event "${title}"`, r.status === 201, `status ${r.status} ${r.message}`);
      return r.json?.data?.event_id;
    };
    const evA = await mkEvent(TITLE.a);
    const evB = await mkEvent(TITLE.b);
    const evC = await mkEvent(TITLE.c);

    const reg = (token, id) => call('POST', `/api/events/${id}/register`, {}, token);
    check('m1 registers for event A', (await reg(tok.m1, evA)).status === 201);
    check('m2 registers for event A', (await reg(tok.m2, evA)).status === 201);
    check('m3 registers for event B', (await reg(tok.m3, evB)).status === 201);

    // ── A) Authorization matrix ────────────────────────────────────────────
    section('A) Authorization on GET /api/events/:id/registrations');
    const url = (id) => `/api/events/${id}/registrations`;

    const anon = await call('GET', url(evA));
    check('anonymous → 401', anon.status === 401, `status ${anon.status}`);
    const bogus = await call('GET', url(evA), null, 'not.a.real.token');
    check('bogus token → 401', bogus.status === 401, `status ${bogus.status}`);
    const member = await call('GET', url(evA), null, tok.m1);
    check('MEMBER → 403', member.status === 403, `status ${member.status} ${member.message}`);
    const visitor = await call('GET', url(evA), null, tok.visitor);
    check('VISITOR → 403', visitor.status === 403, `status ${visitor.status} ${visitor.message}`);
    const adminGet = await call('GET', url(evA), null, tok.admin);
    check('ADMIN → 200', adminGet.status === 200, `status ${adminGet.status} ${adminGet.message}`);
    const authGet = await call('GET', url(evA), null, tok.authority);
    check('AUTHORITY → 200', authGet.status === 200, `status ${authGet.status} ${authGet.message}`);

    // ── B) Data correctness ────────────────────────────────────────────────
    section('B) Per-event data correctness');
    const listA = adminGet.json?.data;
    check('event A total = 2', listA?.total === 2, `got ${listA?.total}`);
    const emailsInA = new Set((listA?.registrations || []).map((r) => r.first_name));
    check('event A contains m1 and m2, NOT m3',
      emailsInA.has('m1') && emailsInA.has('m2') && !emailsInA.has('m3'),
      [...emailsInA].join(','));
    check('authority sees the same list as admin',
      JSON.stringify((authGet.json?.data?.registrations || []).map((r) => r.user_id).sort()) ===
      JSON.stringify((listA?.registrations || []).map((r) => r.user_id).sort()));

    const listB = (await call('GET', url(evB), null, tok.admin)).json?.data;
    check('event B total = 1 (registries never mix)', listB?.total === 1, `got ${listB?.total}`);
    check('event B contains only m3',
      listB?.registrations?.length === 1 && listB.registrations[0].first_name === 'm3',
      JSON.stringify(listB?.registrations));

    const listC = (await call('GET', url(evC), null, tok.authority)).json?.data;
    check('empty event → total 0 and empty array',
      listC?.total === 0 && Array.isArray(listC?.registrations) && listC.registrations.length === 0,
      JSON.stringify(listC));

    // Totals must equal the DB rows AND the registration_count the UI shows.
    const [[dbA]] = await conn.query(`SELECT COUNT(*)::int AS n FROM event_registrations WHERE event_id = ?`, [evA]);
    check('total matches event_registrations rows', listA?.total === dbA.n, `api=${listA?.total} db=${dbA.n}`);
    const list = (await call('GET', '/api/events', null, tok.admin)).json?.data?.events || [];
    const countA = list.find((e) => e.event_id === evA)?.registration_count;
    const countB = list.find((e) => e.event_id === evB)?.registration_count;
    check('total matches registration_count on the events list', Number(countA) === listA?.total && Number(countB) === listB?.total,
      `list=${countA}/${countB} viewer=${listA?.total}/${listB?.total}`);

    const m1row = (listA?.registrations || []).find((r) => r.first_name === 'm1');
    const m2row = (listA?.registrations || []).find((r) => r.first_name === 'm2');
    check('member WITH profile → ssc_batch 2010', m1row?.ssc_batch === 2010, String(m1row?.ssc_batch));
    check('member WITHOUT profile row still listed, ssc_batch null',
      Boolean(m2row) && m2row.ssc_batch === null, JSON.stringify(m2row));
    check('phone returned for members that have one', m1row?.phone === '01711111111', String(m1row?.phone));
    check('m3 (no phone) lists with phone null', listB?.registrations?.[0]?.phone === null, String(listB?.registrations?.[0]?.phone));
    check('registration date present (YYYY-MM-DD)',
      /^\d{4}-\d{2}-\d{2}/.test(String(m1row?.registered_at)), String(m1row?.registered_at));
    check('required list fields present',
      Boolean(m1row?.registration_id && m1row?.user_id && m1row?.first_name), JSON.stringify(m1row));

    const raw = JSON.stringify(adminGet.json || {});
    check('payload exposes no password_hash', !raw.includes('password_hash') && !raw.includes('$2a$'), raw.slice(0, 200));
    check('payload exposes no token/session fields', !raw.includes('token_version') && !raw.includes('otp'), raw.slice(0, 200));

    // ── C) Inputs ──────────────────────────────────────────────────────────
    section('C) Input validation');
    const badId = await call('GET', url('abc'), null, tok.admin);
    check('non-numeric id → 400', badId.status === 400, `status ${badId.status}`);
    const missing = await call('GET', url(999999999), null, tok.admin);
    check('unknown event id → 404', missing.status === 404, `status ${missing.status} ${missing.message}`);

    // ── D) Regressions ─────────────────────────────────────────────────────
    section('D) Existing behaviour still intact');
    const dup = await reg(tok.m1, evA);
    check('duplicate registration still rejected (409)', dup.status === 409, `status ${dup.status}`);
    check('duplicate did not add a row', (await call('GET', url(evA), null, tok.admin)).json?.data?.total === 2);

    const mineM2 = await call('GET', '/api/events/mine/registrations', null, tok.m2);
    check('My Registrations still lists event A for m2',
      mineM2.status === 200 && (mineM2.json?.data?.registrations || []).some((r) => r.event_id === evA),
      `status ${mineM2.status} ${JSON.stringify(mineM2.json?.data)}`);

    const getOne = await call('GET', `/api/events/${evA}`, null, tok.m1);
    check('GET /api/events/:id still works', getOne.status === 200, `status ${getOne.status}`);
    const unreg = await call('DELETE', `/api/events/${evA}/register`, null, tok.m1);
    check('member cancellation still works (200)', unreg.status === 200, `status ${unreg.status}`);
    const afterCancel = (await call('GET', url(evA), null, tok.authority)).json?.data;
    check('viewer reflects the cancellation (total 1, m1 gone)',
      afterCancel?.total === 1 && !(afterCancel?.registrations || []).some((r) => r.first_name === 'm1'),
      JSON.stringify(afterCancel?.total));

    const cancelEvent = await call('PUT', `/api/events/${evB}/cancel`, {}, tok.admin);
    check('admin can still cancel an event (200)', cancelEvent.status === 200, `status ${cancelEvent.status}`);
    check('cancelled event still lists its registrations',
      (await call('GET', url(evB), null, tok.admin)).json?.data?.total === 1);
  } finally {
    section('Cleanup (own fixtures only)');
    try {
      if (!conn) conn = await openTestDb();
      const [ev] = await conn.query(`DELETE FROM events WHERE title LIKE 'EVRG-%'`);
      const [us] = await conn.query(`DELETE FROM users WHERE email LIKE 'evreg.%'`);
      check('removed own fixtures', (ev.affectedRows ?? 0) >= 3 && (us.affectedRows ?? 0) >= 6,
        `events=${ev.affectedRows} users=${us.affectedRows}`);
    } catch (err) {
      check('cleanup ran', false, err.code || err.message);
    } finally {
      if (conn) await conn.end().catch(() => {});
      server.close();
      const { closePool } = await import('../src/db/pool.js');
      await closePool().catch(() => {});
    }
  }

  console.log(`\neventRegViewerTest: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('Failures:', failures.join(' | '));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('eventRegViewerTest CRASHED:', err);
  process.exit(1);
});
