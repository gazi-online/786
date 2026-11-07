import { describe, it, expect } from 'vitest';
import { db, withTenantContext, type AppTransaction } from '@/lib/db';
import { transactions } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';

/**
 * M2 Acceptance Test: Tenant Isolation & RLS Enforcement (GUIDE.md §8 & Amd-1)
 *
 * Rules:
 * - SKIPPED (it.skipIf, shown as skipped) when DATABASE_URL is absent.
 * - FAIL when CI=true and DATABASE_URL is absent.
 * - Split into separate named tests:
 *   1. BYPASSRLS flag (rolbypassrls = false)
 *   2. Table ownership (runtime role does not own tables)
 *   3. FORCE RLS per table (all tenant tables)
 *   4. Unset context (returns zero rows)
 *   5. Cross-tenant reads (Tenant A cannot see Tenant B records)
 *   6. Direct SQL as runtime role (obeys RLS)
 */

import { getTestDatabaseUrl } from './helpers/test-db';

const isCI = process.env.CI === 'true';
const { hasTestDatabase } = getTestDatabaseUrl();

if (isCI && !hasTestDatabase) {
  throw new Error(
    'FATAL: Live database connection required in CI environment (CI=true), but TEST_DATABASE_URL is missing or connection failed.',
  );
}

describe('M2 Cross-Tenant Isolation & RLS Enforcement', () => {
  it.skipIf(!hasTestDatabase)('verifies runtime DB role has NOBYPASSRLS (rolbypassrls = false)', async () => {
    const roleInfo = await db.execute<{ rolname: string; rolbypassrls: boolean }>(
      sql`SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(roleInfo.length).toBeGreaterThan(0);
    expect(roleInfo[0]?.rolbypassrls).toBe(false);
  });

  it.skipIf(!hasTestDatabase)('verifies runtime DB role does not own tenant tables', async () => {
    const tableOwnerInfo = await db.execute<{ tablename: string; tableowner: string }>(
      sql`SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'transactions'`,
    );
    expect(tableOwnerInfo.length).toBeGreaterThan(0);
    const roleInfo = await db.execute<{ rolname: string }>(sql`SELECT current_user AS rolname`);
    expect(tableOwnerInfo[0]?.tableowner).not.toBe(roleInfo[0]?.rolname);
  });

  it.skipIf(!hasTestDatabase)('verifies FORCE ROW LEVEL SECURITY on every tenant table', async () => {
    const tenantTables = [
      'tenants',
      'memberships',
      'devices',
      'pairing_codes',
      'transactions',
      'sync_events',
      'audit_log',
    ];
    const rlsFlags = await db.execute<{ tablename: string; rowsecurity: boolean; forcerowsecurity: boolean }>(
      sql`SELECT tablename, rowsecurity, forcerowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY(${tenantTables})`,
    );
    expect(rlsFlags.length).toBe(tenantTables.length);
    for (const row of rlsFlags) {
      expect(row.rowsecurity).toBe(true);
      expect(row.forcerowsecurity).toBe(true);
    }
  });

  it.skipIf(!hasTestDatabase)('verifies an unset tenant context returns zero rows', async () => {
    const unsetContextRows = await db.select().from(transactions).limit(10);
    expect(unsetContextRows).toHaveLength(0);
  });

  it.skipIf(!hasTestDatabase)('verifies cross-tenant reads: Tenant A cannot query Tenant B records', async () => {
    const tenantA = '11111111-1111-1111-1111-111111111111';
    const tenantB = '22222222-2222-2222-2222-222222222222';

    // Insert transaction as Tenant B inside Tenant B's context
    await withTenantContext(tenantB, async (tx: AppTransaction) => {
      await tx
        .insert(transactions)
        .values({
          tenantId: tenantB,
          source: 'simplewallet',
          txnId: 'isolation-test-001',
          service: 'Prepaid',
          serviceName: 'AIRTEL',
          customerNo: 'encrypted_val',
          customerLast4: '0000',
          customerNoHash: 'hmac_val',
          occurredAt: new Date(),
          status: 'success',
          statusRaw: 'Success',
          amountPaise: 10000,
          discountPct: '1.0',
          discountPaise: 100,
          parserVersion: '1.0.0',
        })
        .onConflictDoNothing();
    });

    // Query transactions inside Tenant A's context
    const tenantAResults = await withTenantContext(tenantA, async (tx: AppTransaction) => {
      return await tx
        .select()
        .from(transactions)
        .where(eq(transactions.txnId, 'isolation-test-001'));
    });

    // Tenant A MUST see zero rows for Tenant B's transaction
    expect(tenantAResults).toHaveLength(0);
  });

  it.skipIf(!hasTestDatabase)('verifies direct SQL as runtime role obeys RLS policies', async () => {
    const directSqlRows = await db.execute(sql`SELECT * FROM transactions LIMIT 10`);
    expect(directSqlRows).toHaveLength(0);
  });
});
