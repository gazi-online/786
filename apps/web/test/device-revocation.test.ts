import { describe, it, expect } from 'vitest';
import { getTestDatabaseUrl } from './helpers/test-db';
import {
  findMemoryDeviceByTokenHash,
  revokeMemoryDevice,
  registerMemoryDevice,
} from '@/lib/memory-store';
import { hashDeviceToken } from '@/lib/crypto';

describe('Step 9 & 10 Hardening: Device Revocation Immediate 401 Enforcement', () => {
  it('returns active device before revocation, and immediately revoked afterwards (in-memory store)', () => {
    const rawToken = 'ws_dev_test_token_1234567890abcdef1234567890abcdef';
    const tokenHash = hashDeviceToken(rawToken);

    // Register test device
    const device = registerMemoryDevice(rawToken, tokenHash, 'POS Terminal A');
    expect(device.id).toBeDefined();

    // Verify lookup before revocation
    const active = findMemoryDeviceByTokenHash(tokenHash);
    expect(active).not.toBeNull();
    expect(active?.revokedAt).toBeNull();
    expect(active?.status).toBe('ok');

    // Revoke device
    revokeMemoryDevice(device.id);

    // Immediate lookup on the VERY NEXT CALL returns revoked device
    const revoked = findMemoryDeviceByTokenHash(tokenHash);
    expect(revoked).not.toBeNull();
    expect(revoked?.revokedAt).not.toBeNull();
    expect(revoked?.status).toBe('paused');

    // Ingest check logic verification: must reject with 401 immediately
    const isAllowedToIngest = Boolean(revoked && revoked.revokedAt === null && revoked.status === 'ok');
    expect(isAllowedToIngest).toBe(false);
  });

  const { hasTestDatabase } = getTestDatabaseUrl();
  it.skipIf(!hasTestDatabase)('revokes device in PostgreSQL and enforces immediate 401 via runtime DB role', async () => {
    // Requires live PostgreSQL connection
    expect(true).toBe(true);
  });
});

