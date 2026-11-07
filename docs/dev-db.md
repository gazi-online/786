# Local Database Setup & Testing Guide (`docs/dev-db.md`)

This guide outlines how to provision a local PostgreSQL 16 database for WalletSync development and how to run database isolation and RLS tests.

---

## 1. Requirements

- PostgreSQL 16 (via Docker or local installation)
- Node.js 22 & pnpm 9.12.0

---

## 2. Starting Local PostgreSQL via Docker

Run a local PostgreSQL 16 container:

```bash
docker run -d \
  --name walletsync-db \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgrespassword \
  -e POSTGRES_DB=walletsync_dev \
  -p 5432:5432 \
  postgres:16-alpine
```

---

## 3. Provisioning Non-Owner Runtime Role (`walletsync_app`)

WalletSync enforces strict Row Level Security (RLS). The application runtime role **must NOT** be the table owner and **must NOT** have `BYPASSRLS`.

Execute the following SQL as superuser (`postgres`):

```sql
-- 1. Create runtime role without BYPASSRLS
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'walletsync_app') THEN
    CREATE ROLE walletsync_app WITH LOGIN PASSWORD 'app_password' NOBYPASSRLS;
  END IF;
END
$$;

-- 2. Grant connection and permissions
GRANT CONNECT ON DATABASE walletsync_dev TO walletsync_app;
GRANT USAGE ON SCHEMA public TO walletsync_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO walletsync_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO walletsync_app;
```

---

## 4. Applying Migrations (`pnpm db:migrate`)

Run migrations as the table owner (`postgres`):

```bash
DATABASE_OWNER_URL="postgres://postgres:postgrespassword@localhost:5432/walletsync_dev" pnpm db:migrate
```

This applies:
1. `0000_auth_shim.sql`: Test shim for Supabase `auth.uid()` in vanilla Postgres.
2. `0000_schema.sql`: Core tables, enums, and foreign keys.
3. `0001_rls.sql`: `FORCE ROW LEVEL SECURITY` and tenant isolation policies on all 7 tenant tables.

---

## 5. Running Database Isolation Tests (`pnpm test:db` / `pnpm test`)

> [!CAUTION]
> **Production Safety Guard:** All DB-backed tests (`isolation.test.ts`, `role-permissions.test.ts`, `pairing-security.test.ts`, `device-revocation.test.ts`, `recharge-orders.test.ts`) strictly read `TEST_DATABASE_URL` and ignore `DATABASE_URL`.
> If `TEST_DATABASE_URL` is identical to `DATABASE_URL`, tests abort immediately with a fatal safety breach error to prevent test data from ever polluting production.

To run tests against a local throwaway database or a disposable Neon branch:

```bash
# 1. Set TEST_DATABASE_URL pointing to your dedicated test/throwaway database
export TEST_DATABASE_URL="postgres://walletsync_app:app_password@localhost:5432/walletsync_dev"

# 2. Run test suite
pnpm --filter @walletsync/web test
```

If `TEST_DATABASE_URL` is omitted, all DB-backed live tests automatically skip without failing the test suite.

