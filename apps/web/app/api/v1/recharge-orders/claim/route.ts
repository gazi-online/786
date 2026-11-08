import { NextRequest, NextResponse } from 'next/server';
import { withTenantContext } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';
import { decryptCustomerNo } from '@/lib/crypto';
import { rechargeOrders, auditLog } from '@/drizzle/schema';
import {
  DEFAULT_CLAIM_LEASE_SECONDS,
  type ClaimRechargeOrderResponse,
} from '@walletsync/contract';
import {
  verifyDeviceForRecharge,
  getTenantRechargeSettings,
} from '@/lib/recharge';
import { broadcastSseEvent } from '@/lib/sse';
import { eq, and, or, lt, asc, sql } from 'drizzle-orm';

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

export async function POST(req: NextRequest) {
  // 1. Authenticate device (DB-only, strict non-revocation check)
  const auth = await verifyDeviceForRecharge(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: CORS_HEADERS });
  }

  const device = auth.device;

  // 2. Rate limit device: max 60 claims/minute
  const rateLimit = await checkRateLimit(`recharge:claim:device:${device.id}`, 60, 60);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded: Please wait before requesting another claim' },
      { status: 429, headers: { ...CORS_HEADERS, 'Retry-After': '60' } },
    );
  }

  const now = new Date();

  // 3. Process claim within tenant context using PostgreSQL FOR UPDATE SKIP LOCKED
  try {
    return await withTenantContext(device.tenantId, async (tx) => {
      // Guard: Check tenant recharge settings
      const settings = await getTenantRechargeSettings(device.tenantId, tx);
      if (!settings.rechargeEnabled) {
        return NextResponse.json(
          {
            order: null,
            message: 'Recharge feature is currently disabled for this tenant',
          },
          { status: 200, headers: CORS_HEADERS },
        );
      }

      // Find the next claimable order:
      // Status is 'queued' OR an expired 'claimed' order that has NOT reached 'submitting'
      const candidateOrders = await tx
        .select()
        .from(rechargeOrders)
        .where(
          and(
            eq(rechargeOrders.tenantId, device.tenantId),
            or(
              eq(rechargeOrders.status, 'queued'),
              and(
                eq(rechargeOrders.status, 'claimed'),
                lt(rechargeOrders.claimExpiresAt, sql`NOW()`),
              ),
            ),
          ),
        )
        .orderBy(asc(rechargeOrders.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });

      if (candidateOrders.length === 0 || !candidateOrders[0]) {
        // No orders currently waiting in queue
        return NextResponse.json(
          {
            order: null,
          },
          { status: 200, headers: CORS_HEADERS },
        );
      }

      const order = candidateOrders[0];
      const claimExpiresAt = new Date(now.getTime() + DEFAULT_CLAIM_LEASE_SECONDS * 1000);

      // Atomically update order to claimed with lease expiry
      await tx
        .update(rechargeOrders)
        .set({
          status: 'claimed',
          claimedByDeviceId: device.id,
          claimExpiresAt,
          updatedAt: now,
        })
        .where(eq(rechargeOrders.id, order.id));

      // Decrypt plain phone number ONLY upon successful claim for this authenticated device
      const customerNo = decryptCustomerNo(order.customerNoEnc, device.tenantId);

      // Write audit log entry
      await tx.insert(auditLog).values({
        tenantId: device.tenantId,
        actorId: device.id,
        action: 'claim_recharge_order',
        targetType: 'recharge_orders',
        targetId: order.id,
        meta: {
          deviceId: device.id,
          previousStatus: order.status,
          claimExpiresAt: claimExpiresAt.toISOString(),
          leaseSeconds: DEFAULT_CLAIM_LEASE_SECONDS,
        },
        createdAt: now,
      });

      broadcastSseEvent('recharge_order.updated', {
        orderId: order.id,
        status: 'claimed',
      });

      const responsePayload: ClaimRechargeOrderResponse = {
        order: {
          id: order.id,
          source: order.source,
          service: order.service,
          operator: order.operator,
          customerNo,
          amountPaise: order.amountPaise,
          status: 'claimed',
          claimedAt: now.toISOString(),
          claimExpiresAt: claimExpiresAt.toISOString(),
        },
      };

      return NextResponse.json(responsePayload, { status: 200, headers: CORS_HEADERS });
    });
  } catch (err) {
    console.error('[Recharge Claim] Database error during claim:', err);
    return NextResponse.json(
      { error: 'Service Unavailable: Database error during order claim' },
      { status: 503, headers: CORS_HEADERS },
    );
  }
}


