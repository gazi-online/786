-- Migration: 0001_rls.sql
-- Enables Row Level Security on all tenant-isolated tables
-- Adheres to Requirements (Step 7 & 9):
-- 1. App runtime DB role MUST NOT be the table owner and has NO BYPASSRLS.
-- 2. Use FORCE ROW LEVEL SECURITY on EVERY tenant table.
-- 3. Set context with set_config('app.current_tenant_id', $1, true) inside the transaction, parameterized,
--    never string-interpolated, fully compatible with a transaction pooler.
-- 4. A missing setting returns zero rows.
-- 5. Memberships policy allows a user to resolve their own memberships keyed on user_id before tenant context exists.

-- Enable and FORCE RLS on all tenant tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices FORCE ROW LEVEL SECURITY;

ALTER TABLE pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairing_codes FORCE ROW LEVEL SECURITY;

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions FORCE ROW LEVEL SECURITY;

ALTER TABLE sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_events FORCE ROW LEVEL SECURITY;

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

-- Helper function: Extracts current tenant ID from transaction-local config
CREATE OR REPLACE FUNCTION current_app_tenant_id() RETURNS uuid AS $$
BEGIN
  RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper function to check if current request has tenant access
-- Strict: Missing setting or unauthenticated user returns false (zero rows)
CREATE OR REPLACE FUNCTION user_has_tenant_access(check_tenant_id uuid) RETURNS boolean AS $$
BEGIN
  IF check_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  -- 1. If explicitly set via app.current_tenant_id (device-token or server-side tenant context)
  IF current_app_tenant_id() IS NOT NULL THEN
    RETURN current_app_tenant_id() = check_tenant_id;
  END IF;

  -- 2. If authenticated user via Supabase auth.uid()
  IF auth.uid() IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.tenant_id = check_tenant_id
        AND memberships.user_id = auth.uid()
    );
  END IF;

  -- Missing context returns zero rows
  RETURN false;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 1. tenants policies
CREATE POLICY tenant_isolation_policy ON tenants
  FOR ALL
  USING (user_has_tenant_access(id))
  WITH CHECK (user_has_tenant_access(id));

-- 2. memberships policies:
-- Users can ALWAYS select their own memberships keyed on user_id (before tenant context exists)
CREATE POLICY memberships_user_resolve_policy ON memberships
  FOR SELECT
  USING (auth.uid() IS NOT NULL AND memberships.user_id = auth.uid());

-- Tenant-scoped policy for managing memberships
CREATE POLICY memberships_tenant_isolation_policy ON memberships
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
