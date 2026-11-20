-- Migration: 0006_recharge_jobs_alignment.sql
-- Description: Milestone R1 - Alignment with Antigravity Guide for recharge jobs, audit events, and safety rules

-- 1. Extend recharge_order_status enum values
ALTER TYPE recharge_order_status ADD VALUE IF NOT EXISTS 'draft';
ALTER TYPE recharge_order_status ADD VALUE IF NOT EXISTS 'awaiting_confirm';
ALTER TYPE recharge_order_status ADD VALUE IF NOT EXISTS 'form_filled';
ALTER TYPE recharge_order_status ADD VALUE IF NOT EXISTS 'awaiting_payment';
ALTER TYPE recharge_order_status ADD VALUE IF NOT EXISTS 'payment_submitted';
ALTER TYPE recharge_order_status ADD VALUE IF NOT EXISTS 'needs_review';
ALTER TYPE recharge_order_status ADD VALUE IF NOT EXISTS 'expired';

-- 2. Add alignment columns to recharge_orders
ALTER TABLE recharge_orders ADD COLUMN IF NOT EXISTS circle TEXT;
ALTER TABLE recharge_orders ADD COLUMN IF NOT EXISTS expected_payable_paise INTEGER;
ALTER TABLE recharge_orders ADD COLUMN IF NOT EXISTS actual_payable_paise INTEGER;
ALTER TABLE recharge_orders ADD COLUMN IF NOT EXISTS qr_image_url TEXT;
ALTER TABLE recharge_orders ADD COLUMN IF NOT EXISTS qr_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE recharge_orders ADD COLUMN IF NOT EXISTS portal_txn_ref TEXT;
ALTER TABLE recharge_orders ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recharge_orders ADD COLUMN IF NOT EXISTS status_reason TEXT;
ALTER TABLE recharge_orders ADD COLUMN IF NOT EXISTS dry_run BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Add daily count limit to tenant_recharge_settings
ALTER TABLE tenant_recharge_settings ADD COLUMN IF NOT EXISTS daily_max_count INTEGER NOT NULL DEFAULT 50;

-- 4. Create recharge_order_events audit log table
CREATE TABLE IF NOT EXISTS recharge_order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES recharge_orders(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('web', 'extension', 'system')),
  detail JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS recharge_order_events_order_idx ON recharge_order_events(tenant_id, order_id, created_at);

ALTER TABLE recharge_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE recharge_order_events FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY recharge_order_events_isolation_policy ON recharge_order_events
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
