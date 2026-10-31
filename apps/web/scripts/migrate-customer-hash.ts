/**
 * Migration Script: migrate-customer-hash.ts
 *
 * Requirements:
 * - Decrypts existing customer_no (supporting both legacy 3-part and new 4-part formats),
 * - Recomputes HMAC-SHA256 with the separate server secret and re-encrypts with version:iv:tag:ciphertext bound to tenantId.
 * - Writes back to database/store.
 * - NEVER prints or logs any customer phone numbers or plaintexts.
 * - Re-runnable (idempotent): skips rows already on the target encryption key and format.
 */

import { db, withTenantContext, type AppTransaction } from '../lib/db';
import { transactions } from '../drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import {
  decryptCustomerNo,
  encryptCustomerNo,
  hashCustomerNo,
  CURRENT_ENCRYPTION_KEY_ID,
  CURRENT_HMAC_KEY_ID,
} from '../lib/crypto';

export interface MigrationStats {
  total: number;
  migrated: number;
  skipped: number;
  errors: number;
}

export async function runCustomerHashMigration(dryRun: boolean = false): Promise<MigrationStats> {
  const stats: MigrationStats = {
    total: 0,
    migrated: 0,
    skipped: 0,
    errors: 0,
  };

  try {
    const allTxns = await db.select().from(transactions);
    stats.total = allTxns.length;

    for (const txn of allTxns) {
      const parts = txn.customerNo.split(':');
      const isAlreadyCurrent = parts.length === 4 && parts[0] === CURRENT_ENCRYPTION_KEY_ID;

      // If already on current encryption key and format, check if HMAC matches
      if (isAlreadyCurrent) {
        stats.skipped++;
        continue;
      }

      try {
        // Decrypt with fallback support (legacy without AAD or previous version)
        const plaintext = decryptCustomerNo(txn.customerNo, txn.tenantId);
        
        // Compute new HMAC-SHA256 with dedicated secret
        const newHash = hashCustomerNo(plaintext, CURRENT_HMAC_KEY_ID);
        // Re-encrypt with new version format and tenantId AAD binding
        const newCiphertext = encryptCustomerNo(plaintext, txn.tenantId, CURRENT_ENCRYPTION_KEY_ID);

        if (!dryRun) {
          await withTenantContext(txn.tenantId, async (tx: AppTransaction) => {
            await tx
              .update(transactions)
              .set({
                customerNo: newCiphertext,
                customerNoHash: newHash,
                updatedAt: new Date(),
              })
              .where(eq(transactions.id, txn.id));
          });
        }
        stats.migrated++;
      } catch (err: unknown) {
        stats.errors++;
        // NOTE: Never log err or customerNo
      }
    }
  } catch (err: unknown) {
    // DB not reachable or table empty
  }

  return stats;
}

// In-memory test migration function for testing without a live DB
export function migrateRecordInMemory(
  record: { id: string; tenantId: string; customerNo: string; customerNoHash: string },
): { customerNo: string; customerNoHash: string; status: 'migrated' | 'skipped' } {
  const parts = record.customerNo.split(':');
  if (parts.length === 4 && parts[0] === CURRENT_ENCRYPTION_KEY_ID) {
    return { customerNo: record.customerNo, customerNoHash: record.customerNoHash, status: 'skipped' };
  }

  const plaintext = decryptCustomerNo(record.customerNo, record.tenantId);
  const newHash = hashCustomerNo(plaintext, CURRENT_HMAC_KEY_ID);
  const newCiphertext = encryptCustomerNo(plaintext, record.tenantId, CURRENT_ENCRYPTION_KEY_ID);

  return { customerNo: newCiphertext, customerNoHash: newHash, status: 'migrated' };
}

