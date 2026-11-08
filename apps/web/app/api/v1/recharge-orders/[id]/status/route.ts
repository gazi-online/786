import { NextRequest, NextResponse } from 'next/server';
import { withTenantContext } from '@/lib/db';
import { rechargeOrders, auditLog } from '@/drizzle/schema';
import {
  UpdateOrderStatusRequestSchema,
  isValidRechargeTransition,
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
  // 1. Authenticate device (DB-only, strict non-revocation check)
  const auth = await verifyDeviceForRecharge(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: CORS_HEADERS });
  }

  const device = auth.device;
  const { id: orderId } = await context.params;

  // 2. Validate request body against schema
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400, headers: CORS_HEADERS });
  }

  const parseResult = UpdateOrderStatusRequestSchema.safeParse(bodyJson);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        details: parseResult.error.flatten(),
      },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const { status: nextStatus, failureCode, failureDetail } = parseResult.data;
  const now = new Date();

  // 3. Execute state transition within tenant context with row lock
  try {
    return await withTenantContext(device.tenantId, async (tx) => {
      // Find the order with FOR UPDATE lock
      const existingOrders = await tx
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

      if (existingOrders.length === 0 || !existingOrders[0]) {
        return NextResponse.json(
          { error: 'Not Found: Recharge order does not exist' },
          { status: 404 },
        );
      }

      const order = existingOrders[0];

      // Verify device ownership: device can only transition orders it has claimed
      if (order.claimedByDeviceId !== device.id) {
        return NextResponse.json(
          {
            error: 'Forbidden: This recharge order is not claimed by your device',
          },
          { status: 403 },
        );
      }

      // Verify valid state transition according to pure state machine
      if (!isValidRechargeTransition(order.status, nextStatus)) {
        return NextResponse.json(
          {
            error: `Invalid status transition: Cannot transition recharge order from '${order.status}' to '${nextStatus}'`,
          },
          { status: 400 },
        );
      }

      // Build update fields based on destination status
      const updateFields: {
        status: typeof nextStatus;
        updatedAt: Date;
        submittedAt?: Date;
        failureCode?: string | null;
        failureDetail?: string | null;
        claimExpiresAt?: Date | null;
      } = {
        status: nextStatus,
        updatedAt: now,
      };

      if (nextStatus === 'submitting') {
        // Order entered submission; permanently prevent re-leasing
        updateFields.claimExpiresAt = null;
      } else if (nextStatus === 'submitted') {
        updateFields.submittedAt = now;
        updateFields.claimExpiresAt = null;
      } else if (nextStatus === 'failed') {
        updateFields.failureCode = failureCode || null;
        updateFields.failureDetail = failureDetail || null;
        updateFields.claimExpiresAt = null;
      } else if (nextStatus === 'needs_manual_action') {
        updateFields.failureCode = failureCode || null;
        updateFields.failureDetail = failureDetail || null;
        updateFields.claimExpiresAt = null;
      }

      await tx
        .update(rechargeOrders)
        .set(updateFields)
        .where(eq(rechargeOrders.id, order.id));

      // Record audit log entry for the transition
      await tx.insert(auditLog).values({
        tenantId: device.tenantId,
        actorId: device.id,
        action: 'device_update_recharge_status',
        targetType: 'recharge_orders',
        targetId: order.id,
        meta: {
          deviceId: device.id,
          previousStatus: order.status,
          nextStatus,
          failureCode: failureCode || null,
        },
        createdAt: now,
      });

      broadcastSseEvent('recharge_order.updated', {
        orderId: order.id,
        status: nextStatus,
        failureCode: failureCode || null,
        failureDetail: failureDetail || null,
      });

      return NextResponse.json(
        {
          order: {
            id: order.id,
            source: order.source,
            service: order.service,
            operator: order.operator,
            customerNoMasked: `••••••${order.customerLast4}`,
            customerLast4: order.customerLast4,
            amountPaise: order.amountPaise,
            status: nextStatus,
            claimedByDeviceId: order.claimedByDeviceId,
            submittedAt: updateFields.submittedAt?.toISOString() || order.submittedAt?.toISOString() || null,
            failureCode: updateFields.failureCode ?? order.failureCode ?? null,
            failureDetail: updateFields.failureDetail ?? order.failureDetail ?? null,
            createdAt: order.createdAt.toISOString(),
            updatedAt: now.toISOString(),
          },
        },
        { status: 200, headers: CORS_HEADERS },
      );
    });
  } catch (err) {
    console.error('[Recharge Status] Database error during status transition:', err);
    return NextResponse.json(
      { error: 'Service Unavailable: Database error during status update' },
      { status: 503, headers: CORS_HEADERS },
    );
  }
}

