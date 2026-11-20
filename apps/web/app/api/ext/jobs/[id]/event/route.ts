import { NextRequest, NextResponse } from 'next/server';
import { withTenantContext } from '@/lib/db';
import { rechargeOrders, rechargeOrderEvents, auditLog } from '@/drizzle/schema';
import {
  ReportJobEventRequestSchema,
  isValidRechargeTransition,
  type RechargeOrderStatus,
} from '@walletsync/contract';
import { verifyDeviceForRecharge } from '@/lib/recharge';
import { broadcastSseEvent } from '@/lib/sse';
import { eq, and } from 'drizzle-orm';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-requested-with',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, context: RouteContext) {
  const auth = await verifyDeviceForRecharge(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: CORS_HEADERS });
  }

  const device = auth.device;
  const { id: orderId } = await context.params;

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400, headers: CORS_HEADERS });
  }

  const parseResult = ReportJobEventRequestSchema.safeParse(bodyJson);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parseResult.error.flatten() },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const { toStatus, actor, detail } = parseResult.data;
  const now = new Date();

  try {
    return await withTenantContext(device.tenantId, async (tx) => {
      const existing = await tx
        .select()
        .from(rechargeOrders)
        .where(
          and(
            eq(rechargeOrders.id, orderId),
            eq(rechargeOrders.tenantId, device.tenantId),
          ),
        )
        .limit(1)
        .for('update');

      if (!existing[0]) {
        return NextResponse.json({ error: 'Not Found: Order does not exist' }, { status: 404, headers: CORS_HEADERS });
      }

      const order = existing[0];
      if (order.claimedByDeviceId !== device.id) {
        return NextResponse.json({ error: 'Forbidden: Order claimed by another device' }, { status: 403, headers: CORS_HEADERS });
      }

      if (!isValidRechargeTransition(order.status as RechargeOrderStatus, toStatus)) {
        return NextResponse.json(
          {
            error: 'Conflict: Illegal state transition',
            currentStatus: order.status,
            requestedStatus: toStatus,
          },
          { status: 409, headers: CORS_HEADERS },
        );
      }

      const updateData: Record<string, unknown> = {
        status: toStatus,
        updatedAt: now,
      };

      if (toStatus === 'submitted' || toStatus === 'payment_submitted') {
        updateData.submittedAt = now;
        updateData.claimExpiresAt = null;
      } else if (toStatus === 'needs_review' || toStatus === 'needs_manual_action' || toStatus === 'failed') {
        updateData.statusReason = detail?.reason || detail?.message || null;
        updateData.failureDetail = detail?.reason || detail?.message || null;
        updateData.claimExpiresAt = null;
      }

      if (detail?.portalTxnRef) {
        updateData.portalTxnRef = detail.portalTxnRef;
      }

      await tx.update(rechargeOrders).set(updateData).where(eq(rechargeOrders.id, order.id));

      await tx.insert(rechargeOrderEvents).values({
        tenantId: device.tenantId,
        orderId: order.id,
        fromStatus: order.status,
        toStatus,
        actor,
        detail: detail || null,
        createdAt: now,
      });

      await tx.insert(auditLog).values({
        tenantId: device.tenantId,
        actorId: device.id,
        action: 'report_job_event',
        targetType: 'recharge_orders',
        targetId: order.id,
        meta: {
          previousStatus: order.status,
          toStatus,
          actor,
          detail: detail || null,
        },
        createdAt: now,
      });

      broadcastSseEvent('recharge_order.updated', {
        orderId: order.id,
        status: toStatus,
        detail: detail || null,
      });

      return NextResponse.json({
        success: true,
        order: {
          id: order.id,
          status: toStatus,
          updatedAt: now.toISOString(),
        },
      }, { status: 200, headers: CORS_HEADERS });
    });
  } catch (err) {
    console.error('[Job Event API] Error reporting transition:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: CORS_HEADERS });
  }
}
