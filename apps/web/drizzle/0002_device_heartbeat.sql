-- 0002_device_heartbeat.sql
-- Add device heartbeat metadata columns to devices table

ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "extension_version" text;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "portal" text;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "portal_logged_in" boolean DEFAULT true;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "last_sync_at" timestamp with time zone;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "error_category" text;
