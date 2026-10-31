import { describe, it, expect } from 'vitest';
import {
  encryptCustomerNo,
  decryptCustomerNo,
  extractCustomerLast4,
  hashCustomerNo,
  hashDeviceToken,
  hashPairingCode,
  generateDeviceToken,
  CURRENT_ENCRYPTION_KEY_ID,
} from '@/lib/crypto';

describe('crypto utilities (PII minimization & token security)', () => {
  it('encrypts and decrypts with format version:iv:tag:ciphertext and tenant AAD binding', () => {
    const mobile = '5000003210';
    const tenantId = '00000000-0000-0000-0000-000000000001';
    const encrypted = encryptCustomerNo(mobile, tenantId);

    expect(encrypted).not.toBe(mobile);
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe(CURRENT_ENCRYPTION_KEY_ID);
    // 96-bit IV = 12 bytes = 24 hex chars
    expect(parts[1]).toHaveLength(24);
    // 128-bit Auth Tag = 16 bytes = 32 hex chars
    expect(parts[2]).toHaveLength(32);

    // Decrypts successfully with matching tenantId AAD
    const decrypted = decryptCustomerNo(encrypted, tenantId);
    expect(decrypted).toBe(mobile);

    // Tampered tenantId AAD fails authentication
    expect(() => decryptCustomerNo(encrypted, 'different-tenant-id')).toThrow();
  });

  it('supports backward compatibility for legacy 3-part ciphertext without AAD', () => {
    // legacy format: iv:tag:ciphertext
    const mobile = '5000003210';
    const encrypted = encryptCustomerNo(mobile); // without tenant AAD
    const parts = encrypted.split(':');
    const legacyEncrypted = `${parts[1]}:${parts[2]}:${parts[3]}`;

    const decrypted = decryptCustomerNo(legacyEncrypted);
    expect(decrypted).toBe(mobile);
  });

  it('generates unique random 96-bit IVs for each encryption', () => {
    const mobile = '5000003210';
    const enc1 = encryptCustomerNo(mobile);
    const enc2 = encryptCustomerNo(mobile);

    expect(enc1).not.toBe(enc2);
    const iv1 = enc1.split(':')[1];
    const iv2 = enc2.split(':')[1];
    expect(iv1).not.toBe(iv2);
  });

  it('extracts exactly 4 digits for customerLast4', () => {
    expect(extractCustomerLast4('5000003210')).toBe('3210');
    expect(extractCustomerLast4('+91 98765 43210')).toBe('3210');
    expect(extractCustomerLast4('12')).toBe('0012');
  });

  it('produces deterministic HMAC-SHA256 for exact lookups without decryption', () => {
    const mobile = '5000000000';
    const hash1 = hashCustomerNo(mobile);
    const hash2 = hashCustomerNo(mobile);
    const hashDiff = hashCustomerNo('5000000001');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hashDiff);
    expect(hash1).toHaveLength(64);
  });

  it('hashes device token and pairing codes deterministically', () => {
    const rawToken = generateDeviceToken();
    expect(rawToken).toHaveLength(64);

    const hash1 = hashDeviceToken(rawToken);
    const hash2 = hashDeviceToken(rawToken);
    expect(hash1).toBe(hash2);

    const code = 'ABCD1234';
    expect(hashPairingCode(code)).toBe(hashPairingCode('abcd1234'));
  });
});
