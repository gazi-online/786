import { describe, it, expect } from 'vitest';
import {
  generateUnambiguousPairingCode,
  isUnambiguousCode,
} from '@/lib/pairing-code';
import { checkRateLimit, PostgresRateLimiter } from '@/lib/rate-limit';

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

  it('shares counter state across two separate limiter instances (in-memory standalone fallback)', async () => {
    const limiter1 = new PostgresRateLimiter('device-pool');
    const limiter2 = new PostgresRateLimiter('device-pool');
    const sharedKey = 'common-device-ip-192-168-1-50';

    // Instance 1 records 2 attempts
    const r1 = await limiter1.check(sharedKey, 5, 60);
    expect(r1.remaining).toBe(4);
    const r2 = await limiter1.check(sharedKey, 5, 60);
    expect(r2.remaining).toBe(3);

    // Instance 2 queries same key and observes previous counts from Instance 1
    const r3 = await limiter2.check(sharedKey, 5, 60);
    expect(r3.remaining).toBe(2);

    const r4 = await limiter2.check(sharedKey, 5, 60);
    expect(r4.remaining).toBe(1);

    const r5 = await limiter1.check(sharedKey, 5, 60);
    expect(r5.remaining).toBe(0);

    // 6th attempt across instances locks
    const r6 = await limiter2.check(sharedKey, 5, 60);
    expect(r6.success).toBe(false);
  });

  const hasDatabase = Boolean(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL);
  it.skipIf(!hasDatabase)('shares counter state in PostgreSQL rate_limit_counters table across instances', async () => {
    const limiter1 = new PostgresRateLimiter('pg-test');
    const limiter2 = new PostgresRateLimiter('pg-test');
    const pgKey = `live-pg-key-${Date.now()}`;

    const res1 = await limiter1.check(pgKey, 3, 30);
    expect(res1.remaining).toBe(2);

    const res2 = await limiter2.check(pgKey, 3, 30);
    expect(res2.remaining).toBe(1);
  });
});

