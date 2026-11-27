import { describe, it, expect, vi } from 'vitest';
import { migrateRecordInMemory } from '@/scripts/migrate-customer-hash';
import {
  encryptCustomerNo,
  decryptCustomerNo,
  hashCustomerNo,
  CURRENT_ENCRYPTION_KEY_ID,
  CURRENT_HMAC_KEY_ID,
} from '@/lib/crypto';

describe('Step A9 Hardening: Migration Script Verification on Copy of Data', () => {
  it('runs on a copy of seeded data, migrates rows, leaves second run with 0 changes, and emits zero plaintext', () => {
    // 1. Create a copy of test seeded records with legacy 3-part encryption (without version or AAD)
    const originalPhones = [
      '5000000001',
      '5000000002',
      '5000000003',
      '5000000004',
      '5000000005',
    ];
    const tenantId = '00000000-0000-0000-0000-000000000001';

    // Seed dataset with legacy format
    const seededDataCopy = originalPhones.map((phone, idx) => {
      const legacyEnc = encryptCustomerNo(phone);
      const parts = legacyEnc.split(':');
      const legacy3Part = `${parts[1]}:${parts[2]}:${parts[3]}`;
      return {
        id: `txn-${idx + 1}`,
        tenantId,
        customerNo: legacy3Part,
        customerNoHash: 'legacy-hash',
      };
    });

    const initialRowCount = seededDataCopy.length;
    expect(initialRowCount).toBe(5);

    // Track all console outputs to prove zero plaintext is printed
    const consoleSpy = vi.spyOn(console, 'log');
    const consoleErrorSpy = vi.spyOn(console, 'error');

    // 2. First Migration Run
    let migratedCount = 0;
    let skippedCount = 0;

    const afterFirstRun = seededDataCopy.map((rec) => {
      const res = migrateRecordInMemory(rec);
      if (res.status === 'migrated') migratedCount++;
      if (res.status === 'skipped') skippedCount++;
      return {
        ...rec,
        customerNo: res.customerNo,
        customerNoHash: res.customerNoHash,
      };
    });

    // Verify row count before and after
    expect(afterFirstRun.length).toBe(initialRowCount);
    expect(migratedCount).toBe(5);
    expect(skippedCount).toBe(0);

    // Verify each row is now on current version and binds tenantId
    afterFirstRun.forEach((rec, idx) => {
      expect(rec.customerNo.startsWith(`${CURRENT_ENCRYPTION_KEY_ID}:`)).toBe(true);
      expect(rec.customerNoHash).toBe(hashCustomerNo(originalPhones[idx]!, CURRENT_HMAC_KEY_ID));
      // Decrypt succeeds with tenantId
      expect(decryptCustomerNo(rec.customerNo, tenantId)).toBe(originalPhones[idx]);
    });

    // 3. Second Migration Run (Idempotency Proof)
    let secondRunMigrated = 0;
    let secondRunSkipped = 0;

    const afterSecondRun = afterFirstRun.map((rec) => {
      const res = migrateRecordInMemory(rec);
      if (res.status === 'migrated') secondRunMigrated++;
      if (res.status === 'skipped') secondRunSkipped++;
      return {
        ...rec,
        customerNo: res.customerNo,
        customerNoHash: res.customerNoHash,
      };
    });

    // Second run must change NOTHING
    expect(afterSecondRun.length).toBe(initialRowCount);
    expect(secondRunMigrated).toBe(0);
    expect(secondRunSkipped).toBe(5);

    // 4. Verify no plaintext or phone numbers reached logs or console
    const allLoggedLines = [
      ...consoleSpy.mock.calls.flat(),
      ...consoleErrorSpy.mock.calls.flat(),
    ].join(' ');

    originalPhones.forEach((phone) => {
      expect(allLoggedLines).not.toContain(phone);
    });

    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});

