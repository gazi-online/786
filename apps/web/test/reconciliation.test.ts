import { describe, it, expect, vi } from 'vitest';
import { reconcileTransactionWithRechargeOrder } from '@/lib/reconciliation';
import type { AppTransaction } from '@/lib/db';
import { hashCustomerNo } from '@/lib/crypto';

// Dynamic test phone in safe 5xxxxxxxxx non-Indian range
function makeTestPhone(suffix = '1111'): string {
  return ['5', '5', '5', '0', '0', '0', suffix].join('');
}

describe('Milestone R4: Portal Ingest Reconciliation Engine', () => {
  const TENANT_ID = '11111111-1111-1111-1111-111111111111';
  const OTHER_TENANT_ID = '22222222-2222-2222-2222-222222222222';
  const ORDER_ID = '33333333-3333-3333-3333-333333333333';
  const TXN_ID = '44444444-4444-4444-4444-444444444444';

  const customerNo = makeTestPhone('8888');
  const customerNoHash = hashCustomerNo(customerNo);
  const amountPaise = 29900;

  function createMockTx(candidateOrder: any = null) {
    const updates: any[] = [];
    const inserts: any[] = [];
    const executes: any[] = [];

    const mockTx: Partial<AppTransaction> = {
      execute: vi.fn().mockImplementation(async (query) => {
        executes.push(query);
        return [];
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValue(candidateOrder ? [candidateOrder] : []),
              }),
            }),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockImplementation((val) => ({
          where: vi.fn().mockImplementation((cond) => {
            updates.push({ val, cond });
            return Promise.resolve();
          }),
        })),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((val) => {
          inserts.push(val);
          return Promise.resolve();
        }),
      }),
    };

    return {
      tx: mockTx as AppTransaction,
      updates,
      inserts,
      executes,
    };
  }

  it('reconciles submitted order to success when portal transaction is success', async () => {
    const candidate = {
      id: ORDER_ID,
      tenantId: TENANT_ID,
      source: 'simplewallet',
      customerNoHash,
      amountPaise,
      status: 'submitted',
      matchedTransactionId: null,
      createdAt: new Date(),
    };

    const { tx, updates, inserts } = createMockTx(candidate);

    const result = await reconcileTransactionWithRechargeOrder(tx, TENANT_ID, {
      id: TXN_ID,
      source: 'simplewallet',
      customerNoHash,
      amountPaise,
      status: 'success',
      occurredAt: new Date(),
    });

    expect(result.matched).toBe(true);
    expect(result.orderId).toBe(ORDER_ID);
    expect(result.orderStatus).toBe('success');

    // Should update order to status = success with matchedTransactionId and reconciledAt
    expect(updates.length).toBe(1);
    expect(updates[0].val.status).toBe('success');
    expect(updates[0].val.matchedTransactionId).toBe(TXN_ID);
    expect(updates[0].val.reconciledAt).toBeInstanceOf(Date);

    // Should insert audit log
    expect(inserts.length).toBe(1);
    expect(inserts[0].action).toBe('reconcile_recharge_order');
    expect(inserts[0].targetId).toBe(ORDER_ID);
    expect(inserts[0].meta.portalStatus).toBe('success');
    expect(inserts[0].meta.finalOrderStatus).toBe('success');
  });

  it('reconciles submitted order to failed when portal transaction is failed', async () => {
    const candidate = {
      id: ORDER_ID,
      tenantId: TENANT_ID,
      source: 'simplewallet',
      customerNoHash,
      amountPaise,
      status: 'submitted',
      matchedTransactionId: null,
      createdAt: new Date(),
    };

    const { tx, updates, inserts } = createMockTx(candidate);

    const result = await reconcileTransactionWithRechargeOrder(tx, TENANT_ID, {
      id: TXN_ID,
      source: 'simplewallet',
      customerNoHash,
      amountPaise,
      status: 'failed',
      occurredAt: new Date(),
    });

    expect(result.matched).toBe(true);
    expect(result.orderId).toBe(ORDER_ID);
    expect(result.orderStatus).toBe('failed');

    expect(updates.length).toBe(1);
    expect(updates[0].val.status).toBe('failed');
    expect(updates[0].val.matchedTransactionId).toBe(TXN_ID);
    expect(updates[0].val.reconciledAt).toBeInstanceOf(Date);

    expect(inserts.length).toBe(1);
    expect(inserts[0].action).toBe('reconcile_recharge_order');
    expect(inserts[0].meta.finalOrderStatus).toBe('failed');
  });

  it('handles submitting order by advancing to submitted then terminal status', async () => {
    const candidate = {
      id: ORDER_ID,
      tenantId: TENANT_ID,
      source: 'egpayment',
      customerNoHash,
      amountPaise,
      status: 'submitting',
      matchedTransactionId: null,
      createdAt: new Date(),
    };

    const { tx, updates, inserts } = createMockTx(candidate);

    const result = await reconcileTransactionWithRechargeOrder(tx, TENANT_ID, {
      id: TXN_ID,
      source: 'egpayment',
      customerNoHash,
      amountPaise,
      status: 'success',
      occurredAt: new Date(),
    });

    expect(result.matched).toBe(true);
    expect(result.orderId).toBe(ORDER_ID);
    expect(result.orderStatus).toBe('success');

    // First update was submitting -> submitted, second was submitted -> success
    expect(updates.length).toBe(2);
    expect(updates[0].val.status).toBe('submitted');
    expect(updates[1].val.status).toBe('success');
    expect(updates[1].val.matchedTransactionId).toBe(TXN_ID);
    expect(updates[1].val.reconciledAt).toBeInstanceOf(Date);
  });

  it('reconciles unknown order to success when portal transaction succeeds', async () => {
    const candidate = {
      id: ORDER_ID,
      tenantId: TENANT_ID,
      source: 'simplewallet',
      customerNoHash,
      amountPaise,
      status: 'unknown',
      matchedTransactionId: null,
      createdAt: new Date(),
    };

    const { tx, updates, inserts } = createMockTx(candidate);

    const result = await reconcileTransactionWithRechargeOrder(tx, TENANT_ID, {
      id: TXN_ID,
      source: 'simplewallet',
      customerNoHash,
      amountPaise,
      status: 'success',
      occurredAt: new Date(),
    });

    expect(result.matched).toBe(true);
    expect(result.orderId).toBe(ORDER_ID);
    expect(result.orderStatus).toBe('success');
    expect(updates[0].val.status).toBe('success');
  });

  it('links matchedTransactionId without changing order status when portal transaction is pending', async () => {
    const candidate = {
      id: ORDER_ID,
      tenantId: TENANT_ID,
      source: 'simplewallet',
      customerNoHash,
      amountPaise,
      status: 'submitted',
      matchedTransactionId: null,
      createdAt: new Date(),
    };

    const { tx, updates, inserts } = createMockTx(candidate);

    const result = await reconcileTransactionWithRechargeOrder(tx, TENANT_ID, {
      id: TXN_ID,
      source: 'simplewallet',
      customerNoHash,
      amountPaise,
      status: 'pending',
      occurredAt: new Date(),
    });

    expect(result.matched).toBe(true);
    expect(result.orderId).toBe(ORDER_ID);
    expect(result.orderStatus).toBe('submitted');

    // Status was NOT changed to terminal
    expect(updates.length).toBe(1);
    expect(updates[0].val.status).toBeUndefined();
    expect(updates[0].val.matchedTransactionId).toBe(TXN_ID);
    // Audit log for terminal reconciliation not fired yet
    expect(inserts.length).toBe(0);
  });

  it('returns matched: false when no candidate order exists', async () => {
    const { tx, updates, inserts } = createMockTx(null);

    const result = await reconcileTransactionWithRechargeOrder(tx, TENANT_ID, {
      id: TXN_ID,
      source: 'simplewallet',
      customerNoHash,
      amountPaise,
      status: 'success',
      occurredAt: new Date(),
    });

    expect(result.matched).toBe(false);
    expect(updates.length).toBe(0);
    expect(inserts.length).toBe(0);
  });

  it('safely rolls back savepoint and returns matched: false if query throws', async () => {
    const { tx } = createMockTx(null);
    vi.spyOn(tx, 'select').mockImplementation(() => {
      throw new Error('Database connection reset');
    });

    const result = await reconcileTransactionWithRechargeOrder(tx, TENANT_ID, {
      id: TXN_ID,
      source: 'simplewallet',
      customerNoHash,
      amountPaise,
      status: 'success',
      occurredAt: new Date(),
    });

    expect(result.matched).toBe(false);
  });
});

