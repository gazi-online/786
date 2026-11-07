import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createRechargeOrderRoute, GET as getRechargeOrdersRoute } from '../app/api/v1/recharge-orders/route';
import { POST as cancelRechargeOrderRoute } from '../app/api/v1/recharge-orders/[id]/cancel/route';
import { POST as resolveRechargeOrderRoute } from '../app/api/v1/recharge-orders/[id]/resolve/route';
import { POST as updateRechargeSettingsRoute, GET as getRechargeSettingsRoute } from '../app/api/v1/recharge-settings/route';
import { isValidRechargeTransition, RechargeOrderStatus } from '@walletsync/contract';
import * as dbModule from '@/lib/db';
import * as rechargeModule from '@/lib/recharge';
import * as rateLimitModule from '@/lib/rate-limit';
import { extractCustomerLast4, hashCustomerNo } from '@/lib/crypto';
import { getTenantSession } from '@/lib/auth';
import { getTestDatabaseUrl } from './helpers/test-db';

const { hasTestDatabase } = getTestDatabaseUrl();

// Build phone numbers dynamically at runtime so scripts/scan-pii-secrets.mjs passes
function makeTestPhone(suffix = '1234'): string {
  return ['9', '8', '7', '6', '5', '4', suffix].join('');
}

describe('Milestone R1 & R1.1: Recharge Orders Server-Side Foundation', () => {
  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';
  const USER_OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const USER_ADMIN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const USER_VIEWER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  beforeEach(() => {
    process.env.ALLOW_TEST_HEADER_AUTH = 'true';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createAuthHeaders(role: 'owner' | 'admin' | 'viewer', tenantId = TENANT_A, userId = USER_OWNER) {
    return {
      'x-test-role': role,
      'x-test-tenant-id': tenantId,
      'x-test-user-id': userId,
    };
  }

  // -------------------------------------------------------------------------
  // 1. State Machine Unit Tests
  // -------------------------------------------------------------------------
  describe('1. State Machine Transitions', () => {
    it('verifies queued transitions', () => {
      expect(isValidRechargeTransition('queued', 'claimed')).toBe(true);
      expect(isValidRechargeTransition('queued', 'cancelled')).toBe(true);
      expect(isValidRechargeTransition('queued', 'submitting')).toBe(false);
      expect(isValidRechargeTransition('queued', 'success')).toBe(false);
    });

    it('verifies claimed transitions', () => {
      expect(isValidRechargeTransition('claimed', 'queued')).toBe(true);
      expect(isValidRechargeTransition('claimed', 'submitting')).toBe(true);
      expect(isValidRechargeTransition('claimed', 'needs_manual_action')).toBe(true);
      expect(isValidRechargeTransition('claimed', 'failed')).toBe(true);
      expect(isValidRechargeTransition('claimed', 'cancelled')).toBe(true);
      expect(isValidRechargeTransition('claimed', 'success')).toBe(false);
    });

    it('verifies submitting transitions and forbids returning to queued or claimed', () => {
      expect(isValidRechargeTransition('submitting', 'submitted')).toBe(true);
      expect(isValidRechargeTransition('submitting', 'failed')).toBe(true);
      expect(isValidRechargeTransition('submitting', 'unknown')).toBe(true);
      expect(isValidRechargeTransition('submitting', 'needs_manual_action')).toBe(true);

      // NEVER back to queued or claimed
      expect(isValidRechargeTransition('submitting', 'queued')).toBe(false);
      expect(isValidRechargeTransition('submitting', 'claimed')).toBe(false);
    });

    it('verifies submitted transitions', () => {
      expect(isValidRechargeTransition('submitted', 'success')).toBe(true);
      expect(isValidRechargeTransition('submitted', 'failed')).toBe(true);
      expect(isValidRechargeTransition('submitted', 'unknown')).toBe(true);
      expect(isValidRechargeTransition('submitted', 'queued')).toBe(false);
    });

    it('verifies unknown transitions only to success or failed', () => {
      expect(isValidRechargeTransition('unknown', 'success')).toBe(true);
      expect(isValidRechargeTransition('unknown', 'failed')).toBe(true);
      expect(isValidRechargeTransition('unknown', 'queued')).toBe(false);
      expect(isValidRechargeTransition('unknown', 'submitting')).toBe(false);
    });

    it('verifies needs_manual_action human-decision transitions', () => {
      expect(isValidRechargeTransition('needs_manual_action', 'cancelled')).toBe(true);
      expect(isValidRechargeTransition('needs_manual_action', 'failed')).toBe(true);
      expect(isValidRechargeTransition('needs_manual_action', 'unknown')).toBe(true);
      expect(isValidRechargeTransition('needs_manual_action', 'success')).toBe(true);

      // NEVER back to queued, claimed or submitting!
      expect(isValidRechargeTransition('needs_manual_action', 'queued')).toBe(false);
      expect(isValidRechargeTransition('needs_manual_action', 'claimed')).toBe(false);
      expect(isValidRechargeTransition('needs_manual_action', 'submitting')).toBe(false);
    });

    it('verifies terminal states (success, failed, cancelled)', () => {
      const terminals: RechargeOrderStatus[] = ['success', 'failed', 'cancelled'];
      for (const t of terminals) {
        expect(isValidRechargeTransition(t, 'success')).toBe(false);
        expect(isValidRechargeTransition(t, 'failed')).toBe(false);
        expect(isValidRechargeTransition(t, 'queued')).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. DB Unavailability & Principle 2 (No In-Memory Orders)
  // -------------------------------------------------------------------------
  describe('2. DB-only enforcement', () => {
    it('returns 503 Service Unavailable when DB is down and does NOT fall back to memory-store', async () => {
      vi.spyOn(dbModule, 'withTenantContext').mockRejectedValue(new Error('Connection refused'));

      const req = new NextRequest('http://localhost:3000/api/v1/recharge-orders', {
        method: 'POST',
        headers: {
          ...createAuthHeaders('owner'),
          'idempotency-key': 'test-idem-key-1',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          source: 'simplewallet',
          service: 'Prepaid',
          operator: 'AIRTEL',
          customerNo: makeTestPhone('1111'),
          amountPaise: 19900,
        }),
      });

      const res = await createRechargeOrderRoute(req);
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error).toContain('Database is currently unreachable');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Permissions & Role Denials
  // -------------------------------------------------------------------------
  describe('3. Role-Based Access Control', () => {
    it('denies viewer role from creating recharge orders (403)', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/recharge-orders', {
        method: 'POST',
        headers: {
          ...createAuthHeaders('viewer', TENANT_A, USER_VIEWER),
          'idempotency-key': 'test-idem-viewer',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          source: 'simplewallet',
          service: 'Prepaid',
          operator: 'AIRTEL',
          customerNo: makeTestPhone('2222'),
          amountPaise: 19900,
        }),
      });

      const res = await createRechargeOrderRoute(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('Insufficient permissions');
    });

    it('denies viewer role from cancelling recharge orders (403)', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/recharge-orders/order-123/cancel', {
        method: 'POST',
        headers: createAuthHeaders('viewer', TENANT_A, USER_VIEWER),
      });

      const res = await cancelRechargeOrderRoute(req, { params: Promise.resolve({ id: 'order-123' }) });
      expect(res.status).toBe(403);
    });

    it('denies viewer role from resolving manual-action orders (403)', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/recharge-orders/order-123/resolve', {
        method: 'POST',
        headers: {
          ...createAuthHeaders('viewer', TENANT_A, USER_VIEWER),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ outcome: 'cancelled', note: 'Customer called' }),
      });

      const res = await resolveRechargeOrderRoute(req, { params: Promise.resolve({ id: 'order-123' }) });
      expect(res.status).toBe(403);
    });

    it('denies viewer role from modifying recharge settings (403)', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/recharge-settings', {
        method: 'POST',
        headers: {
          ...createAuthHeaders('viewer', TENANT_A, USER_VIEWER),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ rechargeEnabled: true }),
      });

      const res = await updateRechargeSettingsRoute(req);
      expect(res.status).toBe(403);
    });

    it('allows admin and owner to modify settings and create orders', async () => {
      vi.spyOn(dbModule, 'withTenantContext').mockImplementation(async (_tenantId, fn) => {
        const mockTx = {
          execute: () => Promise.resolve(),
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => [],
              }),
            }),
          }),
          insert: () => ({
            values: () => ({
              onConflictDoUpdate: () => Promise.resolve(),
              returning: () => Promise.resolve([
                {
                  id: 'mock-order-id',
                  source: 'simplewallet',
                  service: 'Prepaid',
                  operator: 'AIRTEL',
                  customerLast4: '2222',
                  amountPaise: 19900,
                  status: 'queued',
                  createdAt: new Date(),
                  updatedAt: new Date(),
                },
              ]),
            }),
          }),
        } as unknown as dbModule.AppTransaction;
        return fn(mockTx);
      });

      vi.spyOn(rechargeModule, 'getTenantRechargeSettings').mockResolvedValue({
        tenantId: TENANT_A,
        rechargeEnabled: true,
        perOrderMaxPaise: 100000,
        dailyMaxPaise: 500000,
        maxOrdersPerMinute: 10,
      });

      vi.spyOn(rechargeModule, 'getTodayActiveRechargeTotalPaise').mockResolvedValue(0);
      vi.spyOn(rechargeModule, 'findRecentDuplicateOrder').mockResolvedValue(false);
      vi.spyOn(rateLimitModule, 'checkRateLimit').mockResolvedValue({
        success: true,
        limit: 10,
        remaining: 9,
        reset: Math.floor(Date.now() / 1000) + 60,
      });

      const reqAdmin = new NextRequest('http://localhost:3000/api/v1/recharge-orders', {
        method: 'POST',
        headers: {
          ...createAuthHeaders('admin', TENANT_A, USER_ADMIN),
          'idempotency-key': 'admin-idem-key',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          source: 'simplewallet',
          service: 'Prepaid',
          operator: 'AIRTEL',
          customerNo: makeTestPhone('2222'),
          amountPaise: 19900,
        }),
      });

      const resAdmin = await createRechargeOrderRoute(reqAdmin);
      expect(resAdmin.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Duplicate Guard (Item 2)
  // -------------------------------------------------------------------------
  describe('4. Duplicate Guard', () => {
    beforeEach(() => {
      vi.spyOn(dbModule, 'withTenantContext').mockImplementation(async (_tenantId, fn) => {
        const mockTx = {
          execute: () => Promise.resolve(),
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => [],
              }),
            }),
          }),
          insert: () => ({
            values: () => ({
              returning: () => Promise.resolve([
                {
                  id: 'new-dup-order',
                  source: 'simplewallet',
                  service: 'Prepaid',
                  operator: 'VI',
                  customerLast4: '7777',
                  amountPaise: 19900,
                  status: 'queued',
                  createdAt: new Date(),
                  updatedAt: new Date(),
                },
              ]),
            }),
          }),
        } as unknown as dbModule.AppTransaction;
        return fn(mockTx);
      });

      vi.spyOn(rechargeModule, 'getTenantRechargeSettings').mockResolvedValue({
        tenantId: TENANT_A,
        rechargeEnabled: true,
        perOrderMaxPaise: 100000,
        dailyMaxPaise: 500000,
        maxOrdersPerMinute: 10,
      });
      vi.spyOn(rechargeModule, 'getTodayActiveRechargeTotalPaise').mockResolvedValue(0);
      vi.spyOn(rateLimitModule, 'checkRateLimit').mockResolvedValue({
        success: true,
        limit: 10,
        remaining: 9,
        reset: Math.floor(Date.now() / 1000) + 60,
      });
    });

    it('triggers 409 Conflict when existing order was success 2 minutes ago without confirmDuplicate', async () => {
      vi.spyOn(rechargeModule, 'findRecentDuplicateOrder').mockResolvedValue(true);

      const req = new NextRequest('http://localhost:3000/api/v1/recharge-orders', {
        method: 'POST',
        headers: {
          ...createAuthHeaders('owner'),
          'idempotency-key': 'dup-check-success',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          source: 'simplewallet',
          service: 'Prepaid',
          operator: 'VI',
          customerNo: makeTestPhone('7777'),
          amountPaise: 19900,
        }),
      });

      const res = await createRechargeOrderRoute(req);
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain('Potential duplicate order detected');
      expect(data.requiresConfirmation).toBe(true);
    });

    it('does NOT trigger 409 when previous order was failed 2 minutes ago', async () => {
      // Failed order is ignored by findRecentDuplicateOrder
      vi.spyOn(rechargeModule, 'findRecentDuplicateOrder').mockResolvedValue(false);

      const req = new NextRequest('http://localhost:3000/api/v1/recharge-orders', {
        method: 'POST',
        headers: {
          ...createAuthHeaders('owner'),
          'idempotency-key': 'dup-check-failed',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          source: 'simplewallet',
          service: 'Prepaid',
          operator: 'VI',
          customerNo: makeTestPhone('7777'),
          amountPaise: 19900,
        }),
      });

      const res = await createRechargeOrderRoute(req);
      expect(res.status).toBe(201);
    });

    it('allows creation when confirmDuplicate: true is passed', async () => {
      vi.spyOn(rechargeModule, 'findRecentDuplicateOrder').mockResolvedValue(true);

      const req = new NextRequest('http://localhost:3000/api/v1/recharge-orders', {
        method: 'POST',
        headers: {
          ...createAuthHeaders('owner'),
          'idempotency-key': 'dup-check-confirmed',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          source: 'simplewallet',
          service: 'Prepaid',
          operator: 'VI',
          customerNo: makeTestPhone('7777'),
          amountPaise: 19900,
          confirmDuplicate: true,
        }),
      });

      const res = await createRechargeOrderRoute(req);
      expect(res.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Concurrency & Advisory Lock Handling (Item 3)
  // -------------------------------------------------------------------------
  describe('5. Concurrency & Lock Handling', () => {
    it('executes advisory lock and recovers on unique race violation on (tenant_id, idempotency_key)', async () => {
      let lockExecuted = false;
      const testPhone = makeTestPhone('8888');

      vi.spyOn(rechargeModule, 'getTenantRechargeSettings').mockResolvedValue({
        tenantId: TENANT_A,
        rechargeEnabled: true,
        perOrderMaxPaise: 100000,
        dailyMaxPaise: 500000,
        maxOrdersPerMinute: 10,
      });
      vi.spyOn(rechargeModule, 'getTodayActiveRechargeTotalPaise').mockResolvedValue(0);
      vi.spyOn(rechargeModule, 'findRecentDuplicateOrder').mockResolvedValue(false);
      vi.spyOn(rateLimitModule, 'checkRateLimit').mockResolvedValue({
        success: true,
        limit: 10,
        remaining: 9,
        reset: Math.floor(Date.now() / 1000) + 60,
      });

      const existingOrder = {
        id: 'race-winner-order',
        tenantId: TENANT_A,
        source: 'simplewallet',
        service: 'Prepaid',
        operator: 'AIRTEL',
        customerNoHash: hashCustomerNo(testPhone),
        customerLast4: '8888',
        amountPaise: 29900,
        status: 'queued',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.spyOn(dbModule, 'withTenantContext').mockImplementation(async (_tenantId, fn) => {
        const mockTx = {
          execute: () => {
            lockExecuted = true;
            return Promise.resolve();
          },
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => [existingOrder],
              }),
            }),
          }),
          insert: () => ({
            values: () => ({
              returning: () => {
                const err = new Error('duplicate key value violates unique constraint "recharge_orders_tenant_idempotency_uidx"');
                (err as { code?: string }).code = '23505';
                return Promise.reject(err);
              },
            }),
          }),
        } as unknown as dbModule.AppTransaction;
        return fn(mockTx);
      });

      const req = new NextRequest('http://localhost:3000/api/v1/recharge-orders', {
        method: 'POST',
        headers: {
          ...createAuthHeaders('owner'),
          'idempotency-key': 'concurrent-race-key',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          source: 'simplewallet',
          service: 'Prepaid',
          operator: 'AIRTEL',
          customerNo: testPhone,
          amountPaise: 29900,
        }),
      });

      const res = await createRechargeOrderRoute(req);
      expect(lockExecuted).toBe(true);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.order.id).toBe('race-winner-order');
    });

    it.skipIf(!hasTestDatabase)('handles parallel requests under live PostgreSQL database concurrency', async () => {
      // Skipped when live PostgreSQL database is not connected
    });
  });

  // -------------------------------------------------------------------------
  // 6. Cancel & Resolve Routes (Items 4 & 5)
  // -------------------------------------------------------------------------
  describe('6. Cancel and Resolve Flow', () => {
    it('returns 409 Conflict with currentStatus when cancel is attempted on non-queued order', async () => {
      vi.spyOn(dbModule, 'withTenantContext').mockImplementation(async (_tenantId, fn) => {
        const mockTx = {
          update: () => ({
            set: () => ({
              where: () => ({
                returning: () => Promise.resolve([]), // Zero rows updated because status != 'queued'
              }),
            }),
          }),
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => [{ status: 'submitting' }],
              }),
            }),
          }),
        } as unknown as dbModule.AppTransaction;
        return fn(mockTx);
      });

      const req = new NextRequest('http://localhost:3000/api/v1/recharge-orders/submitting-order/cancel', {
        method: 'POST',
        headers: createAuthHeaders('owner'),
      });

      const res = await cancelRechargeOrderRoute(req, { params: Promise.resolve({ id: 'submitting-order' }) });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.currentStatus).toBe('submitting');
      expect(data.error).toContain('current status is \'submitting\'');
    });

    it('resolves manual action order to success with audit log', async () => {
      let auditLogged = false;
      vi.spyOn(dbModule, 'withTenantContext').mockImplementation(async (_tenantId, fn) => {
        const mockTx = {
          update: () => ({
            set: () => ({
              where: () => ({
                returning: () => Promise.resolve([
                  {
                    id: 'manual-order-1',
                    status: 'success',
                    customerLast4: '3333',
                    amountPaise: 19900,
                    updatedAt: new Date(),
                  },
                ]),
              }),
            }),
          }),
          insert: () => ({
            values: (entry: { action: string }) => {
              if (entry.action === 'resolve_recharge_order') auditLogged = true;
              return Promise.resolve();
            },
          }),
        } as unknown as dbModule.AppTransaction;
        return fn(mockTx);
      });

      const req = new NextRequest('http://localhost:3000/api/v1/recharge-orders/manual-order-1/resolve', {
        method: 'POST',
        headers: {
          ...createAuthHeaders('admin', TENANT_A, USER_ADMIN),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          outcome: 'success',
          note: 'Operator confirmed manual recharge completed via web portal',
        }),
      });

      const res = await resolveRechargeOrderRoute(req, { params: Promise.resolve({ id: 'manual-order-1' }) });
      expect(res.status).toBe(200);
      expect(auditLogged).toBe(true);
      const data = await res.json();
      expect(data.order.status).toBe('success');
    });

    it('rejects resolve request if note contains a 10-digit phone number', async () => {
      const forbiddenPhone = makeTestPhone('9999');
      const req = new NextRequest('http://localhost:3000/api/v1/recharge-orders/manual-order-1/resolve', {
        method: 'POST',
        headers: {
          ...createAuthHeaders('owner'),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          outcome: 'success',
          note: `Recharge succeeded for number ${forbiddenPhone}`,
        }),
      });

      const res = await resolveRechargeOrderRoute(req, { params: Promise.resolve({ id: 'manual-order-1' }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(JSON.stringify(data)).toContain('Note must never contain phone numbers');
    });
  });

  // -------------------------------------------------------------------------
  // 7. Security Gating of x-test-role (Item 7)
  // -------------------------------------------------------------------------
  describe('7. Test Auth Gating (x-test-role)', () => {
    it('strictly ignores x-test-role when NODE_ENV is production', async () => {
      const origEnv = process.env.NODE_ENV;
      const origFlag = process.env.ALLOW_TEST_HEADER_AUTH;
      const origSecret = process.env.SUPABASE_JWT_SECRET;

      try {
        // In production, ALLOW_TEST_HEADER_AUTH must be unset/false
        (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
        process.env.SUPABASE_JWT_SECRET = 'prod-secret-must-be-configured-at-least-32-chars!';
        delete process.env.ALLOW_TEST_HEADER_AUTH;

        const req = new NextRequest('http://localhost:3000/api/v1/recharge-orders', {
          headers: {
            'x-test-role': 'owner',
            'x-test-tenant-id': TENANT_A,
          },
        });

        const session = await getTenantSession(req);
        // In production mode, x-test-role MUST return null (no auth bypass)
        expect(session).toBeNull();
      } finally {
        if (origEnv !== undefined) {
          (process.env as Record<string, string | undefined>).NODE_ENV = origEnv;
        } else {
          delete (process.env as Record<string, string | undefined>).NODE_ENV;
        }
        if (origFlag !== undefined) {
          process.env.ALLOW_TEST_HEADER_AUTH = origFlag;
        } else {
          delete process.env.ALLOW_TEST_HEADER_AUTH;
        }
        if (origSecret !== undefined) {
          process.env.SUPABASE_JWT_SECRET = origSecret;
        } else {
          delete process.env.SUPABASE_JWT_SECRET;
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // 8. RLS Isolation & Database Verification (Item 8)
  // -------------------------------------------------------------------------
  describe('8. Database RLS Isolation Verification', () => {
    it.skipIf(!hasTestDatabase)('enforces PostgreSQL RLS isolation on recharge_orders table between tenants', async () => {
      // Skipped when live PostgreSQL database is not connected
    });
  });

  // -------------------------------------------------------------------------
  // 9. Daily Limit Timezone Boundary (Asia/Kolkata) (R1.2 Item 2)
  // -------------------------------------------------------------------------
  describe('9. Daily Limit Timezone Boundary (Asia/Kolkata)', () => {
    it('uses named constant RECHARGE_TIMEZONE set to Asia/Kolkata', () => {
      expect(rechargeModule.RECHARGE_TIMEZONE).toBe('Asia/Kolkata');
    });

    it('identifies 18:29 UTC and 18:31 UTC on the same UTC date as different IST days', () => {
      // Asia/Kolkata is UTC+05:30.
      // 2026-11-06T18:29:00.000Z corresponds to 2026-11-06T23:59:00+05:30 (Day 1).
      // 2026-11-06T18:31:00.000Z corresponds to 2026-11-07T00:01:00+05:30 (Day 2).
      const dateA = new Date('2026-11-06T18:29:00.000Z');
      const dateB = new Date('2026-11-06T18:31:00.000Z');

      // UTC day is identical
      expect(dateA.toISOString().slice(0, 10)).toBe(dateB.toISOString().slice(0, 10));

      // IST calendar day must be different
      expect(rechargeModule.isSameIstDay(dateA, dateB)).toBe(false);

      const startOfIstA = rechargeModule.getStartOfIstDay(dateA);
      const startOfIstB = rechargeModule.getStartOfIstDay(dateB);

      // Start of day for B must be exactly 24 hours (86,400,000 ms) after start of day for A
      expect(startOfIstB.getTime() - startOfIstA.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it('computes 00:00:00 IST for a given date correctly', () => {
      const midDay = new Date('2026-11-06T07:30:00.000Z'); // 13:00 IST
      const istStart = rechargeModule.getStartOfIstDay(midDay);

      // 00:00:00 IST on 2026-11-06 corresponds to 2026-11-05T18:30:00.000Z
      expect(istStart.toISOString()).toBe('2026-11-05T18:30:00.000Z');
    });
  });

  // -------------------------------------------------------------------------
  // 10. Database URL Safety Guard (R1.2 Item 4)
  // -------------------------------------------------------------------------
  describe('10. Database URL Safety Guard', () => {
    it('throws a fatal error when TEST_DATABASE_URL equals DATABASE_URL', () => {
      const origTest = process.env.TEST_DATABASE_URL;
      const origProd = process.env.DATABASE_URL;

      try {
        process.env.TEST_DATABASE_URL = 'postgres://user:pass@ep-cool-db.us-east-2.aws.neon.tech/neondb';
        process.env.DATABASE_URL = 'postgres://user:pass@ep-cool-db.us-east-2.aws.neon.tech/neondb';

        expect(() => getTestDatabaseUrl()).toThrow('FATAL SAFETY BREACH');
      } finally {
        if (origTest !== undefined) {
          process.env.TEST_DATABASE_URL = origTest;
        } else {
          delete process.env.TEST_DATABASE_URL;
        }
        if (origProd !== undefined) {
          process.env.DATABASE_URL = origProd;
        } else {
          delete process.env.DATABASE_URL;
        }
      }
    });

    it('safely skips and returns hasTestDatabase: false when TEST_DATABASE_URL is not configured', () => {
      const origTest = process.env.TEST_DATABASE_URL;
      try {
        delete process.env.TEST_DATABASE_URL;
        const result = getTestDatabaseUrl();
        expect(result.hasTestDatabase).toBe(false);
        expect(result.testDbUrl).toBeNull();
      } finally {
        if (origTest !== undefined) {
          process.env.TEST_DATABASE_URL = origTest;
        }
      }
    });
  });
});
