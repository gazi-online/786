import { NextRequest, NextResponse } from 'next/server';
import { getTenantSession, canPerformAction } from '@/lib/auth';
import { withTenantContext } from '@/lib/db';
import { rechargeOrders, auditLog } from '@/drizzle/schema';
import { ResolveRechargeOrderRequestSchema } from '@walletsync/contract';
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

  // settings:modify permission (owner & admin allowed, viewer denied)
  if (!canPerformAction(session.role, 'settings:modify')) {
    return NextResponse.json(
      { error: 'Forbidden: Insufficient permissions to resolve recharge orders' },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: 'Order ID is required' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ResolveRechargeOrderRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { outcome, note } = parsed.data;

  try {
    return await withTenantContext(session.tenant.id, async (tx) => {
      const now = new Date();

      // Single conditional atomic update from needs_manual_action
      const updatedRows = await tx
        .update(rechargeOrders)
        .set({
          status: outcome,
          updatedAt: now,
        })
        .where(
          and(
            eq(rechargeOrders.id, id),
            eq(rechargeOrders.tenantId, session.tenant.id),
            eq(rechargeOrders.status, 'needs_manual_action'),
          ),
        )
        .returning();

      if (updatedRows.length === 0) {
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

        return NextResponse.json(
          {
            error: `Cannot resolve recharge order: current status is '${existing[0]?.status}'. Resolution is only allowed from 'needs_manual_action' state.`,
            currentStatus: existing[0]?.status,
          },
          { status: 409 },
        );
      }

      const order = updatedRows[0];
      if (!order) {
        throw new Error('Failed to update order');
      }

      // Record human decision in audit_log
      await tx.insert(auditLog).values({
        tenantId: session.tenant.id,
        actorId: session.user.id,
        action: 'resolve_recharge_order',
        targetType: 'recharge_order',
        targetId: order.id,
        meta: {
          previousStatus: 'needs_manual_action',
          outcome,
          note,
        },
        createdAt: now,
      });

      return NextResponse.json(
        {
          success: true,
          order: {
            id: order.id,
            status: order.status,
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
    console.error('[Recharge Orders] Database error in resolve route:', err);
    return NextResponse.json(
      { error: 'Service Unavailable: Database is currently unreachable' },
      { status: 503 },
    );
  }
}

