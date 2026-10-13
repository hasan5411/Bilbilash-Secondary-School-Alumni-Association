-- =====================================================================
-- BILBILASH ALUMNI COMMUNITY MANAGEMENT SYSTEM — MySQL schema
-- Idempotent: safe to run multiple times. No DROP/TRUNCATE of data.
-- Charset: utf8mb4. Engine: InnoDB. snake_case naming.
--
-- NOTE: this file does NOT create or select a database. The target database
-- is whatever DB_NAME is set to in backend/.env — `npm run init-db` creates it
-- and selects it before running these statements.
-- =====================================================================

CREATE TABLE IF NOT EXISTS roles (
  role_id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_name   ENUM('VISITOR','MEMBER','ADMIN','AUTHORITY') NOT NULL,
  description VARCHAR(100) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id),
  UNIQUE KEY uq_roles_name (role_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  user_id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_id        INT UNSIGNED NOT NULL,
  first_name     VARCHAR(60)  NOT NULL,
  last_name      VARCHAR(60)  NOT NULL,
  email          VARCHAR(120) NOT NULL,
  password_hash  VARCHAR(100) NOT NULL,
  phone          VARCHAR(20)  NULL,
  registration_number VARCHAR(50) NULL,
  status         ENUM('pending','approved','rejected','inactive') NOT NULL DEFAULT 'pending',
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  token_version  INT UNSIGNED NOT NULL DEFAULT 0,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_registration (registration_number),
  KEY idx_users_status (status),
  KEY idx_users_role (role_id),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS profiles (
  profile_id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  ssc_batch     INT UNSIGNED NULL,
  blood_group   ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NULL,
  profession    VARCHAR(120) NULL,
  institute     VARCHAR(120) NULL,
  address       VARCHAR(255) NULL, -- deprecated: superseded by present_address/permanent_address
  present_address VARCHAR(255) NULL,
  permanent_address VARCHAR(255) NULL,
  bio           VARCHAR(500) NULL,
  facebook_url  VARCHAR(255) NULL, -- optional public Facebook profile link
  active_donor  BOOLEAN NOT NULL DEFAULT FALSE, -- member opted in as a blood donor
  contribution_start_month CHAR(7) NULL, -- 'YYYY-MM' first obligated month; NULL = UNKNOWN (never guessed)
  profile_photo VARCHAR(255) NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (profile_id),
  UNIQUE KEY uq_profiles_user (user_id),
  KEY idx_profiles_batch (ssc_batch),
  KEY idx_profiles_blood (blood_group),
  KEY idx_profiles_profession (profession),
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS password_resets (
  reset_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  otp_hash   VARCHAR(100) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at    DATETIME NULL,
  attempts   INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (reset_id),
  KEY idx_pr_user (user_id),
  CONSTRAINT fk_pr_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS jobs (
  job_id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  posted_by        BIGINT UNSIGNED NOT NULL,
  title            VARCHAR(150) NOT NULL,
  company          VARCHAR(120) NOT NULL,
  description      TEXT NOT NULL,
  location         VARCHAR(120) NULL,
  employment_type  ENUM('full-time','part-time','contract','internship','remote') NOT NULL DEFAULT 'full-time',
  salary           VARCHAR(80) NULL,
  application_info VARCHAR(255) NULL,
  deadline         DATE NULL,
  status           ENUM('pending','approved','rejected','closed') NOT NULL DEFAULT 'pending',
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (job_id),
  KEY idx_jobs_status (status),
  KEY idx_jobs_posted_by (posted_by),
  CONSTRAINT fk_jobs_user FOREIGN KEY (posted_by) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS job_applications (
  application_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id         BIGINT UNSIGNED NOT NULL,
  applicant_id   BIGINT UNSIGNED NOT NULL,
  cover_message  VARCHAR(1000) NOT NULL,
  portfolio_url  VARCHAR(255) NULL,
  status         ENUM('submitted','shortlisted','rejected','hired') NOT NULL DEFAULT 'submitted',
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (application_id),
  UNIQUE KEY uq_job_applicant (job_id, applicant_id),
  CONSTRAINT fk_ja_job FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ja_user FOREIGN KEY (applicant_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS visions (
  vision_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  title       VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  category    ENUM('education','welfare','event','infrastructure','other') NOT NULL DEFAULT 'other',
  status      ENUM('pending','approved','rejected','implemented') NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (vision_id),
  KEY idx_visions_status (status),
  CONSTRAINT fk_visions_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS help_requests (
  help_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  title       VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  category    ENUM('career','education','medical','financial','blood','other') NOT NULL DEFAULT 'other',
  urgency     ENUM('low','medium','high','emergency') NOT NULL DEFAULT 'medium',
  blood_group ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NULL, -- only when category='blood'
  location    VARCHAR(255) NULL, -- where help is needed (required for blood requests)
  required_date DATE NULL, -- when the help/blood is needed (required for blood requests)
  status      ENUM('open','in_progress','resolved','closed') NOT NULL DEFAULT 'open',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (help_id),
  KEY idx_help_status (status),
  CONSTRAINT fk_help_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS events (
  event_id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  created_by  BIGINT UNSIGNED NOT NULL,
  title       VARCHAR(150) NOT NULL,
  description TEXT NULL,
  location    VARCHAR(150) NULL,
  event_date  DATE NOT NULL,
  start_time  TIME NULL,
  end_time    TIME NULL,
  capacity    INT UNSIGNED NOT NULL DEFAULT 100,
  image       VARCHAR(255) NULL,
  status      ENUM('draft','published','cancelled','completed') NOT NULL DEFAULT 'published',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id),
  KEY idx_events_date (event_date),
  CONSTRAINT fk_events_user FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS event_registrations (
  registration_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id        BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (registration_id),
  UNIQUE KEY uq_event_user (event_id, user_id),
  CONSTRAINT fk_er_event FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_er_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notices (
  notice_id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  created_by   BIGINT UNSIGNED NOT NULL,
  title        VARCHAR(150) NOT NULL,
  body         TEXT NOT NULL,
  status       ENUM('draft','published','archived') NOT NULL DEFAULT 'published',
  published_at DATETIME NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (notice_id),
  KEY idx_notices_status (status),
  CONSTRAINT fk_notices_user FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  notification_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recipient_id    BIGINT UNSIGNED NOT NULL,
  title           VARCHAR(150) NOT NULL,
  message         VARCHAR(500) NOT NULL,
  -- Centralized types (backend/src/services/notificationService.js NOTIFICATION_TYPES).
  -- Legacy values kept for historical rows.
  type            ENUM('approval','job','application','event','notice','promotion','demotion','system',
                       'new_notice','new_job','new_event','new_vision','new_help','new_poll',
                       'registration_pending','registration_approved','registration_rejected',
                       'payment_pending','payment_approved','payment_rejected',
                       'job_pending','job_approved','job_rejected',
                       'vision_pending','vision_approved','vision_rejected','vision_implemented',
                       'help_status',
                       'gallery_pending','gallery_approved','gallery_rejected',
                       'contribution_setup','contribution_updated') NOT NULL DEFAULT 'system',
  related_entity_type VARCHAR(30) NULL, -- 'job','event','payment','user',… (reference, never a data copy)
  related_entity_id   BIGINT UNSIGNED NULL,
  actor_user_id       BIGINT UNSIGNED NULL, -- who triggered the notification (nullable)
  is_read         TINYINT(1) NOT NULL DEFAULT 0,
  read_at         DATETIME NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notification_id),
  KEY idx_notif_recipient (recipient_id, is_read),
  KEY idx_notif_recipient_created (recipient_id, created_at),
  KEY idx_notif_dedupe (type, related_entity_type, related_entity_id, created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (recipient_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_notif_actor FOREIGN KEY (actor_user_id) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS polls (
  poll_id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  created_by BIGINT UNSIGNED NOT NULL,
  question   VARCHAR(255) NOT NULL,
  status     ENUM('draft','open','closed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (poll_id),
  CONSTRAINT fk_polls_user FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS poll_options (
  option_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  poll_id     BIGINT UNSIGNED NOT NULL,
  option_text VARCHAR(150) NOT NULL,
  position    INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (option_id),
  KEY idx_po_poll (poll_id),
  CONSTRAINT fk_po_poll FOREIGN KEY (poll_id) REFERENCES polls(poll_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS poll_votes (
  vote_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  poll_id   BIGINT UNSIGNED NOT NULL,
  option_id BIGINT UNSIGNED NOT NULL,
  user_id   BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (vote_id),
  UNIQUE KEY uq_poll_user (poll_id, user_id),
  CONSTRAINT fk_pv_poll FOREIGN KEY (poll_id) REFERENCES polls(poll_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_pv_option FOREIGN KEY (option_id) REFERENCES poll_options(option_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_pv_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS gallery (
  gallery_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uploaded_by  BIGINT UNSIGNED NOT NULL,
  image_path   VARCHAR(255) NOT NULL,
  caption      VARCHAR(200) NULL,
  status       ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  moderated_by BIGINT UNSIGNED NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (gallery_id),
  KEY idx_gallery_status (status),
  CONSTRAINT fk_gallery_user FOREIGN KEY (uploaded_by) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_gallery_mod FOREIGN KEY (moderated_by) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS teachers (
  teacher_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  created_by   BIGINT UNSIGNED NULL,
  name         VARCHAR(120) NOT NULL,
  subject      VARCHAR(120) NULL,
  designation  VARCHAR(120) NULL,
  institution  VARCHAR(150) NULL,
  photo        VARCHAR(255) NULL,
  description  VARCHAR(500) NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (teacher_id),
  CONSTRAINT fk_teachers_user FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id   BIGINT UNSIGNED NULL,
  action     VARCHAR(80) NOT NULL,
  entity     VARCHAR(50) NOT NULL,
  entity_id  BIGINT UNSIGNED NULL,
  details    JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (audit_id),
  KEY idx_audit_actor (actor_id),
  CONSTRAINT fk_audit_user FOREIGN KEY (actor_id) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Payments — provider-agnostic design.
--   'test'   = simulated charge (records instantly, dev/smoke only)
--   'bkash' / 'nagad' / 'rocket' = MANUAL mobile-money payments:
--     member sends money to the association's number, submits the Transaction
--     ID + optional screenshot; the row stays 'pending' until an admin or the
--     authority approves ('success') or rejects it ('rejected').
-- registration_number is NOT the primary key; users.user_id is the anchor.
-- transaction_id is UNIQUE at the DB level — duplicate submissions are
-- impossible even across concurrent requests.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  payment_id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  reg_number      VARCHAR(50) NULL, -- snapshot of users.registration_number at payment time
  payment_type    ENUM('monthly','occasional') NOT NULL,
  purpose         ENUM('event_contribution','donation','help_fund','emergency_fund','other') NULL,
  event_id        BIGINT UNSIGNED NULL,
  amount          DECIMAL(10,2) NOT NULL,
  payment_method  ENUM('test','bkash','nagad','rocket') NOT NULL DEFAULT 'test',
  sender_number   VARCHAR(20) NULL,
  transaction_id  VARCHAR(64) NOT NULL,
  payment_date    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  billing_month   CHAR(7) NULL, -- 'YYYY-MM' billing period for monthly payments (kept separate from payment_date)
  screenshot_path VARCHAR(255) NULL, -- optional uploaded payment screenshot (filename served under /uploads)
  status          ENUM('pending','success','failed','cancelled','refunded','rejected') NOT NULL DEFAULT 'pending',
  description     VARCHAR(255) NULL,
  review_note     VARCHAR(255) NULL, -- admin/authority note written at approval or rejection
  reviewed_by     BIGINT UNSIGNED NULL,
  reviewed_at     DATETIME NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (payment_id),
  UNIQUE KEY uq_payments_txn (transaction_id),
  KEY idx_payments_user (user_id),
  KEY idx_payments_type (payment_type),
  KEY idx_payments_status (status),
  KEY idx_payments_date (payment_date),
  KEY idx_payments_billing_month (billing_month),
  CONSTRAINT fk_payments_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_payments_event FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_payments_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- One row per paid month. UNIQUE(user_id, payment_month) makes duplicate
-- monthly payments for the same member + month impossible at the DB level.
CREATE TABLE IF NOT EXISTS monthly_payment_details (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payment_id      BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  payment_month   CHAR(7) NOT NULL, -- normalized 'YYYY-MM'
  amount          DECIMAL(10,2) NOT NULL, -- actual amount received for this month
  extra_amount    DECIMAL(10,2) NOT NULL DEFAULT 0, -- portion above the month's contribution rate
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- One payment can settle several months (oldest dues first) and a partially
  -- settled month can be topped up by a later payment, so this is a KEY, not a
  -- UNIQUE. Duplicate allocation is prevented by the allocation planner.
  KEY idx_monthly_user_month (user_id, payment_month),
  KEY idx_monthly_payment (payment_id),
  CONSTRAINT fk_mpd_payment FOREIGN KEY (payment_id) REFERENCES payments(payment_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_mpd_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Monthly contribution RATES — append-only history, one row per
-- (member, effective month). A rate governs every month from its
-- effective_month until the next rate's effective_month. Previous rows are
-- never overwritten or deleted, so historic dues keep their historic rates.
--   source='reconciliation' rows are reconstructed by npm run
--   migrate:contributions from amounts members ACTUALLY paid (reported).
-- ---------------------------------------------------------------------
-- ATTRIBUTION RETENTION: set_by points at the account that set the rate.
-- When that account is deleted, ON DELETE SET NULL releases the pointer while
-- the row (and its amount/effective_month) survives untouched; the setter's
-- identity text is captured in set_by_snapshot at deletion time, so history is
-- never silently discarded. The rate's OWNER is user_id — never set_by.
-- Existing databases are upgraded by: npm run migrate:set-by
CREATE TABLE IF NOT EXISTS member_monthly_rates (
  rate_id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  amount          DECIMAL(10,2) NOT NULL,
  effective_month CHAR(7) NOT NULL, -- 'YYYY-MM' — first month this rate applies to
  source          ENUM('member','admin','reconciliation') NOT NULL DEFAULT 'member',
  set_by          BIGINT UNSIGNED NULL, -- setter's account; NULL once that account is deleted
  set_by_snapshot VARCHAR(160) NULL,   -- 'Name <email> (user_id N)' of the setter, kept when the account is deleted
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (rate_id),
  UNIQUE KEY uq_mmr_user_effective (user_id, effective_month),
  KEY idx_mmr_user (user_id, effective_month),
  KEY idx_mmr_setby (set_by),
  CONSTRAINT fk_mmr_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_mmr_setby FOREIGN KEY (set_by) REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Seed: fixed roles
-- ---------------------------------------------------------------------
INSERT INTO roles (role_name, description) VALUES
  ('VISITOR',  'Registered user awaiting approval'),
  ('MEMBER',   'Approved alumni member'),
  ('ADMIN',    'Community administrator (max 3)'),
  ('AUTHORITY','Highest system authority (seeded account)')
ON DUPLICATE KEY UPDATE description = VALUES(description);
