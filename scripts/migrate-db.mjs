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

  const sql = postgres(connectionString, { max: 1, ssl: 'require' });

  try {
    const runFile = async (name, relPath) => {
      console.log(`Applying ${name}...`);
      const fileSql = fs.readFileSync(path.join(rootDir, relPath), 'utf8');
      try {
        await sql.unsafe(fileSql);
      } catch (err) {
        if (err.code === '42710' || err.message?.includes('already exists')) {
          console.log(`  (Notice: objects in ${name} already exist, skipping)`);
        } else {
          throw err;
        }
      }
    };

    await runFile('0000_auth_shim.sql', 'apps/web/drizzle/0000_auth_shim.sql');
    await runFile('0000_schema.sql', 'apps/web/drizzle/0000_schema.sql');
    await runFile('0001_rls.sql', 'apps/web/drizzle/0001_rls.sql');
    await runFile('0002_device_heartbeat.sql', 'apps/web/drizzle/0002_device_heartbeat.sql');
    await runFile('0003_sync_events_fix.sql', 'apps/web/drizzle/0003_sync_events_fix.sql');
    await runFile('0004_transactions_parser_version.sql', 'apps/web/drizzle/0004_transactions_parser_version.sql');
    await runFile('0005_recharge_orders.sql', 'apps/web/drizzle/0005_recharge_orders.sql');

    console.log('✓ All migrations applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

runMigrations();

