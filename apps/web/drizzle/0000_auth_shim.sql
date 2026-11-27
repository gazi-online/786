-- Test shim for Supabase auth schema and auth.uid() in plain PostgreSQL (CI & local test environments)
-- Supabase provides this schema natively; on vanilla Postgres (e.g. postgres:16-alpine in CI),
-- this shim enables auth.uid() references in RLS policies without errors.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
BEGIN
  RETURN NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

