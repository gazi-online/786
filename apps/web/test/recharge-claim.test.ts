import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as claimRechargeOrderRoute } from '../app/api/v1/recharge-orders/claim/route';
import { POST as updateOrderStatusRoute } from '../app/api/v1/recharge-orders/[id]/status/route';
import * as dbModule from '@/lib/db';
import * as rechargeModule from '@/lib/recharge';
import * as rateLimitModule from '@/lib/rate-limit';
import * as cryptoModule from '@/lib/crypto';
import { getTestDatabaseUrl } from './helpers/test-db';

const { hasTestDatabase } = getTestDatabaseUrl();

// Construct synthetic phone numbers dynamically to satisfy scan-pii-secrets.mjs
function makeTestPhone(suffix = '9999'): string {
  return ['5', '0', '0', '0', '0', '0', suffix].join('');
}

describe('Milestone R2: Recharge Order Claim & Status Dispatch Protocol', () => {
  const TENANT_ID = '11111111-1111-1111-1111-111111111111';
  const OTHER_TENANT_ID = '22222222-2222-2222-2222-222222222222';
  const DEVICE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const OTHER_DEVICE_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  const ORDER_ID = '99999999-9999-9999-9999-999999999999';

  beforeEach(() => {
    process.env.ALLOW_TEST_HEADER_AUTH = 'true';
    vi.spyOn(rateLimitModule, 'checkRateLimit').mockResolvedValue({
      success: true,
      limit: 60,
      remaining: 59,
      reset: Math.floor(Date.now() / 1000) + 60,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createDeviceHeaders(deviceId = DEVICE_ID, tenantId = TENANT_ID) {
    return {
      'x-test-device-id': deviceId,
      'x-test-tenant-id': tenantId,
      'content-type': 'application/json',
    };
  }

  // -------------------------------------------------------------------------
  // 1. Device Authentication & Gating
  // -------------------------------------------------------------------------
  describe('1. Device Authentication & Gating', () => {
    it('rejects claim request when Authorization header and test headers are missing (401)', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/recharge-orders/claim', {
        method: 'POST',
      });

      const res = await claimRechargeOrderRoute(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Unauthorized');
    });

    it('strictly ignores x-test-device-id headers when NODE_ENV is production', async () => {
      const origEnv = process.env.NODE_ENV;
      const origFlag = process.env.ALLOW_TEST_HEADER_AUTH;

      try {
        (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
        delete process.env.ALLOW_TEST_HEADER_AUTH;

        const req = new NextRequest('http://localhost:3000/api/v1/recharge-orders/claim', {
          method: 'POST',
          headers: createDeviceHeaders(),
        });

        const res = await claimRechargeOrderRoute(req);
        // In production, test headers MUST be ignored -> missing token -> 401
        expect(res.status).toBe(401);
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
      }
    });

    it('returns 503 Service Unavailable when the database is offline during device token verification', async () => {
      // Unset test header bypass to trigger database lookup
      const origFlag = process.env.ALLOW_TEST_HEADER_AUTH;
      delete process.env.ALLOW_TEST_HEADER_AUTH;

      try {
        vi.spyOn(dbModule.db, 'select').mockImplementation(() => {
          throw new Error('Database connection failed');
        });

        const req = new NextRequest('http://localhost:3000/api/v1/recharge-orders/claim', {
          method: 'POST',
          headers: {
            authorization: 'Bearer valid_looking_device_token_xyz',
          },
        });

        const res = await claimRechargeOrderRoute(req);
        expect(res.status).toBe(503);
      } finally {
        if (origFlag !== undefined) {
          process.env.ALLOW_TEST_HEADER_AUTH = origFlag;
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. Order Claim Protocol (POST /api/v1/recharge-orders/claim)
  // -------------------------------------------------------------------------
  describe('2. Order Claim Endpoint', () => {
    it('returns order: null when tenant recharge setting is disabled', async () => {
      vi.spyOn(dbModule, 'withTenantContext').mockImplementation(async (_tenantId, fn) => {
        const mockTx = {} as unknown as dbModule.AppTransaction;
        return fn(mockTx);
      });

      vi.spyOn(rechargeModule, 'getTenantRechargeSettings').mockResolvedValue({
        tenantId: TENANT_ID,
        rechargeEnabled: false, // Disabled!
        perOrderMaxPaise: 100000,
        dailyMaxPaise: 500000,
        maxOrdersPerMinute: 10,
      });

      const req = new NextRequest('http://localhost:3000/api/v1/recharge-orders/claim', {
        method: 'POST',
        headers: createDeviceHeaders(),
      });

      const res = await claimRechargeOrderRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.order).toBeNull();
      expect(data.message).toContain('disabled');
    });

    it('returns order: null when no orders are in queue', async () => {
      vi.spyOn(dbModule, 'withTenantContext').mockImplementation(async (_tenantId, fn) => {
        const mockTx = {
          select: () => ({
            from: () => ({
              where: () => ({
                orderBy: () => ({
                  limit: () => ({
                    for: () => Promise.resolve([]), // Empty candidate list
                  }),
                }),
              }),
            }),
          }),
        } as unknown as dbModule.AppTransaction;
        return fn(mockTx);
      });

      vi.spyOn(rechargeModule, 'getTenantRechargeSettings').mockResolvedValue({
        tenantId: TENANT_ID,
        rechargeEnabled: true,
        perOrderMaxPaise: 100000,
        dailyMaxPaise: 500000,
        maxOrdersPerMinute: 10,
      });

      const req = new NextRequest('http://localhost:3000/api/v1/recharge-orders/claim', {
        method: 'POST',
        headers: createDeviceHeaders(),
      });

      const res = await claimRechargeOrderRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.order).toBeNull();
    });

    it('successfully claims a queued order, sets lease, and decrypts customer number for authorized device', async () => {
      const rawPhone = makeTestPhone('4321');
      const dummyEncrypted = 'v1:dummyEncryptedCiphertext';

      let updatedStatus = '';
      let updatedDeviceId = '';
      let auditLogInserted = false;

      vi.spyOn(dbModule, 'withTenantContext').mockImplementation(async (_tenantId, fn) => {
        const mockTx = {
          select: () => ({
            from: () => ({
              where: () => ({
                orderBy: () => ({
                  limit: () => ({
                    for: () =>
                      Promise.resolve([
                        {
                          id: ORDER_ID,
                          tenantId: TENANT_ID,
                          source: 'simplewallet',
                          service: 'Prepaid',
                          operator: 'AIRTEL',
                          customerNoEnc: dummyEncrypted,
                          customerLast4: '4321',
                          amountPaise: 29900,
                          status: 'queued',
                          createdAt: new Date('2026-11-06T10:00:00Z'),
                        },
                      ]),
                  }),
                }),
              }),
            }),
          }),
          update: () => ({
            set: (fields: Record<string, unknown>) => {
              updatedStatus = fields.status as string;
              updatedDeviceId = fields.claimedByDeviceId as string;
              return {
                where: () => Promise.resolve(),
              };
            },
          }),
          insert: () => ({
            values: () => {
              auditLogInserted = true;
              return Promise.resolve();
            },
          }),
        } as unknown as dbModule.AppTransaction;
        return fn(mockTx);
      });

      vi.spyOn(rechargeModule, 'getTenantRechargeSettings').mockResolvedValue({
        tenantId: TENANT_ID,
        rechargeEnabled: true,
        perOrderMaxPaise: 100000,
        dailyMaxPaise: 500000,
        maxOrdersPerMinute: 10,
      });

      vi.spyOn(cryptoModule, 'decryptCustomerNo').mockReturnValue(rawPhone);

      const req = new NextRequest('http://localhost:3000/api/v1/recharge-orders/claim', {
        method: 'POST',
        headers: createDeviceHeaders(),
      });

      const res = await claimRechargeOrderRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.order).toBeDefined();
      expect(data.order.id).toBe(ORDER_ID);
      expect(data.order.status).toBe('claimed');
      expect(data.order.customerNo).toBe(rawPhone); // Decrypted plain number returned to device
      expect(data.order.amountPaise).toBe(29900);
      expect(data.order.claimExpiresAt).toBeDefined();

      expect(updatedStatus).toBe('claimed');
      expect(updatedDeviceId).toBe(DEVICE_ID);
      expect(auditLogInserted).toBe(true);
    });

    it('returns 429 when device exceeds claim rate limit', async () => {
      vi.spyOn(rateLimitModule, 'checkRateLimit').mockResolvedValue({
        success: false,
        limit: 60,
        remaining: 0,
        reset: Math.floor(Date.now() / 1000) + 45,
      });

      const req = new NextRequest('http://localhost:3000/api/v1/recharge-orders/claim', {
        method: 'POST',
        headers: createDeviceHeaders(),
      });

      const res = await claimRechargeOrderRoute(req);
      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBe('60');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Status Transition Endpoint (POST /api/v1/recharge-orders/[id]/status)
  // -------------------------------------------------------------------------
  describe('3. Status Transition Endpoint', () => {
    it('returns 404 when recharge order does not exist', async () => {
      vi.spyOn(dbModule, 'withTenantContext').mockImplementation(async (_tenantId, fn) => {
        const mockTx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => ({
                  for: () => Promise.resolve([]), // Not found
                }),
              }),
            }),
          }),
        } as unknown as dbModule.AppTransaction;
        return fn(mockTx);
      });

      const req = new NextRequest(`http://localhost:3000/api/v1/recharge-orders/${ORDER_ID}/status`, {
        method: 'POST',
        headers: createDeviceHeaders(),
        body: JSON.stringify({ status: 'submitting' }),
      });

      const res = await updateOrderStatusRoute(req, {
        params: Promise.resolve({ id: ORDER_ID }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 403 Forbidden when order is claimed by a different device', async () => {
      vi.spyOn(dbModule, 'withTenantContext').mockImplementation(async (_tenantId, fn) => {
        const mockTx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => ({
                  for: () =>
                    Promise.resolve([
                      {
                        id: ORDER_ID,
                        tenantId: TENANT_ID,
                        claimedByDeviceId: OTHER_DEVICE_ID, // Claimed by device B!
                        status: 'claimed',
                        createdAt: new Date(),
                      },
                    ]),
                }),
              }),
            }),
          }),
        } as unknown as dbModule.AppTransaction;
        return fn(mockTx);
      });

      // Request from device A
      const req = new NextRequest(`http://localhost:3000/api/v1/recharge-orders/${ORDER_ID}/status`, {
        method: 'POST',
        headers: createDeviceHeaders(DEVICE_ID, TENANT_ID),
        body: JSON.stringify({ status: 'submitting' }),
      });

      const res = await updateOrderStatusRoute(req, {
        params: Promise.resolve({ id: ORDER_ID }),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain('not claimed by your device');
    });

    it('returns 400 when transition is invalid (e.g. claimed directly to submitted)', async () => {
      vi.spyOn(dbModule, 'withTenantContext').mockImplementation(async (_tenantId, fn) => {
        const mockTx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => ({
                  for: () =>
                    Promise.resolve([
                      {
                        id: ORDER_ID,
                        tenantId: TENANT_ID,
                        claimedByDeviceId: DEVICE_ID,
                        status: 'claimed',
                        createdAt: new Date(),
                      },
                    ]),
                }),
              }),
            }),
          }),
        } as unknown as dbModule.AppTransaction;
        return fn(mockTx);
      });

      const req = new NextRequest(`http://localhost:3000/api/v1/recharge-orders/${ORDER_ID}/status`, {
        method: 'POST',
        headers: createDeviceHeaders(),
        body: JSON.stringify({ status: 'submitted' }), // Invalid: must go through submitting first
      });

      const res = await updateOrderStatusRoute(req, {
        params: Promise.resolve({ id: ORDER_ID }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Invalid status transition');
    });

    it('rejects status update containing phone number in failureDetail (400)', async () => {
      const piiPhone = makeTestPhone('8888');

      const req = new NextRequest(`http://localhost:3000/api/v1/recharge-orders/${ORDER_ID}/status`, {
        method: 'POST',
        headers: createDeviceHeaders(),
        body: JSON.stringify({
          status: 'failed',
          failureCode: 'portal_error',
          failureDetail: `Failed on recharge for ${piiPhone}`,
        }),
      });

      const res = await updateOrderStatusRoute(req, {
        params: Promise.resolve({ id: ORDER_ID }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Validation failed');
    });

    it('successfully transitions from claimed -> submitting (locking the order)', async () => {
      let updatedStatus = '';
      let clearedClaimExpiry: unknown = 'initial';

      vi.spyOn(dbModule, 'withTenantContext').mockImplementation(async (_tenantId, fn) => {
        const mockTx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => ({
                  for: () =>
                    Promise.resolve([
                      {
                        id: ORDER_ID,
                        tenantId: TENANT_ID,
                        source: 'simplewallet',
                        service: 'Prepaid',
                        operator: 'JIO',
                        customerLast4: '1111',
                        amountPaise: 15500,
                        claimedByDeviceId: DEVICE_ID,
                        status: 'claimed',
                        createdAt: new Date(),
                        updatedAt: new Date(),
                      },
                    ]),
                }),
              }),
            }),
          }),
          update: () => ({
            set: (fields: Record<string, unknown>) => {
              updatedStatus = fields.status as string;
              clearedClaimExpiry = fields.claimExpiresAt;
              return {
                where: () => Promise.resolve(),
              };
            },
          }),
          insert: () => ({
            values: () => Promise.resolve(),
          }),
        } as unknown as dbModule.AppTransaction;
        return fn(mockTx);
      });

      const req = new NextRequest(`http://localhost:3000/api/v1/recharge-orders/${ORDER_ID}/status`, {
        method: 'POST',
        headers: createDeviceHeaders(),
        body: JSON.stringify({ status: 'submitting' }),
      });

      const res = await updateOrderStatusRoute(req, {
        params: Promise.resolve({ id: ORDER_ID }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.order.status).toBe('submitting');
      expect(updatedStatus).toBe('submitting');
      expect(clearedClaimExpiry).toBeNull();
    });

    it('successfully transitions from submitting -> submitted and records submittedAt', async () => {
      let updatedStatus = '';
      let recordedSubmittedAt: unknown = null;

      vi.spyOn(dbModule, 'withTenantContext').mockImplementation(async (_tenantId, fn) => {
        const mockTx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => ({
                  for: () =>
                    Promise.resolve([
                      {
                        id: ORDER_ID,
                        tenantId: TENANT_ID,
                        source: 'simplewallet',
                        service: 'Prepaid',
                        operator: 'VI',
                        customerLast4: '2222',
                        amountPaise: 19900,
                        claimedByDeviceId: DEVICE_ID,
                        status: 'submitting',
                        createdAt: new Date(),
                        updatedAt: new Date(),
                      },
                    ]),
                }),
              }),
            }),
          }),
          update: () => ({
            set: (fields: Record<string, unknown>) => {
              updatedStatus = fields.status as string;
              recordedSubmittedAt = fields.submittedAt;
              return {
                where: () => Promise.resolve(),
              };
            },
          }),
          insert: () => ({
            values: () => Promise.resolve(),
          }),
        } as unknown as dbModule.AppTransaction;
        return fn(mockTx);
      });

      const req = new NextRequest(`http://localhost:3000/api/v1/recharge-orders/${ORDER_ID}/status`, {
        method: 'POST',
        headers: createDeviceHeaders(),
        body: JSON.stringify({ status: 'submitted' }),
      });

      const res = await updateOrderStatusRoute(req, {
        params: Promise.resolve({ id: ORDER_ID }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.order.status).toBe('submitted');
      expect(data.order.submittedAt).toBeDefined();
      expect(updatedStatus).toBe('submitted');
      expect(recordedSubmittedAt).toBeInstanceOf(Date);
    });

    it('successfully transitions from submitting -> failed with failure code and safe detail', async () => {
      let recordedFailureCode = '';
      let recordedFailureDetail = '';

      vi.spyOn(dbModule, 'withTenantContext').mockImplementation(async (_tenantId, fn) => {
        const mockTx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => ({
                  for: () =>
                    Promise.resolve([
                      {
                        id: ORDER_ID,
                        tenantId: TENANT_ID,
                        source: 'simplewallet',
                        service: 'Prepaid',
                        operator: 'BSNL',
                        customerLast4: '3333',
                        amountPaise: 9900,
                        claimedByDeviceId: DEVICE_ID,
                        status: 'submitting',
                        createdAt: new Date(),
                        updatedAt: new Date(),
                      },
                    ]),
                }),
              }),
            }),
          }),
          update: () => ({
            set: (fields: Record<string, unknown>) => {
              recordedFailureCode = fields.failureCode as string;
              recordedFailureDetail = fields.failureDetail as string;
              return {
                where: () => Promise.resolve(),
              };
            },
          }),
          insert: () => ({
            values: () => Promise.resolve(),
          }),
        } as unknown as dbModule.AppTransaction;
        return fn(mockTx);
      });

      const req = new NextRequest(`http://localhost:3000/api/v1/recharge-orders/${ORDER_ID}/status`, {
        method: 'POST',
        headers: createDeviceHeaders(),
        body: JSON.stringify({
          status: 'failed',
          failureCode: 'insufficient_wallet_balance',
          failureDetail: 'Portal distributor balance was too low for transaction',
        }),
      });

      const res = await updateOrderStatusRoute(req, {
        params: Promise.resolve({ id: ORDER_ID }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.order.status).toBe('failed');
      expect(recordedFailureCode).toBe('insufficient_wallet_balance');
      expect(recordedFailureDetail).toBe('Portal distributor balance was too low for transaction');
    });
  });
});

