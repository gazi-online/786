import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createRechargeOrderRoute } from '../app/api/v1/recharge-orders/route';
import { POST as claimRechargeOrderRoute } from '../app/api/v1/recharge-orders/claim/route';
import { POST as updateOrderStatusRoute } from '../app/api/v1/recharge-orders/[id]/status/route';
import { reconcileTransactionWithRechargeOrder } from '@/lib/reconciliation';
import * as dbModule from '@/lib/db';
import * as rechargeModule from '@/lib/recharge';
import * as rateLimitModule from '@/lib/rate-limit';
import { hashCustomerNo } from '@/lib/crypto';
import type { RechargeOrderStatus } from '@walletsync/contract';

// Dynamic test phone in safe 5xxxxxxxxx non-Indian range
function makeTestPhone(suffix = '9999'): string {
  return ['5', '0', '0', '0', '0', '0', suffix].join('');
}

describe('Recharge From Web App: Full End-to-End Lifecycle Simulation', () => {
  const TENANT_ID = '11111111-1111-1111-1111-111111111111';
  const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const DEVICE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const ORDER_ID = '77777777-7777-7777-7777-777777777777';
  const TXN_ID = '88888888-8888-8888-8888-888888888888';

  const customerNo = makeTestPhone('4444');
  const customerNoHash = hashCustomerNo(customerNo);
  const amountPaise = 29900;

  // In-memory state tracking the order through its entire lifecycle
  let currentOrder: {
    id: string;
    tenantId: string;
    source: 'simplewallet' | 'egpayment';
    service: string;
    operator: string;
    customerNoEnc: string;
    customerNoHash: string;
    customerLast4: string;
    amountPaise: number;
    status: RechargeOrderStatus;
    claimedByDeviceId: string | null;
    claimExpiresAt: Date | null;
    submittedAt: Date | null;
    matchedTransactionId: string | null;
    reconciledAt: Date | null;
    failureCode: string | null;
    failureDetail: string | null;
    createdAt: Date;
    updatedAt: Date;
  };

  const auditEvents: any[] = [];

  beforeEach(() => {
    process.env.ALLOW_TEST_HEADER_AUTH = 'true';
    auditEvents.length = 0;

    vi.spyOn(rateLimitModule, 'checkRateLimit').mockResolvedValue({
      success: true,
      limit: 60,
      remaining: 59,
      reset: Math.floor(Date.now() / 1000) + 60,
    });

    vi.spyOn(rechargeModule, 'getTenantRechargeSettings').mockResolvedValue({
      tenantId: TENANT_ID,
      rechargeEnabled: true,
      perOrderMaxPaise: 100000,
      dailyMaxPaise: 500000,
      maxOrdersPerMinute: 10,
    });

    vi.spyOn(rechargeModule, 'getTodayActiveRechargeTotalPaise').mockResolvedValue(0);
    vi.spyOn(rechargeModule, 'findRecentDuplicateOrder').mockResolvedValue(false);

    vi.spyOn(rechargeModule, 'verifyDeviceForRecharge').mockResolvedValue({
      ok: true,
      device: {
        id: DEVICE_ID,
        tenantId: TENANT_ID,
        label: 'Main Terminal',
      },
    });

    // Mock withTenantContext to operate on our stateful test order
    vi.spyOn(dbModule, 'withTenantContext').mockImplementation(async (tenantId, callback: any) => {
      const mockTx: any = {
        execute: vi.fn().mockImplementation(async () => []),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                for: vi.fn().mockImplementation(async () => {
                  return currentOrder ? [currentOrder] : [];
                }),
              }),
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  for: vi.fn().mockImplementation(async () => {
                    return currentOrder ? [currentOrder] : [];
                  }),
                }),
              }),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockImplementation((val) => {
            if (val.action) {
              auditEvents.push(val);
              return Promise.resolve();
            }
            // Insert recharge order
            currentOrder = {
              ...val,
              id: ORDER_ID,
              status: 'queued',
              claimedByDeviceId: null,
              claimExpiresAt: null,
              submittedAt: null,
              matchedTransactionId: null,
              reconciledAt: null,
              failureCode: null,
              failureDetail: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            return {
              returning: () => [currentOrder],
            };
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockImplementation((updates) => ({
            where: vi.fn().mockImplementation(() => {
              if (currentOrder) {
                Object.assign(currentOrder, updates);
              }
              return {
                returning: () => [currentOrder],
              };
            }),
          })),
        }),
      };

      return await callback(mockTx);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs the complete 5-step lifecycle: create -> claim -> submitting -> submitted -> reconcile success', async () => {
    // -------------------------------------------------------------------------
    // STEP 1: Web Dashboard submits new recharge order
    // -------------------------------------------------------------------------
    const createReq = new NextRequest('http://localhost:3000/api/v1/recharge-orders', {
      method: 'POST',
      headers: {
        'x-test-role': 'owner',
        'x-test-tenant-id': TENANT_ID,
        'x-test-user-id': USER_ID,
        'idempotency-key': 'E2E-KEY-1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        source: 'simplewallet',
        service: 'Prepaid',
        operator: 'AIRTEL',
        customerNo,
        amountPaise,
        confirmDuplicate: false,
      }),
    });

    const createRes = await createRechargeOrderRoute(createReq);
    expect(createRes.status).toBe(201);
    const createData = await createRes.json();
    expect(createData.order.status).toBe('queued');
    expect(createData.order.customerLast4).toBe(customerNo.slice(-4));
    expect(currentOrder.status).toBe('queued');

    // -------------------------------------------------------------------------
    // STEP 2: POS Terminal claims the queued order
    // -------------------------------------------------------------------------
    const claimReq = new NextRequest('http://localhost:3000/api/v1/recharge-orders/claim', {
      method: 'POST',
      headers: {
        'x-test-device-id': DEVICE_ID,
        'x-test-tenant-id': TENANT_ID,
      },
    });

    const claimRes = await claimRechargeOrderRoute(claimReq);
    expect(claimRes.status).toBe(200);
    const claimData = await claimRes.json();
    expect(claimData.order).not.toBeNull();
    expect(claimData.order.id).toBe(ORDER_ID);
    expect(claimData.order.operator).toBe('AIRTEL');
    expect(claimData.order.amountPaise).toBe(amountPaise);
    expect(currentOrder.status).toBe('claimed');
    expect(currentOrder.claimedByDeviceId).toBe(DEVICE_ID);

    // -------------------------------------------------------------------------
    // STEP 3: Extension tab opens and status transitions to 'submitting'
    // -------------------------------------------------------------------------
    const submittingReq = new NextRequest(`http://localhost:3000/api/v1/recharge-orders/${ORDER_ID}/status`, {
      method: 'POST',
      headers: {
        'x-test-device-id': DEVICE_ID,
        'x-test-tenant-id': TENANT_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        status: 'submitting',
      }),
    });

    const submittingRes = await updateOrderStatusRoute(submittingReq, {
      params: Promise.resolve({ id: ORDER_ID }),
    });
    expect(submittingRes.status).toBe(200);
    expect(currentOrder.status).toBe('submitting');

    // -------------------------------------------------------------------------
    // STEP 4: Content script executes DOM form and reports 'submitted'
    // -------------------------------------------------------------------------
    const submittedReq = new NextRequest(`http://localhost:3000/api/v1/recharge-orders/${ORDER_ID}/status`, {
      method: 'POST',
      headers: {
        'x-test-device-id': DEVICE_ID,
        'x-test-tenant-id': TENANT_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        status: 'submitted',
      }),
    });

    const submittedRes = await updateOrderStatusRoute(submittedReq, {
      params: Promise.resolve({ id: ORDER_ID }),
    });
    expect(submittedRes.status).toBe(200);
    expect(currentOrder.status).toBe('submitted');
    expect(currentOrder.submittedAt).toBeInstanceOf(Date);

    // -------------------------------------------------------------------------
    // STEP 5: Later portal ingest sync matches transaction and reconciles order
    // -------------------------------------------------------------------------
    const mockTx: any = {
      execute: vi.fn().mockImplementation(async () => []),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValue([currentOrder]),
              }),
            }),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockImplementation((updates) => ({
          where: vi.fn().mockImplementation(() => {
            Object.assign(currentOrder, updates);
            return Promise.resolve();
          }),
        })),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((val) => {
          auditEvents.push(val);
          return Promise.resolve();
        }),
      }),
    };

    const reconciliation = await reconcileTransactionWithRechargeOrder(mockTx, TENANT_ID, {
      id: TXN_ID,
      source: 'simplewallet',
      customerNoHash,
      amountPaise,
      status: 'success',
      occurredAt: new Date(),
    });

    expect(reconciliation.matched).toBe(true);
    expect(reconciliation.orderId).toBe(ORDER_ID);
    expect(reconciliation.orderStatus).toBe('success');

    // Order reaches terminal success state with transaction link
    expect(currentOrder.status).toBe('success');
    expect(currentOrder.matchedTransactionId).toBe(TXN_ID);
    expect(currentOrder.reconciledAt).toBeInstanceOf(Date);

    // Verify audit trail integrity across the whole lifecycle
    const actions = auditEvents.map((a) => a.action);
    expect(actions).toContain('create_recharge_order');
    expect(actions).toContain('claim_recharge_order');
    expect(actions).toContain('device_update_recharge_status');
    expect(actions).toContain('reconcile_recharge_order');
  });
});
