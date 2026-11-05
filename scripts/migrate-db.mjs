/**
 * Database Migration & RLS Provisioning Script
 *
 * Usage:
 *   node scripts/migrate-db.mjs
 *
 * Reads:
 *   DATABASE_OWNER_URL or DATABASE_URL
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function runMigrations() {
  const connectionString =
    process.env.DATABASE_OWNER_URL ||
    process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('ERROR: DATABASE_OWNER_URL or DATABASE_URL environment variable is required.');
    process.exit(1);
  }

  // Import postgres from apps/web
  let postgres;
  try {
    const postgresPath = path.join(rootDir, 'apps/web/node_modules/postgres/src/index.js');
    const postgresModule = await import(pathToFileURL(postgresPath).href);
    postgres = postgresModule.default;
  } catch {
    try {
      const pnpmPostgres = path.join(rootDir, 'node_modules/.pnpm/postgres@3.4.9/node_modules/postgres/src/index.js');
      const postgresModule = await import(pathToFileURL(pnpmPostgres).href);
      postgres = postgresModule.default;
    } catch {
      const postgresModule = await import('postgres');
      postgres = postgresModule.default;
    }
  }

  const sql = postgres(connectionString, { max: 1 });

  try {
    console.log('Applying 0000_auth_shim.sql (Auth shim for vanilla Postgres)...');
    const authShim = fs.readFileSync(path.join(rootDir, 'apps/web/drizzle/0000_auth_shim.sql'), 'utf8');
    await sql.unsafe(authShim);

    console.log('Applying 0000_schema.sql (Initial table schemas)...');
    const schemaSql = fs.readFileSync(path.join(rootDir, 'apps/web/drizzle/0000_schema.sql'), 'utf8');
    await sql.unsafe(schemaSql);

    console.log('Applying 0001_rls.sql (Row Level Security & tenant policies)...');
    const rlsSql = fs.readFileSync(path.join(rootDir, 'apps/web/drizzle/0001_rls.sql'), 'utf8');
    await sql.unsafe(rlsSql);

    console.log('Applying 0002_device_heartbeat.sql (Heartbeat & portal metadata columns)...');
    const heartbeatSql = fs.readFileSync(path.join(rootDir, 'apps/web/drizzle/0002_device_heartbeat.sql'), 'utf8');
    await sql.unsafe(heartbeatSql);

    console.log('Applying 0003_sync_events_fix.sql (Sync events schema fix)...');
    const syncEventsSql = fs.readFileSync(path.join(rootDir, 'apps/web/drizzle/0003_sync_events_fix.sql'), 'utf8');
    await sql.unsafe(syncEventsSql);

    console.log('✓ All migrations applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

runMigrations();

