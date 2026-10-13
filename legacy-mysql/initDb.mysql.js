import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { env, rootDir } from '../config/env.js';

/**
 * Idempotent database initializer:
 *  1. Connect WITHOUT a database, create the database if missing.
 *  2. Run database/schema.sql (CREATE TABLE IF NOT EXISTS + role seed).
 *  3. Seed the AUTHORITY account from env (never duplicates, never prints password).
 * Safe to run multiple times.
 */
async function main() {
  const conn = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true,
  });

  try {
    console.log('[init-db] Ensuring database exists...');
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await conn.query(`USE \`${env.db.database}\``);

    console.log('[init-db] Applying schema (database/schema.sql)...');
    const schemaPath = path.join(rootDir, '..', 'database', 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await conn.query(schemaSql);
    console.log('[init-db] Schema applied (idempotent).');

    // ----- Idempotent column migrations for databases created before schema.sql gained new columns -----
    // CREATE TABLE IF NOT EXISTS cannot add columns to an existing table, so we check
    // INFORMATION_SCHEMA and ALTER only when the column is missing. Safe to re-run.
    const [fbCol] = await conn.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'profiles' AND COLUMN_NAME = 'facebook_url' LIMIT 1`,
      [env.db.database]
    );
    if (!fbCol.length) {
      await conn.query("ALTER TABLE profiles ADD COLUMN facebook_url VARCHAR(255) NULL AFTER bio");
      console.log('[init-db] Added profiles.facebook_url column.');
    }

    // profiles.active_donor (Active Blood Donor opt-in, task addendum).
    const [donorCol] = await conn.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'profiles' AND COLUMN_NAME = 'active_donor' LIMIT 1`,
      [env.db.database]
    );
    if (!donorCol.length) {
      await conn.query("ALTER TABLE profiles ADD COLUMN active_donor BOOLEAN NOT NULL DEFAULT FALSE AFTER facebook_url");
      console.log('[init-db] Added profiles.active_donor column.');
    }

    // UNIQUE index on users.registration_number (needed by the payment system's
    // member lookup). Skipped when present; a duplicate-data failure is reported
    // but never crashes seeding.
    const [regIdx] = await conn.query(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND INDEX_NAME = 'uq_users_registration' LIMIT 1`,
      [env.db.database]
    );
    if (!regIdx.length) {
      try {
        await conn.query("ALTER TABLE users ADD UNIQUE KEY uq_users_registration (registration_number)");
        console.log('[init-db] Added UNIQUE index on users.registration_number.');
      } catch (err) {
        console.warn(`[init-db] WARNING: could not add UNIQUE registration_number index (${err.code || err.message}).`);
        console.warn('[init-db] Fix duplicate registration numbers in the users table, then re-run npm run init-db.');
      }
    }

    // password_resets.attempts (failed-OTP counter for the reset flow's attempt cap).
    const [prAtt] = await conn.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'password_resets' AND COLUMN_NAME = 'attempts' LIMIT 1`,
      [env.db.database]
    );
    if (!prAtt.length) {
      await conn.query("ALTER TABLE password_resets ADD COLUMN attempts INT NOT NULL DEFAULT 0 AFTER used_at");
      console.log('[init-db] Added password_resets.attempts column.');
    }

    // ----- Manual payment upgrade (bKash / Nagad / Rocket) -----
    // payment_method must accept the manual providers (was ENUM('test') only).
    const [pmCol] = await conn.query(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'payment_method' LIMIT 1`,
      [env.db.database]
    );
    if (pmCol.length && !/bkash/.test(pmCol[0].COLUMN_TYPE)) {
      await conn.query("ALTER TABLE payments MODIFY COLUMN payment_method ENUM('test','bkash','nagad','rocket') NOT NULL DEFAULT 'test'");
      console.log('[init-db] payments.payment_method now supports bkash/nagad/rocket.');
    }

    // status must include 'rejected' (manual payments rejected by admin/authority).
    const [payStatusCol] = await conn.query(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'status' LIMIT 1`,
      [env.db.database]
    );
    if (payStatusCol.length && !/rejected/.test(payStatusCol[0].COLUMN_TYPE)) {
      await conn.query("ALTER TABLE payments MODIFY COLUMN status ENUM('pending','success','failed','cancelled','refunded','rejected') NOT NULL DEFAULT 'pending'");
      console.log('[init-db] payments.status now includes rejected.');
    }

    // New columns: billing_month, screenshot_path, review_note, reviewed_by, reviewed_at.
    const addPayCol = async (name, ddl) => {
      const [col] = await conn.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'payments' AND COLUMN_NAME = ? LIMIT 1`,
        [env.db.database, name]
      );
      if (!col.length) {
        await conn.query(`ALTER TABLE payments ADD COLUMN ${ddl}`);
        console.log(`[init-db] Added payments.${name} column.`);
      }
    };
    await addPayCol('billing_month', "billing_month CHAR(7) NULL AFTER payment_date");
    await addPayCol('screenshot_path', "screenshot_path VARCHAR(255) NULL AFTER billing_month");
    await addPayCol('review_note', "review_note VARCHAR(255) NULL AFTER description");
    await addPayCol('reviewed_by', "reviewed_by BIGINT UNSIGNED NULL AFTER review_note");
    await addPayCol('reviewed_at', "reviewed_at DATETIME NULL AFTER reviewed_by");

    // Index + FK for the reviewer (safe to re-run; failures reported, never fatal).
    const [bmIdx] = await conn.query(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'payments' AND INDEX_NAME = 'idx_payments_billing_month' LIMIT 1`,
      [env.db.database]
    );
    if (!bmIdx.length) {
      await conn.query("ALTER TABLE payments ADD KEY idx_payments_billing_month (billing_month)");
      console.log('[init-db] Added payments.billing_month index.');
    }
    const [revFk] = await conn.query(
      `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'payments' AND CONSTRAINT_NAME = 'fk_payments_reviewer' LIMIT 1`,
      [env.db.database]
    );
    if (!revFk.length) {
      try {
        await conn.query("ALTER TABLE payments ADD CONSTRAINT fk_payments_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE");
        console.log('[init-db] Added payments.reviewed_by FK.');
      } catch (err) {
        console.warn(`[init-db] WARNING: could not add fk_payments_reviewer (${err.code || err.message}).`);
      }
    }

    // ----- Notification system upgrade (YouTube-style centralized notifications) -----
    // type ENUM must accept the centralized notification types.
    const notifTypeCol = await conn.query(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'type' LIMIT 1`,
      [env.db.database]
    );
    if (notifTypeCol[0].length && !/new_notice/.test(notifTypeCol[0][0].COLUMN_TYPE)) {
      await conn.query(`ALTER TABLE notifications MODIFY COLUMN type ENUM(
        'approval','job','application','event','notice','promotion','demotion','system',
        'new_notice','new_job','new_event','new_vision','new_help','new_poll',
        'registration_pending','registration_approved','registration_rejected',
        'payment_pending','payment_approved','payment_rejected',
        'job_pending','job_approved','job_rejected',
        'vision_pending','vision_approved','vision_rejected','vision_implemented',
        'help_status',
        'gallery_pending','gallery_approved','gallery_rejected'
      ) NOT NULL DEFAULT 'system'`);
      console.log('[init-db] notifications.type now supports centralized notification types.');
    }

    // New columns: related_entity_type/id, actor_user_id, read_at.
    const addNotifCol = async (name, ddl) => {
      const [col] = await conn.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'notifications' AND COLUMN_NAME = ? LIMIT 1`,
        [env.db.database, name]
      );
      if (!col.length) {
        await conn.query(`ALTER TABLE notifications ADD COLUMN ${ddl}`);
        console.log(`[init-db] Added notifications.${name} column.`);
      }
    };
    await addNotifCol('related_entity_type', "related_entity_type VARCHAR(30) NULL AFTER type");
    await addNotifCol('related_entity_id', "related_entity_id BIGINT UNSIGNED NULL AFTER related_entity_type");
    await addNotifCol('actor_user_id', "actor_user_id BIGINT UNSIGNED NULL AFTER related_entity_id");
    await addNotifCol('read_at', "read_at DATETIME NULL AFTER is_read");

    // Composite index for paginated listing (recipient + newest first) and the
    // duplicate-suppression lookup (same type+entity recently created).
    const notifIdx = async (indexName) => {
      const [idx] = await conn.query(
        `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'notifications' AND INDEX_NAME = ? LIMIT 1`,
        [env.db.database, indexName]
      );
      return idx.length;
    };
    if (!(await notifIdx('idx_notif_recipient_created'))) {
      await conn.query("ALTER TABLE notifications ADD KEY idx_notif_recipient_created (recipient_id, created_at)");
      console.log('[init-db] Added notifications.idx_notif_recipient_created index.');
    }
    if (!(await notifIdx('idx_notif_dedupe'))) {
      await conn.query("ALTER TABLE notifications ADD KEY idx_notif_dedupe (type, related_entity_type, related_entity_id, created_at)");
      console.log('[init-db] Added notifications.idx_notif_dedupe index.');
    }

    // FK for the actor (safe to re-run; failures reported, never fatal).
    const [notifActorFk] = await conn.query(
      `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'notifications' AND CONSTRAINT_NAME = 'fk_notif_actor' LIMIT 1`,
      [env.db.database]
    );
    if (!notifActorFk.length) {
      try {
        await conn.query("ALTER TABLE notifications ADD CONSTRAINT fk_notif_actor FOREIGN KEY (actor_user_id) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE");
        console.log('[init-db] Added notifications.actor_user_id FK.');
      } catch (err) {
        console.warn(`[init-db] WARNING: could not add fk_notif_actor (${err.code || err.message}).`);
      }
    }

    // ----- Help requests: blood category + emergency urgency + blood fields -----
    // category must accept 'blood' (blood requests are a specialized help request).
    const helpCatCol = await conn.query(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'help_requests' AND COLUMN_NAME = 'category' LIMIT 1`,
      [env.db.database]
    );
    if (helpCatCol[0].length && !/'blood'/.test(helpCatCol[0][0].COLUMN_TYPE)) {
      await conn.query("ALTER TABLE help_requests MODIFY COLUMN category ENUM('career','education','medical','financial','blood','other') NOT NULL DEFAULT 'other'");
      console.log('[init-db] help_requests.category now supports blood.');
    }
    // urgency must accept 'emergency'.
    const helpUrgCol = await conn.query(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'help_requests' AND COLUMN_NAME = 'urgency' LIMIT 1`,
      [env.db.database]
    );
    if (helpUrgCol[0].length && !/emergency/.test(helpUrgCol[0][0].COLUMN_TYPE)) {
      await conn.query("ALTER TABLE help_requests MODIFY COLUMN urgency ENUM('low','medium','high','emergency') NOT NULL DEFAULT 'medium'");
      console.log('[init-db] help_requests.urgency now supports emergency.');
    }
    // Blood-specific columns (populated only when category='blood').
    const addHelpCol = async (name, ddl) => {
      const [col] = await conn.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'help_requests' AND COLUMN_NAME = ? LIMIT 1`,
        [env.db.database, name]
      );
      if (!col.length) {
        await conn.query(`ALTER TABLE help_requests ADD COLUMN ${ddl}`);
        console.log(`[init-db] Added help_requests.${name} column.`);
      }
    };
    await addHelpCol('blood_group', "blood_group ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NULL AFTER urgency");
    await addHelpCol('location', "location VARCHAR(255) NULL AFTER blood_group");
    await addHelpCol('required_date', "required_date DATE NULL AFTER location");

    // ----- Authority seed -----
    if (!env.authorityEmail || !env.authorityPassword) {
      throw new Error('AUTHORITY_EMAIL / AUTHORITY_PASSWORD missing in .env');
    }
    const email = env.authorityEmail.trim().toLowerCase();
    const [roles] = await conn.query(
      "SELECT role_id FROM roles WHERE role_name = 'AUTHORITY' LIMIT 1"
    );
    if (!roles.length) throw new Error('AUTHORITY role missing — schema seed failed');
    const authorityRoleId = roles[0].role_id;

    const [existing] = await conn.query(
      'SELECT user_id FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    if (existing.length) {
      // Idempotent: keep single Authority account, align role/status only.
      await conn.query(
        "UPDATE users SET role_id = ?, status = 'approved', is_active = 1 WHERE user_id = ? AND role_id <> ?",
        [authorityRoleId, existing[0].user_id, authorityRoleId]
      );
      console.log('[init-db] Authority account already exists — no duplicate created.');
    } else {
      const hash = await bcrypt.hash(env.authorityPassword, 12);
      const [res] = await conn.query(
        `INSERT INTO users (role_id, first_name, last_name, email, password_hash, status, is_active)
         VALUES (?, 'Authority', 'System', ?, ?, 'approved', 1)`,
        [authorityRoleId, email, hash]
      );
      await conn.query(
        `INSERT INTO profiles (user_id, bio) VALUES (?, 'System authority account')`,
        [res.insertId]
      );
      console.log(`[init-db] Authority account created for ${email}.`);
    }
    console.log('[init-db] DONE.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('[init-db] FAILED:', err.code || '', err.message);
  process.exit(1);
});
