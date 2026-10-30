import { describe, it, expect } from 'vitest';
import { computeTenantScopedETag } from '@/lib/etag';
import { clearClientCache, setClientCache, getClientCache } from '@/lib/client-cache';

describe('Step 3 Hardening: Scoped ETags, Private Cache-Control & Client Cache Clearing', () => {
  it('hashes the tenantId into the ETag and never shows tenantId directly in header', () => {
    const tenantId = '11111111-2222-3333-4444-555555555555';
    const etag = computeTenantScopedETag({
      tenantId,
      count: 25,
      maxUpdatedAt: '2026-10-30T10:00:00.000Z',
      queryParams: { limit: 50 },
    });

    expect(etag.startsWith('W/"')).toBe(true);
    expect(etag.endsWith('"')).toBe(true);
    // Tenant ID must NOT appear in the ETag header
    expect(etag.includes(tenantId)).toBe(false);
  });

  it('produces different ETags for different tenants with identical records', () => {
    const etagA = computeTenantScopedETag({
      tenantId: 'tenant-a',
      count: 10,
      maxUpdatedAt: '2026-10-30T10:00:00.000Z',
    });

    const etagB = computeTenantScopedETag({
      tenantId: 'tenant-b',
      count: 10,
      maxUpdatedAt: '2026-10-30T10:00:00.000Z',
    });

    expect(etagA).not.toBe(etagB);
  });

  it('changes the ETag when an OLD row has a status update (maxUpdatedAt changes)', () => {
    const initialETag = computeTenantScopedETag({
      tenantId: 'tenant-1',
      count: 50,
      maxUpdatedAt: '2026-10-25T08:00:00.000Z', // initial max
    });

    // An old row from 5 days ago receives a status change today
    const updatedETag = computeTenantScopedETag({
      tenantId: 'tenant-1',
      count: 50, // count remains unchanged
      maxUpdatedAt: '2026-10-30T11:00:00.000Z', // updated_at bumped
    });

    expect(initialETag).not.toBe(updatedETag);
  });

  it('changes the ETag when query parameters differ', () => {
    const etagAll = computeTenantScopedETag({
      tenantId: 'tenant-1',
      count: 10,
      maxUpdatedAt: '2026-10-30T10:00:00.000Z',
      queryParams: { source: 'all' },
    });

    const etagSimpleWallet = computeTenantScopedETag({
      tenantId: 'tenant-1',
      count: 10,
      maxUpdatedAt: '2026-10-30T10:00:00.000Z',
      queryParams: { source: 'simplewallet' },
    });

    expect(etagAll).not.toBe(etagSimpleWallet);
  });

  it('clears client cache completely on clearClientCache', () => {
    setClientCache('txns', [{ id: '1', customerLast4: '1234', customerNoMasked: '••••••1234' }]);
    expect(getClientCache('txns')).not.toBeNull();

    clearClientCache();
    expect(getClientCache('txns')).toBeNull();
  });
});

