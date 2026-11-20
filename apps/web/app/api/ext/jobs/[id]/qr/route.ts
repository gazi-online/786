import { NextRequest, NextResponse } from 'next/server';
import { withTenantContext } from '@/lib/db';
import { rechargeOrders, rechargeOrderEvents } from '@/drizzle/schema';
import { UploadJobQrRequestSchema } from '@walletsync/contract';
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

  const parseResult = UploadJobQrRequestSchema.safeParse(bodyJson);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parseResult.error.flatten() },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const { qrImageUrl, actualPayablePaise, qrExpiresAt, qrTimer } = parseResult.data;
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

      // Safety Rule 1: Payable Check (Section 7)
      // If actual payable is greater than expected_payable, or unexpected difference in strict mode:
      let needsReview = false;
      let reviewReason: string | null = null;

      if (actualPayablePaise) {
        if (order.expectedPayablePaise && actualPayablePaise > order.expectedPayablePaise) {
          needsReview = true;
          reviewReason = `Payable amount (₹${actualPayablePaise / 100}) exceeds expected payable (₹${order.expectedPayablePaise / 100})`;
        } else if (!order.expectedPayablePaise && actualPayablePaise > order.amountPaise) {
          needsReview = true;
          reviewReason = `Payable amount (₹${actualPayablePaise / 100}) exceeds recharge amount (₹${order.amountPaise / 100})`;
        }
      }

      const nextStatus = needsReview ? 'needs_review' : 'awaiting_payment';
      const expiresAt = qrExpiresAt ? new Date(qrExpiresAt) : new Date(now.getTime() + 10 * 60 * 1000);

      await tx.update(rechargeOrders).set({
        status: nextStatus,
        statusReason: reviewReason,
        actualPayablePaise: actualPayablePaise || null,
        qrImageUrl,
        qrExpiresAt: expiresAt,
        updatedAt: now,
      }).where(eq(rechargeOrders.id, order.id));

      await tx.insert(rechargeOrderEvents).values({
        tenantId: device.tenantId,
        orderId: order.id,
        fromStatus: order.status,
        toStatus: nextStatus,
        actor: 'extension',
        detail: {
          actualPayablePaise,
          expectedPayablePaise: order.expectedPayablePaise,
          qrExpiresAt: expiresAt.toISOString(),
          needsReview,
          reviewReason,
        },
        createdAt: now,
      });

      broadcastSseEvent('recharge_order.updated', {
        orderId: order.id,
        status: nextStatus,
        statusReason: reviewReason,
      });

      if (!needsReview) {
        const cleanAmount = actualPayablePaise
          ? (actualPayablePaise / 100).toString()
          : (order.amountPaise / 100).toString();

        broadcastSseEvent('recharge_order.qr_code', {
          orderId: order.id,
          qrDataUrl: qrImageUrl,
          qrAmount: cleanAmount,
          qrTimer: qrTimer || '10M:00S',
        });
      }

      return NextResponse.json({
        success: true,
        status: nextStatus,
        needsReview,
        reason: reviewReason,
      }, { status: 200, headers: CORS_HEADERS });
    });
  } catch (err) {
    console.error('[QR Upload API] Error saving QR:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500, headers: CORS_HEADERS });
  }
}
