import { describe, it, expect } from 'vitest';
import {
  encryptCustomerNo,
  decryptCustomerNo,
  extractCustomerLast4,
  hashCustomerNo,
  hashDeviceToken,
  hashPairingCode,
  generateDeviceToken,
} from '@/lib/crypto';

describe('crypto utilities (PII minimization & token security)', () => {
  it('encrypts and decrypts customer phone number with AES-256-GCM', () => {
    const mobile = '9876543210';
    const encrypted = encryptCustomerNo(mobile);

    expect(encrypted).not.toBe(mobile);
    expect(encrypted.split(':')).toHaveLength(3);

    const decrypted = decryptCustomerNo(encrypted);
    expect(decrypted).toBe(mobile);
  });

  it('extracts exactly 4 digits for customerLast4', () => {
    expect(extractCustomerLast4('9876543210')).toBe('3210');
    expect(extractCustomerLast4('+91 98765 43210')).toBe('3210');
    expect(extractCustomerLast4('12')).toBe('0012');
  });

  it('produces deterministic HMAC-SHA256 for exact lookups without decryption', () => {
    const mobile = '9800000000';
    const hash1 = hashCustomerNo(mobile);
    const hash2 = hashCustomerNo(mobile);
    const hashDiff = hashCustomerNo('9800000001');

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
