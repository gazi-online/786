import { describe, it, expect } from 'vitest';
import {
  generateUnambiguousPairingCode,
  isUnambiguousCode,
  UNAMBIGUOUS_ALPHABET,
} from '@/lib/pairing-code';
import { checkRateLimit } from '@/lib/rate-limit';

describe('Step 8 Hardening: Pairing Code Unambiguous Alphabet & Rate Limiting', () => {
  it('generates pairing codes using only unambiguous alphabet (no 0, O, 1, I)', () => {
    // Generate 50 codes and verify every single character
    for (let i = 0; i < 50; i++) {
      const { clean, formatted } = generateUnambiguousPairingCode();
      expect(clean.length).toBe(8);
      expect(formatted.length).toBe(9);
      expect(formatted[4]).toBe('-');

      // Check forbidden ambiguous characters
      expect(clean).not.toContain('0');
      expect(clean).not.toContain('O');
      expect(clean).not.toContain('1');
      expect(clean).not.toContain('I');

      expect(isUnambiguousCode(clean)).toBe(true);
      expect(isUnambiguousCode(formatted)).toBe(true);
    }
  });

  it('rejects ambiguous codes containing 0, O, 1, I', () => {
    expect(isUnambiguousCode('ABCD0123')).toBe(false);
    expect(isUnambiguousCode('ABCDEFOI')).toBe(false);
  });

  it('locks a pairing code after 5 failed attempts in the rate limiter store', async () => {
    const codeHash = 'mock_code_hash_for_locking_test';
    const limitKey = `pair:code:${codeHash}`;

    // Attempt 1 to 5
    for (let i = 1; i <= 5; i++) {
      const res = await checkRateLimit(limitKey, 5, 600);
      expect(res.success).toBe(true);
    }

    // Attempt 6 should fail and lock
    const lockedRes = await checkRateLimit(limitKey, 5, 600);
    expect(lockedRes.success).toBe(false);
    expect(lockedRes.remaining).toBe(0);
  });
});
