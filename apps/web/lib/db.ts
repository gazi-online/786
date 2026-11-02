import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import * as schema from '@/drizzle/schema';

/**
 * Production Database and In-Memory Store Boot Guard
 *
 * Requirements (Amd-2):
 * - Boot fails in production (NODE_ENV === 'production') without DATABASE_URL / SUPABASE_DB_URL.
 * - Boot fails in production if ALLOW_IN_MEMORY_STORE is set.
 * - In-memory store is allowed ONLY when NODE_ENV !== 'production' and ALLOW_IN_MEMORY_STORE is set to 'true'.
 */
export function validateEnvironmentAndDatabaseConfig(): { isProduction: boolean; allowMemoryFallback: boolean } {
  const isProduction = process.env.NODE_ENV === 'production';
  const allowMemoryStoreEnv = process.env.ALLOW_IN_MEMORY_STORE;

  if (isProduction) {
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      return { isProduction: true, allowMemoryFallback: false };
    }
    if (allowMemoryStoreEnv === 'true' || allowMemoryStoreEnv === '1') {
      throw new Error(
        'FATAL: ALLOW_IN_MEMORY_STORE is strictly forbidden in production (NODE_ENV=production). Refusing to start.',
      );
    }
    if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) {
      throw new Error(
        'FATAL: Production requires DATABASE_URL or SUPABASE_DB_URL. In-memory store cannot be used in production. Refusing to start.',
      );
    }
  }

  const allowMemoryFallback = !isProduction && (allowMemoryStoreEnv === 'true' || allowMemoryStoreEnv === '1');
  return { isProduction, allowMemoryFallback };
}

// Execute guard check on module evaluation
validateEnvironmentAndDatabaseConfig();

// Connection string for PostgreSQL runtime role
const connectionString =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  'postgres://postgres:postgres@localhost:5432/walletsync';

// Single client instance for serverless / edge reuse
const queryClient = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });
export type AppDatabase = typeof db;
export type AppTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Asserts that the connected database role is not a table owner and has NOBYPASSRLS.
 * Logs a fatal error and throws in production if breached (Item 5).
 */
export async function assertRuntimeRoleSecurity(client = queryClient): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production';
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  try {
    const roleInfo = await client<{ rolname: string; rolbypassrls: boolean }[]>`
      SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = current_user
    `;
    if (roleInfo.length > 0 && roleInfo[0]?.rolbypassrls) {
      const msg = `FATAL: Connected database role "${roleInfo[0]?.rolname}" has BYPASSRLS. Runtime role must NOT have BYPASSRLS.`;
      console.error(msg);
      if (isProduction) {
        throw new Error(msg);
      }
    }

    const tableOwnerInfo = await client<{ tablename: string; tableowner: string }[]>`
      SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'transactions'
    `;
    if (
      tableOwnerInfo.length > 0 &&
      roleInfo.length > 0 &&
      tableOwnerInfo[0]?.tableowner === roleInfo[0]?.rolname
    ) {
      const msg = `FATAL: Connected database role "${roleInfo[0]?.rolname}" owns table "transactions". Runtime role must NOT own tenant tables.`;
      console.error(msg);
      if (isProduction) {
        throw new Error(msg);
      }
    }
  } catch (err) {
    if (isProduction && err instanceof Error && err.message.startsWith('FATAL:')) {
      throw err;
    }
    // Ignore offline connection errors in dev/test when DB not up
  }
}

/**
 * Execute a callback within a transaction where `app.current_tenant_id` is explicitly set.
 * Uses parameterized set_config('app.current_tenant_id', $1, true)
 * Fully compatible with transaction-level connection poolers (e.g. Supabase Supavisor / PgBouncer).
 */
export async function withTenantContext<T>(
  tenantId: string,
  fn: (tx: AppTransaction) => Promise<T>,
): Promise<T> {
  return await db.transaction(async (tx) => {
    // Set local configuration variable scoped strictly to this transaction (is_local = true)
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
    return await fn(tx);
  });
}
