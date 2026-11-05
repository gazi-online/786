-- 0003_sync_events_fix.sql
-- Ensure sync_events table schema matches drizzle/schema.ts and ingest route requirements

ALTER TABLE sync_events ADD COLUMN IF NOT EXISTS captured_at timestamptz DEFAULT now();
ALTER TABLE sync_events ADD COLUMN IF NOT EXISTS row_counts jsonb DEFAULT '{"accepted":0,"inserted":0,"updated":0,"unchanged":0,"rejected":0}'::jsonb;
ALTER TABLE sync_events ALTER COLUMN source DROP NOT NULL;
