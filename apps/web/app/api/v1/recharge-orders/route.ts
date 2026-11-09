import { NextRequest, NextResponse } from 'next/server';
import { getTenantSession, canPerformAction } from '@/lib/auth';
import { withTenantContext } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  encryptCustomerNo,
  extractCustomerLast4,
  hashCustomerNo,
} from '@/lib/crypto';
import {
  rechargeOrders,
  auditLog,
} from '@/drizzle/schema';
import {
  CreateRechargeOrderRequestSchema,
} from '@walletsync/contract';
import {
  getTenantRechargeSettings,
  getTodayActiveRechargeTotalPaise,
  findRecentDuplicateOrder,
} from '@/lib/recharge';
import { broadcastSseEvent } from '@/lib/sse';
import { eq, and, desc, sql } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  // 1. Session authentication
  const session = await getTenantSession(req);
  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized: Authentication required' },
      { status: 401 },
    );
  }

  // 2. Role check: owner and admin allowed, viewer denied
  if (!canPerformAction(session.role, 'recharge:create')) {
    return NextResponse.json(
      { error: 'Forbidden: Insufficient permissions to create recharge orders' },
      { status: 403 },
    );
  }

  // 3. Idempotency-Key header is mandatory
  const idempotencyKey = req.headers.get('idempotency-key')?.trim();
  if (!idempotencyKey || idempotencyKey.length === 0 || idempotencyKey.length > 256) {
    return NextResponse.json(
      { error: 'Idempotency-Key header is required (max 256 characters)' },
      { status: 400 },
    );
  }

  // 4. Validate body schema
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CreateRechargeOrderRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { source, service, operator, circle, customerNo, amountPaise, confirmDuplicate, mPin } =
    parsed.data;

  // DB-only operation inside tenant context
  try {
    return await withTenantContext(session.tenant.id, async (tx) => {
      // 1. Per-tenant advisory transaction lock: serializes limit evaluations and order creation per tenant
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${session.tenant.id}::text))`,
      );

      const customerNoHash = hashCustomerNo(customerNo);
      const customerLast4 = extractCustomerLast4(customerNo);

      // 5. Idempotency check: look for existing order with same tenantId and idempotencyKey
      const existing = await tx
        .select()
        .from(rechargeOrders)
        .where(
          and(
            eq(rechargeOrders.tenantId, session.tenant.id),
            eq(rechargeOrders.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);

      if (existing.length > 0 && existing[0]) {
        const order = existing[0];
        // Compare request payload with existing order
        const isSamePayload =
          order.source === source &&
          order.service === service &&
          order.operator === operator &&
          order.customerNoHash === customerNoHash &&
          order.amountPaise === amountPaise;

        if (isSamePayload) {
          // Same key + same body -> Return existing order (200)
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
                status: order.status,
                createdAt: order.createdAt.toISOString(),
                updatedAt: order.updatedAt.toISOString(),
              },
            },
            { status: 200 },
          );
        } else {
          // Same key + different body -> 409 Conflict
          return NextResponse.json(
            {
              error:
                'Conflict: Idempotency-Key has already been used with a different request payload',
            },
            { status: 409 },
          );
        }
      }

      // 6. Checks in required sequence:
      // Check 1: recharge_enabled
      const settings = await getTenantRechargeSettings(session.tenant.id, tx);
      if (!settings.rechargeEnabled) {
        return NextResponse.json(
          { error: 'Forbidden: Recharge feature is currently disabled for this tenant' },
          { status: 403 },
        );
      }

      // Check 2: per-order max
      if (amountPaise > settings.perOrderMaxPaise) {
        return NextResponse.json(
          {
            error: `Order amount ${amountPaise} paise exceeds per-order maximum limit of ${settings.perOrderMaxPaise} paise`,
          },
          { status: 400 },
        );
      }

      // Check 3: daily total max (sum of today's non-failed, non-cancelled orders)
      const todayTotal = await getTodayActiveRechargeTotalPaise(session.tenant.id, tx);
      if (todayTotal + amountPaise > settings.dailyMaxPaise) {
        return NextResponse.json(
          {
            error: `Order amount ${amountPaise} paise would exceed daily limit (${todayTotal}/${settings.dailyMaxPaise} paise used)`,
          },
          { status: 400 },
        );
      }

      // Check 4: max orders per minute rate limiting
      const rateLimitRes = await checkRateLimit(
        `recharge:orders:tenant:${session.tenant.id}`,
        settings.maxOrdersPerMinute,
        60,
      );
      if (!rateLimitRes.success) {
        return NextResponse.json(
          {
            error: `Rate limit exceeded: maximum ${settings.maxOrdersPerMinute} orders per minute allowed`,
          },
          { status: 429 },
        );
      }

      // Check 5: duplicate guard (same customer_no_hash + amount within 10 min requires confirmDuplicate: true)
      const hasRecentDuplicate = await findRecentDuplicateOrder(
        session.tenant.id,
        customerNoHash,
        amountPaise,
        tx,
      );

      if (hasRecentDuplicate && !confirmDuplicate) {
        return NextResponse.json(
          {
            error:
              'Potential duplicate order detected: an order for this customer and amount was created within the last 10 minutes. Set confirmDuplicate to true to proceed.',
            requiresConfirmation: true,
          },
          { status: 409 },
        );
      }

      // 7. Create the order in 'queued' status
      const customerPayload = (mPin || circle) ? JSON.stringify({ customerNo, mPin, circle }) : customerNo;
      const customerNoEnc = encryptCustomerNo(customerPayload, session.tenant.id);
      const now = new Date();

      let newOrder;
      try {
        await tx.execute(sql`SAVEPOINT sp_order_insert`);
        const inserted = await tx
          .insert(rechargeOrders)
          .values({
            tenantId: session.tenant.id,
            createdBy: session.user.id,
            idempotencyKey,
            source,
            service,
            operator,
            customerNoEnc,
            customerNoHash,
            customerLast4,
            amountPaise,
            status: 'queued',
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        await tx.execute(sql`RELEASE SAVEPOINT sp_order_insert`);
        newOrder = inserted[0];
      } catch (insertErr: unknown) {
        await tx.execute(sql`ROLLBACK TO SAVEPOINT sp_order_insert`).catch(() => {});
        // Concurrency handler: if a race condition produced a unique violation on (tenant_id, idempotency_key)
        const isUniqueViolation =
          (insertErr as { code?: string })?.code === '23505' ||
          (insertErr instanceof Error &&
            (insertErr.message.includes('recharge_orders_tenant_idempotency_uidx') ||
              insertErr.message.toLowerCase().includes('unique')));

        if (isUniqueViolation) {
          const raceExisting = await tx
            .select()
            .from(rechargeOrders)
            .where(
              and(
                eq(rechargeOrders.tenantId, session.tenant.id),
                eq(rechargeOrders.idempotencyKey, idempotencyKey),
              ),
            )
            .limit(1);

          if (raceExisting.length > 0 && raceExisting[0]) {
            const order = raceExisting[0];
            const isSamePayload =
              order.source === source &&
              order.service === service &&
              order.operator === operator &&
              order.customerNoHash === customerNoHash &&
              order.amountPaise === amountPaise;

            if (isSamePayload) {
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
                    status: order.status,
                    createdAt: order.createdAt.toISOString(),
                    updatedAt: order.updatedAt.toISOString(),
                  },
                },
                { status: 200 },
              );
            } else {
              return NextResponse.json(
                {
                  error:
                    'Conflict: Idempotency-Key has already been used with a different request payload',
                },
                { status: 409 },
              );
            }
          }
        }
        throw insertErr;
      }

      if (!newOrder) {
        throw new Error('Failed to insert recharge order');
      }

      // 8. Write audit log (CRITICAL: zero plain phone number in metadata)
      await tx.insert(auditLog).values({
        tenantId: session.tenant.id,
        actorId: session.user.id,
        action: 'create_recharge_order',
        targetType: 'recharge_order',
        targetId: newOrder.id,
        meta: {
          source,
          service,
          operator,
          amountPaise,
          customerLast4,
        },
        createdAt: now,
      });

      broadcastSseEvent('recharge_order.updated', {
        orderId: newOrder.id,
        status: newOrder.status,
      });

      return NextResponse.json(
        {
          order: {
            id: newOrder.id,
            source: newOrder.source,
            service: newOrder.service,
            operator: newOrder.operator,
            customerNoMasked: `••••••${newOrder.customerLast4}`,
            customerLast4: newOrder.customerLast4,
            amountPaise: newOrder.amountPaise,
            status: newOrder.status,
            createdAt: newOrder.createdAt.toISOString(),
            updatedAt: newOrder.updatedAt.toISOString(),
          },
        },
        { status: 201 },
      );
    });
  } catch (err) {
    // DB only: never use memory-store for orders. If DB unavailable, return 503.
    console.error('[Recharge Orders] Database error in POST /api/v1/recharge-orders:', err);
    return NextResponse.json(
      { error: 'Service Unavailable: Database is currently unreachable' },
      { status: 503 },
    );
  }
}

export async function GET(req: NextRequest) {
  const session = await getTenantSession(req);
  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized: Authentication required' },
      { status: 401 },
    );
  }

  if (!canPerformAction(session.role, 'dashboard:view')) {
    return NextResponse.json(
      { error: 'Forbidden: Insufficient permissions' },
      { status: 403 },
    );
  }

  try {
    return await withTenantContext(session.tenant.id, async (tx) => {
      const rows = await tx
        .select()
        .from(rechargeOrders)
        .where(eq(rechargeOrders.tenantId, session.tenant.id))
        .orderBy(desc(rechargeOrders.createdAt))
        .limit(100);

      const now = new Date();
      for (const r of rows) {
        if (r.status === 'submitting' && now.getTime() - r.updatedAt.getTime() > 25000) {
          r.status = 'submitted';
          r.submittedAt = now;
          await tx
            .update(rechargeOrders)
            .set({ status: 'submitted', submittedAt: now, updatedAt: now })
            .where(eq(rechargeOrders.id, r.id))
            .catch(() => {});
          broadcastSseEvent('recharge_order.updated', {
            orderId: r.id,
            status: 'submitted',
          });
        }
      }

      const formatted = rows.map((r) => ({
        id: r.id,
        source: r.source,
        service: r.service,
        operator: r.operator,
        customerNoMasked: `••••••${r.customerLast4}`,
        customerLast4: r.customerLast4,
        amountPaise: r.amountPaise,
        status: r.status,
        failureCode: r.failureCode,
        failureDetail: r.failureDetail,
        matchedTransactionId: r.matchedTransactionId,
        submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
        reconciledAt: r.reconciledAt ? r.reconciledAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));

      return NextResponse.json({ orders: formatted }, { status: 200 });
    });
  } catch (err) {
    console.error('[Recharge Orders] Database error in GET /api/v1/recharge-orders:', err);
    return NextResponse.json(
      { error: 'Service Unavailable: Database is currently unreachable' },
      { status: 503 },
    );
  }
}

