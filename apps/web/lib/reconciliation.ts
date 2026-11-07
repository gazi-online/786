import { eq, and, isNull, sql } from 'drizzle-orm';
import { type AppTransaction } from '@/lib/db';
import { rechargeOrders, auditLog } from '@/drizzle/schema';
import { isValidRechargeTransition, type RechargeOrderStatus } from '@walletsync/contract';

export interface ReconciliationResult {
  matched: boolean;
  orderId?: string;
  orderStatus?: RechargeOrderStatus;
}

/**
 * Reconciles an ingested portal transaction with pending recharge orders.
 * Matches: tenantId, source, customerNoHash, amountPaise.
 * Target order must have matchedTransactionId IS NULL and status IN ('submitting', 'submitted', 'unknown').
 */
export async function reconcileTransactionWithRechargeOrder(
  tx: AppTransaction,
  tenantId: string,
  txn: {
    id: string;
    source: 'simplewallet' | 'egpayment';
    customerNoHash: string;
    amountPaise: number;
    status: 'success' | 'failed' | 'pending' | 'refunded' | 'unknown';
    occurredAt: Date;
  },
): Promise<ReconciliationResult> {
  const now = new Date();

  try {
    await tx.execute(sql`SAVEPOINT sp_reconcile`);

    // Find candidate order within tenant context with lock
    const candidateOrders = await tx
      .select()
      .from(rechargeOrders)
      .where(
        and(
          eq(rechargeOrders.tenantId, tenantId),
          eq(rechargeOrders.source, txn.source),
          eq(rechargeOrders.customerNoHash, txn.customerNoHash),
          eq(rechargeOrders.amountPaise, txn.amountPaise),
          isNull(rechargeOrders.matchedTransactionId),
          sql`${rechargeOrders.status} IN ('submitting', 'submitted', 'unknown')`,
        ),
      )
      .orderBy(rechargeOrders.createdAt)
      .limit(1)
      .for('update', { skipLocked: true });

    if (candidateOrders.length === 0 || !candidateOrders[0]) {
      await tx.execute(sql`RELEASE SAVEPOINT sp_reconcile`).catch(() => {});
      return { matched: false };
    }

    const order = candidateOrders[0];
    let targetOrderStatus: RechargeOrderStatus | null = null;

    if (txn.status === 'success') {
      targetOrderStatus = 'success';
    } else if (txn.status === 'failed') {
      targetOrderStatus = 'failed';
    }

    if (!targetOrderStatus) {
      // If transaction is still pending/unknown, link matchedTransactionId without marking terminal
      await tx
        .update(rechargeOrders)
        .set({
          matchedTransactionId: txn.id,
          updatedAt: now,
        })
        .where(eq(rechargeOrders.id, order.id));

      await tx.execute(sql`RELEASE SAVEPOINT sp_reconcile`).catch(() => {});
      return {
        matched: true,
        orderId: order.id,
        orderStatus: order.status,
      };
    }

    // Ensure state machine compliance
    if (!isValidRechargeTransition(order.status, targetOrderStatus)) {
      // If order was in 'submitting', first complete submitting -> submitted
      if (order.status === 'submitting') {
        await tx
          .update(rechargeOrders)
          .set({
            status: 'submitted',
            submittedAt: now,
            updatedAt: now,
          })
          .where(eq(rechargeOrders.id, order.id));
      }
    }

    // Final transition to terminal success / failed with reconciliation timestamp
    await tx
      .update(rechargeOrders)
      .set({
        status: targetOrderStatus,
        matchedTransactionId: txn.id,
        reconciledAt: now,
        updatedAt: now,
      })
      .where(eq(rechargeOrders.id, order.id));

    // Audit log the reconciliation event
    await tx.insert(auditLog).values({
      tenantId,
      actorId: null,
      action: 'reconcile_recharge_order',
      targetType: 'recharge_orders',
      targetId: order.id,
      meta: {
        matchedTransactionId: txn.id,
        portalStatus: txn.status,
        finalOrderStatus: targetOrderStatus,
      },
      createdAt: now,
    });

    await tx.execute(sql`RELEASE SAVEPOINT sp_reconcile`).catch(() => {});

    return {
      matched: true,
      orderId: order.id,
      orderStatus: targetOrderStatus,
    };
  } catch {
    await tx.execute(sql`ROLLBACK TO SAVEPOINT sp_reconcile`).catch(() => {});
    return { matched: false };
  }
}
