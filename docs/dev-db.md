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

## 5. Running Database Isolation Tests (`pnpm test:db`)

Configure your runtime connection string in your local shell or `.env.local`:

```bash
DATABASE_URL="postgres://walletsync_app:app_password@localhost:5432/walletsync_dev" pnpm test:db
```

This executes:
- Runtime role `rolbypassrls = false` validation
- Non-ownership verification
- `FORCE ROW LEVEL SECURITY` enforcement on every table
- Unset tenant context returning 0 rows
- Cross-tenant isolation (Tenant A cannot view Tenant B records)
- Direct SQL adhering to RLS
- Rate limiter counter persistence in PostgreSQL

