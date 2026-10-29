import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import * as schema from '@/drizzle/schema';

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
 * Execute a callback within a transaction where `app.current_tenant_id` is explicitly set.
 * Crucial for device-token endpoints (Amd-1) where no Supabase Auth JWT is present,
 * ensuring RLS isolation applies even when executing as the app's runtime DB role.
 */
export async function withTenantContext<T>(
  tenantId: string,
  fn: (tx: AppTransaction) => Promise<T>,
): Promise<T> {
  return await db.transaction(async (tx) => {
    // Set local configuration variable scoped to this transaction
    await tx.execute(sql`SET LOCAL app.current_tenant_id = ${tenantId}`);
    return await fn(tx);
  });
}

