-- Migration: 0001_rls.sql
-- Enables Row Level Security on all tenant-isolated tables
-- Adheres to Amd-1:
-- 1. App runtime DB role MUST NOT have BYPASSRLS.
-- 2. User-session queries match auth.uid() via memberships.
-- 3. Device-token routes (e.g. /ingest, /devices/pair) set `SET LOCAL app.current_tenant_id = '<uuid>';`
--    and the policy matches current_setting('app.current_tenant_id', true)::uuid.

-- Enable RLS on all tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Helper function to check if current request has tenant access
-- Checks either:
-- 1. app.current_tenant_id is set (used by device-token authenticated endpoints)
-- 2. User has an active membership in the tenant (used by web app session queries)
CREATE OR REPLACE FUNCTION current_app_tenant_id() RETURNS uuid AS $$
BEGIN
  RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION user_has_tenant_access(check_tenant_id uuid) RETURNS boolean AS $$
BEGIN
  -- If explicitly set via app.current_tenant_id
  IF current_app_tenant_id() IS NOT NULL AND current_app_tenant_id() = check_tenant_id THEN
    RETURN true;
  END IF;

  -- If authenticated user via Supabase auth.uid()
  IF auth.uid() IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.tenant_id = check_tenant_id
        AND memberships.user_id = auth.uid()
    );
  END IF;

  RETURN false;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 1. tenants policies
CREATE POLICY tenant_isolation_policy ON tenants
  FOR ALL
  USING (user_has_tenant_access(id))
  WITH CHECK (user_has_tenant_access(id));

-- 2. memberships policies
CREATE POLICY memberships_isolation_policy ON memberships
  FOR ALL
  USING (user_has_tenant_access(tenant_id))
  WITH CHECK (user_has_tenant_access(tenant_id));

-- 3. devices policies
CREATE POLICY devices_isolation_policy ON devices
  FOR ALL
  USING (user_has_tenant_access(tenant_id))
  WITH CHECK (user_has_tenant_access(tenant_id));

-- 4. pairing_codes policies
CREATE POLICY pairing_codes_isolation_policy ON pairing_codes
  FOR ALL
  USING (user_has_tenant_access(tenant_id))
  WITH CHECK (user_has_tenant_access(tenant_id));

-- 5. transactions policies
CREATE POLICY transactions_isolation_policy ON transactions
  FOR ALL
  USING (user_has_tenant_access(tenant_id))
  WITH CHECK (user_has_tenant_access(tenant_id));

-- 6. sync_events policies
CREATE POLICY sync_events_isolation_policy ON sync_events
  FOR ALL
  USING (user_has_tenant_access(tenant_id))
  WITH CHECK (user_has_tenant_access(tenant_id));

-- 7. audit_log policies
CREATE POLICY audit_log_isolation_policy ON audit_log
  FOR ALL
  USING (user_has_tenant_access(tenant_id))
  WITH CHECK (user_has_tenant_access(tenant_id));

