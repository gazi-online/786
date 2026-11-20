import { NextRequest, NextResponse } from 'next/server';
import { getTenantSession } from '@/lib/auth';
import { withTenantContext } from '@/lib/db';
import { rechargeOrders, rechargeOrderEvents } from '@/drizzle/schema';
import { decryptCustomerNo } from '@/lib/crypto';
import { eq, and, asc } from 'drizzle-orm';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, context: RouteContext) {
  const session = await getTenantSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: orderId } = await context.params;

  try {
    return await withTenantContext(session.tenant.id, async (tx) => {
      const orders = await tx
        .select()
        .from(rechargeOrders)
        .where(
          and(
            eq(rechargeOrders.id, orderId),
            eq(rechargeOrders.tenantId, session.tenant.id),
          ),
        )
        .limit(1);

      if (!orders[0]) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }

      const order = orders[0];

      // Fetch audit events
      const events = await tx
        .select()
        .from(rechargeOrderEvents)
        .where(
          and(
            eq(rechargeOrderEvents.orderId, order.id),
            eq(rechargeOrderEvents.tenantId, session.tenant.id),
          ),
        )
        .orderBy(asc(rechargeOrderEvents.createdAt));

      let decryptedMobile = order.customerLast4;
      try {
        const full = decryptCustomerNo(order.customerNoEnc, session.tenant.id);
        if (full.startsWith('{')) {
          const parsed = JSON.parse(full);
          decryptedMobile = parsed.customerNo || order.customerLast4;
        } else {
          decryptedMobile = full;
        }
      } catch {
        // ignore decryption error on masked fallback
      }

      return NextResponse.json({
        job: {
          id: order.id,
          source: order.source,
          service: order.service,
          operator: order.operator,
          circle: order.circle,
          customerNo: decryptedMobile,
          customerLast4: order.customerLast4,
          amountPaise: order.amountPaise,
          expectedPayablePaise: order.expectedPayablePaise,
          actualPayablePaise: order.actualPayablePaise,
          status: order.status,
          statusReason: order.statusReason,
          qrImageUrl: order.qrImageUrl,
          qrExpiresAt: order.qrExpiresAt?.toISOString() || null,
          portalTxnRef: order.portalTxnRef,
          dryRun: order.dryRun,
          attemptCount: order.attemptCount,
          createdAt: order.createdAt.toISOString(),
          updatedAt: order.updatedAt.toISOString(),
          events: events.map((e) => ({
            id: e.id,
            fromStatus: e.fromStatus,
            toStatus: e.toStatus,
            actor: e.actor,
            detail: e.detail,
            createdAt: e.createdAt.toISOString(),
          })),
        },
      });
    });
  } catch (err) {
    console.error('[Get Job API] Error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
