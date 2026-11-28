import { NextRequest, NextResponse } from 'next/server';
import { getTenantSession, canPerformAction } from '@/lib/auth';
import { withTenantContext } from '@/lib/db';
import { broadcastSseEvent } from '@/lib/sse';
import { rechargeOrders, auditLog } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getTenantSession(req);
  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized: Authentication required' },
      { status: 401 },
    );
  }

  // Owner and admin allowed, viewer denied
  if (!canPerformAction(session.role, 'recharge:create')) {
    return NextResponse.json(
      { error: 'Forbidden: Insufficient permissions to cancel recharge orders' },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: 'Order ID is required' }, { status: 400 });
  }

  try {
    return await withTenantContext(session.tenant.id, async (tx) => {
      const now = new Date();

      // Single conditional atomic update without read-then-write
      const updatedRows = await tx
        .update(rechargeOrders)
        .set({
          status: 'cancelled',
          updatedAt: now,
        })
        .where(
          and(
            eq(rechargeOrders.id, id),
            eq(rechargeOrders.tenantId, session.tenant.id),
            eq(rechargeOrders.status, 'queued'),
          ),
        )
        .returning();

      if (updatedRows.length === 0) {
        // Inspect current order state to determine whether it is 404 or 409
        const existing = await tx
          .select({ status: rechargeOrders.status })
          .from(rechargeOrders)
          .where(
            and(
              eq(rechargeOrders.id, id),
              eq(rechargeOrders.tenantId, session.tenant.id),
            ),
          )
          .limit(1);

        if (existing.length === 0) {
          return NextResponse.json(
            { error: 'Recharge order not found' },
            { status: 404 },
          );
        }

        const currentStatus = existing[0]?.status;
        return NextResponse.json(
          {
            error: `Cannot cancel recharge order: current status is '${currentStatus}'. Cancellation is allowed only from 'queued' state.`,
            currentStatus,
          },
          { status: 409 },
        );
      }

      const order = updatedRows[0];
      if (!order) {
        throw new Error('Failed to update order');
      }

      // Write audit log
      await tx.insert(auditLog).values({
        tenantId: session.tenant.id,
        actorId: session.user.id,
        action: 'cancel_recharge_order',
        targetType: 'recharge_order',
        targetId: order.id,
        meta: {
          previousStatus: 'queued',
          newStatus: 'cancelled',
        },
        createdAt: now,
      });

      broadcastSseEvent('recharge_order.updated', {
        orderId: order.id,
        status: 'cancelled',
      });

      return NextResponse.json(
        {
          success: true,
          order: {
            id: order.id,
            status: 'cancelled',
            customerNoMasked: `••••••${order.customerLast4}`,
            customerLast4: order.customerLast4,
            amountPaise: order.amountPaise,
            updatedAt: now.toISOString(),
          },
        },
        { status: 200 },
      );
    });
  } catch (err) {
    console.error('[Recharge Orders] Database error in cancel route:', err);
    return NextResponse.json(
      { error: 'Service Unavailable: Database is currently unreachable' },
      { status: 503 },
    );
  }
}

