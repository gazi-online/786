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

-- 8. Atomic tenant creation function for sign-up under FORCE RLS
-- Allows runtime non-owner role to provision exactly one tenant and assign initial ownership
-- Strict: User ID is NOT passed as parameter; it is derived securely from auth.uid()
-- Enforces one-tenant-per-user limit for sign-up path
-- Explicit owner: postgres (holds BYPASSRLS in Supabase / CI)
-- Explicit search_path: public, pg_temp (prevents search_path hijacking)
CREATE OR REPLACE FUNCTION create_tenant_and_owner(
  p_tenant_name text,
  p_plan plan DEFAULT 'free'
) RETURNS TABLE (
  tenant_id uuid,
  tenant_name text,
  membership_id uuid,
  membership_role member_role
) AS $$
DECLARE
  v_user_id uuid;
  v_tenant_id uuid;
  v_membership_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: auth.uid() is null';
  END IF;

  -- One-tenant-per-user rule for sign-up path
  IF EXISTS (
    SELECT 1 FROM memberships WHERE user_id = v_user_id AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'One tenant per user limit reached: user % is already an owner of a tenant', v_user_id;
  END IF;

  -- Insert tenant
  INSERT INTO tenants (name, plan, status, retention_months)
  VALUES (p_tenant_name, p_plan, 'active', 24)
  RETURNING id INTO v_tenant_id;

  -- Insert membership: Creator becomes owner
  INSERT INTO memberships (tenant_id, user_id, role)
  VALUES (v_tenant_id, v_user_id, 'owner')
  RETURNING id INTO v_membership_id;

  RETURN QUERY SELECT v_tenant_id, p_tenant_name, v_membership_id, 'owner'::member_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

ALTER FUNCTION create_tenant_and_owner(text, plan) OWNER TO postgres;
REVOKE ALL ON FUNCTION create_tenant_and_owner(text, plan) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_tenant_and_owner(text, plan) TO walletsync_app;

-- One-tenant-per-user constraint: a user can be owner of at most one tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_unique_owner_per_user 
  ON memberships (user_id) 
  WHERE role = 'owner';

-- 9. Role-based Membership Management Policies, Functions & Triggers
CREATE OR REPLACE FUNCTION is_tenant_owner(check_tenant_id uuid) RETURNS boolean AS $$
BEGIN
  IF auth.uid() IS NULL OR check_tenant_id IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.tenant_id = check_tenant_id
      AND memberships.user_id = auth.uid()
      AND memberships.role = 'owner'
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION is_tenant_admin_or_owner(check_tenant_id uuid) RETURNS boolean AS $$
BEGIN
  IF auth.uid() IS NULL OR check_tenant_id IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.tenant_id = check_tenant_id
      AND memberships.user_id = auth.uid()
      AND memberships.role IN ('owner', 'admin')
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- Trigger: Prevent removing or demoting the last owner of a tenant (while allowing whole-tenant deletion)
CREATE OR REPLACE FUNCTION prevent_last_owner_demotion_or_removal() RETURNS TRIGGER AS $$
DECLARE
  v_remaining_owners integer;
  v_is_deleting_tenant text;
BEGIN
  -- Check if session flag indicates entire tenant deletion
  BEGIN
    v_is_deleting_tenant := current_setting('app.deleting_tenant', true);
  EXCEPTION WHEN OTHERS THEN
    v_is_deleting_tenant := NULL;
  END;

  IF v_is_deleting_tenant = 'true' THEN
    RETURN OLD;
  END IF;

  -- Allow deletion if the parent tenant row is already being deleted
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
      RETURN OLD;
    END IF;
  END IF;

  IF OLD.role = 'owner' AND (TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.role != 'owner')) THEN
    SELECT COUNT(*) INTO v_remaining_owners
    FROM memberships
    WHERE tenant_id = OLD.tenant_id
      AND role = 'owner'
      AND id != OLD.id;

    IF v_remaining_owners < 1 THEN
      RAISE EXCEPTION 'Cannot demote or remove the last owner of tenant %', OLD.tenant_id;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_prevent_last_owner_loss ON memberships;
CREATE TRIGGER trg_prevent_last_owner_loss
  BEFORE UPDATE OR DELETE ON memberships
  FOR EACH ROW
  EXECUTE FUNCTION prevent_last_owner_demotion_or_removal();

-- Secure Tenant Deletion Function: allows owner to delete whole tenant and cascades to all tenant rows
CREATE OR REPLACE FUNCTION delete_tenant(p_tenant_id uuid) RETURNS void AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT is_tenant_owner(p_tenant_id) THEN
    RAISE EXCEPTION 'Forbidden: Only the tenant owner can delete a tenant';
  END IF;

  -- Set session flag so last-owner trigger permits cascading deletion
  PERFORM set_config('app.deleting_tenant', 'true', true);

  -- Delete tenant (cascades to memberships, devices, pairing_codes, transactions, etc.)
  DELETE FROM tenants WHERE id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

ALTER FUNCTION delete_tenant(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION delete_tenant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_tenant(uuid) TO walletsync_app;

-- Replace generic memberships ALL policy with role-enforced INSERT/UPDATE/DELETE policies
DROP POLICY IF EXISTS memberships_tenant_isolation_policy ON memberships;

CREATE POLICY memberships_insert_policy ON memberships
  FOR INSERT
  WITH CHECK (
    user_has_tenant_access(tenant_id)
    AND is_tenant_admin_or_owner(tenant_id)
    AND (role != 'owner' OR is_tenant_owner(tenant_id))
  );

CREATE POLICY memberships_update_policy ON memberships
  FOR UPDATE
  USING (
    user_has_tenant_access(tenant_id)
    AND is_tenant_admin_or_owner(tenant_id)
    AND (role != 'owner' OR is_tenant_owner(tenant_id))
  )
  WITH CHECK (
    user_has_tenant_access(tenant_id)
    AND (role != 'owner' OR is_tenant_owner(tenant_id))
  );

CREATE POLICY memberships_delete_policy ON memberships
  FOR DELETE
  USING (
    user_has_tenant_access(tenant_id)
    AND is_tenant_admin_or_owner(tenant_id)
    AND (role != 'owner' OR is_tenant_owner(tenant_id))
  );


