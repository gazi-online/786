-- Migration: 0005_recharge_orders.sql
-- Description: Milestone R1 - Server-side recharge orders foundation & tenant settings

-- 1. Create recharge_order_status enum
DO $$ BEGIN
  CREATE TYPE recharge_order_status AS ENUM (
    'queued',
    'claimed',
    'submitting',
    'submitted',
    'success',
    'failed',
    'unknown',
    'needs_manual_action',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Create tenant_recharge_settings table
CREATE TABLE IF NOT EXISTS tenant_recharge_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  recharge_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  per_order_max_paise INTEGER NOT NULL DEFAULT 100000,
  daily_max_paise INTEGER NOT NULL DEFAULT 500000,
  max_orders_per_minute INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 3. Create recharge_orders table
CREATE TABLE IF NOT EXISTS recharge_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  source txn_source NOT NULL,
  service TEXT NOT NULL DEFAULT 'Prepaid',
  operator TEXT NOT NULL,
  customer_no_enc TEXT NOT NULL,
  customer_no_hash TEXT NOT NULL,
  customer_last4 VARCHAR(4) NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  status recharge_order_status NOT NULL DEFAULT 'queued',
  claimed_by_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
  claim_expires_at TIMESTAMP WITH TIME ZONE,
  submitted_at TIMESTAMP WITH TIME ZONE,
  failure_code TEXT,
  failure_detail TEXT,
  matched_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  reconciled_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT recharge_orders_tenant_idempotency_uidx UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS recharge_orders_tenant_created_idx ON recharge_orders(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS recharge_orders_tenant_status_idx ON recharge_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS recharge_orders_customer_hash_idx ON recharge_orders(tenant_id, customer_no_hash);
CREATE INDEX IF NOT EXISTS recharge_orders_matched_txn_idx ON recharge_orders(tenant_id, matched_transaction_id);

-- 4. Enable and FORCE Row Level Security (RLS)
ALTER TABLE tenant_recharge_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_recharge_settings FORCE ROW LEVEL SECURITY;

ALTER TABLE recharge_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE recharge_orders FORCE ROW LEVEL SECURITY;

-- 5. Create RLS isolation policies matching user_has_tenant_access
DO $$ BEGIN
  CREATE POLICY tenant_recharge_settings_isolation_policy ON tenant_recharge_settings
    FOR ALL
    USING (user_has_tenant_access(tenant_id))
    WITH CHECK (user_has_tenant_access(tenant_id));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY recharge_orders_isolation_policy ON recharge_orders
    FOR ALL
    USING (user_has_tenant_access(tenant_id))
    WITH CHECK (user_has_tenant_access(tenant_id));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

