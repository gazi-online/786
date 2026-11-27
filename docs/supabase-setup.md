# Supabase Production & Staging Setup Guide

This document describes the exact steps to configure WalletSync against a live Supabase project, along with verification checks that must be executed directly against your live instance.

---

## 1. Environment Configuration

Set the following environment variables in your deployment environment (Vercel / Railway / Docker / `.env.production`):

| Variable | Description | Source in Supabase Dashboard |
| :--- | :--- | :--- |
| `DATABASE_URL` | Runtime non-owner connection string (`walletsync_app` role) | Database > Connection string |
| `DATABASE_OWNER_URL` | Migration owner connection string (`postgres` role) | Database > Connection string |
| `SUPABASE_JWT_SECRET` | Secret used to verify HS256 JWT signatures | Project Settings > API > JWT Secret |
| `NEXT_PUBLIC_SUPABASE_URL` | Public project URL for Supabase client | Project Settings > API > Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anonymous key for client auth | Project Settings > API > anon / public |
| `SUPABASE_AUTH_ISSUER` | Expected JWT issuer | `https://<project-ref>.supabase.co/auth/v1` |
| `SUPABASE_AUTH_AUDIENCE` | Expected JWT audience | `authenticated` |
| `SUPABASE_AUTH_COOKIE_NAME` | Session cookie base name | `sb-<project-ref>-auth-token` |

---

## 2. Checks to Run on Your Live Supabase Instance

Because live database attributes and network configurations depend on project-specific Supabase tier settings, run these SQL verification checks in the Supabase SQL Editor:

### Check 1: Verify `postgres` Role Privileges (`BYPASSRLS`)
Execute:
```sql
SELECT rolname, rolsuper, rolbypassrls 
FROM pg_roles 
WHERE rolname IN ('postgres', 'walletsync_app');
```
- **Expected:**
  - `postgres` should have `rolbypassrls = true` (enables `SECURITY DEFINER` functions like `create_tenant_and_owner` and `delete_tenant` to provision/delete tenants atomically).
  - `walletsync_app` must have `rolbypassrls = false` (enforces strict Row Level Security).

### Check 2: Verify Supavisor Connection Pooler Username Format
When connecting via the Supabase Transaction Pooler (port `6543`), check whether your pooler requires the project reference suffix:
- Direct connection (port `5432`): `postgres://walletsync_app:<password>@db.<ref>.supabase.co:5432/postgres`
- Transaction pooler (port `6543`): `postgres://walletsync_app.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require`

Confirm your pooler resolves the username format `<role>.<project-ref>`.

### Check 3: Verify JWT Signing Method
In **Supabase Dashboard > Project Settings > API > JWT Settings**:
- Determine if your project signs tokens using symmetric **HS256** (standard secret) or **RS256** (asymmetric JWKS).
- If HS256: copy the secret to `SUPABASE_JWT_SECRET`.
- If RS256: configure `SUPABASE_JWKS_URL` to point to `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`.

---

## 3. Database Migration Sequence

Apply migrations in this exact order using `DATABASE_OWNER_URL` (`psql -v ON_ERROR_STOP=1 -X`):

1. **Auth Shim:**
   ```bash
   psql "$DATABASE_OWNER_URL" -f apps/web/drizzle/0000_auth_shim.sql
   ```
2. **Create Runtime App Role:**
   ```sql
   DO $$
   BEGIN
     IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'walletsync_app') THEN
       CREATE ROLE walletsync_app WITH LOGIN PASSWORD 'your_secure_password' NOBYPASSRLS;
     END IF;
   END
   $$;
   GRANT CONNECT ON DATABASE postgres TO walletsync_app;
   GRANT USAGE ON SCHEMA public TO walletsync_app;
   ```
3. **Schema Migration:**
   ```bash
   psql "$DATABASE_OWNER_URL" -f apps/web/drizzle/0000_schema.sql
   ```
4. **RLS & Security Policies Migration:**
   ```bash
   psql "$DATABASE_OWNER_URL" -f apps/web/drizzle/0001_rls.sql
   ```
5. **Grant Runtime Privileges:**
   ```sql
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO walletsync_app;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO walletsync_app;
   ```

