# legacy-mysql — original MySQL implementation (reference only)

The application was migrated from **MySQL (`mysql2`)** to **PostgreSQL (`pg`)** for
Supabase. Per the migration discipline ("do not remove the original MySQL
schema or migration files until the migration is verified"), the original
driver-layer files are preserved here verbatim, unmodified:

| File here | Original location | What it was |
|---|---|---|
| `pool.mysql.js` | `backend/src/db/pool.js` | mysql2 pool (`dateStrings:true`, `?` placeholders, tuple results) |
| `env.mysql.js` | `backend/src/config/env.js` | config loader (MySQL `DB_*`, `dotenv` override:true) |
| `errorHandler.mysql.js` | `backend/src/middleware/errorHandler.js` | error mapping for MySQL codes (`ER_DUP_ENTRY`, errno 1451…) |
| `initDb.mysql.js` | `backend/src/db/initDb.js` | MySQL initializer + historical ALTER upgrade path |

Also still authoritative elsewhere (not copies):

- `database/schema.sql` — the original **MySQL** schema (kept for reference and
  for re-creating a local MySQL dev DB if ever needed).
- `database/migrations/*.sql` — MySQL migrations (kept).
- `backend/src/db/migrateContributions.js`, `migrateSetByRetention.js` —
  one-time MySQL→MySQL data-upgrade scripts; they operate on **localhost test
  data that is explicitly disposable**, so they were not ported to PostgreSQL.

**Nothing in the running application imports anything from this folder.** It is
kept only for review and rollback reference. Safe to delete once the
PostgreSQL migration is considered final.
