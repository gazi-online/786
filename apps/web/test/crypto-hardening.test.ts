import { describe, it, expect } from 'vitest';
import {
  encryptCustomerNo,
  decryptCustomerNo,
  hashCustomerNo,
  CURRENT_ENCRYPTION_KEY_ID,
  CURRENT_HMAC_KEY_ID,
} from '@/lib/crypto';
import { migrateRecordInMemory } from '@/scripts/migrate-customer-hash';
import { ApiTransactionSchema } from '@walletsync/contract';

describe('Step 1 Hardening: Hash and Encryption & Public API Security', () => {
  it('encrypts as version:iv:tag:ciphertext with 96-bit IV and tenant binding', () => {
    const rawNumber = '5000003210';
    const tenantId = '00000000-0000-0000-0000-000000000001';

    const enc1 = encryptCustomerNo(rawNumber, tenantId);
    const enc2 = encryptCustomerNo(rawNumber, tenantId);

    // IV must be random per encryption
    expect(enc1).not.toBe(enc2);
    const [ver, iv, tag, ct] = enc1.split(':');
    expect(ver).toBe(CURRENT_ENCRYPTION_KEY_ID);
    expect(iv?.length).toBe(24); // 12 bytes = 96 bits
    expect(tag?.length).toBe(32); // 16 bytes = 128 bits
    expect(ct?.length).toBeGreaterThan(0);

    // Decrypt succeeds with correct tenantId
    expect(decryptCustomerNo(enc1, tenantId)).toBe(rawNumber);

    // Decrypt fails if tenantId does not match (AAD verification fails)
    expect(() => decryptCustomerNo(enc1, 'different-tenant-id')).toThrow();
  });

  it('migration script updates legacy row to new format and is idempotent/re-runnable', () => {
    const rawNumber = '5000003210';
    const tenantId = '00000000-0000-0000-0000-000000000001';

    // Simulate legacy record without version prefix or AAD
    const legacyEncrypted = encryptCustomerNo(rawNumber);
    const legacyParts = legacyEncrypted.split(':');
    const legacy3Part = `${legacyParts[1]}:${legacyParts[2]}:${legacyParts[3]}`;

    const originalRecord = {
      id: 'txn-1',
      tenantId,
      customerNo: legacy3Part,
      customerNoHash: 'old-or-fallback-hash',
    };

    // First run migrates
    const run1 = migrateRecordInMemory(originalRecord);
    expect(run1.status).toBe('migrated');
    expect(run1.customerNo.startsWith(`${CURRENT_ENCRYPTION_KEY_ID}:`)).toBe(true);
    expect(run1.customerNoHash).toBe(hashCustomerNo(rawNumber, CURRENT_HMAC_KEY_ID));

    // Verify it decrypts with tenantId
    expect(decryptCustomerNo(run1.customerNo, tenantId)).toBe(rawNumber);

    // Second run is idempotent (skips)
    const run2 = migrateRecordInMemory({
      id: 'txn-1',
      tenantId,
      customerNo: run1.customerNo,
      customerNoHash: run1.customerNoHash,
    });
    expect(run2.status).toBe('skipped');
    expect(run2.customerNo).toBe(run1.customerNo);
  });

  it('ApiTransactionSchema forbids customerNoHash and raw phone numbers from public API', () => {
    const sampleApiRow = {
      id: '00000000-0000-0000-0000-000000000001',
      tenantId: '00000000-0000-0000-0000-000000000001',
      txnId: '27754921',
      source: 'simplewallet' as const,
      service: 'Prepaid',
      serviceName: 'JIO',
      customerLast4: '3210',
      customerNoMasked: '••••••3210',
      occurredAt: '2026-10-29T19:13:30+05:30',
      status: 'success' as const,
      statusRaw: 'Success',
      operatorRef: '5000008980',
      amountPaise: 29900,
      discountPct: 0.5,
      discountPaise: 149,
      parserVersion: '1.0.0',
      createdAt: '2026-10-29T19:13:30.000Z',
      updatedAt: '2026-10-29T19:13:30.000Z',
    };

    const parsed = ApiTransactionSchema.safeParse(sampleApiRow);
    expect(parsed.success).toBe(true);

    // Schema must not contain customerNoHash
    expect('customerNoHash' in ApiTransactionSchema.shape).toBe(false);
    expect('customerNo' in ApiTransactionSchema.shape).toBe(false);
  });
});

