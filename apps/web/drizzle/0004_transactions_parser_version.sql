-- 0004_transactions_parser_version.sql
-- Ensure transactions table schema matches drizzle/schema.ts and ingest route requirements

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS parser_version text NOT NULL DEFAULT '1.0.0';
ALTER TABLE transactions ALTER COLUMN discount_pct TYPE text USING discount_pct::text;

