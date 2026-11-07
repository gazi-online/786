import { NextRequest, NextResponse } from 'next/server';
import {
  IngestRequestSchema,
  SCHEMA_VERSION,
  type IngestResponse,
  type TransactionStatus,
  type ApiTransaction,
} from '@walletsync/contract';
import { db, withTenantContext, type AppTransaction } from '@/lib/db';
import {
  devices,
  transactions,
  syncEvents,
} from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import {
  hashDeviceToken,
  encryptCustomerNo,
  extractCustomerLast4,
  hashCustomerNo,
} from '@/lib/crypto';
import { checkRateLimit } from '@/lib/rate-limit';
import { broadcastSseEvent } from '@/lib/sse';
import { reconcileTransactionWithRechargeOrder } from '@/lib/reconciliation';
import {
  findMemoryDeviceByTokenHash,
  addMemoryTransactions,
} from '@/lib/memory-store';

/**
 * Validates allowed status transitions according to GUIDE.md §3:
 * - pending -> success | failed
 * - success -> refunded
 * - Same status -> unchanged
 */
function isValidStatusTransition(
  current: TransactionStatus,
  incoming: TransactionStatus,
): boolean {
  if (current === incoming) return true;
  if (current === 'unknown') {
    return true; // Resolving an undetermined status is always permitted
  }
  if (current === 'pending') {
    return incoming === 'success' || incoming === 'failed';
  }
  if (current === 'success') {
    return incoming === 'refunded';
  }
  return false;
}

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
  const now = new Date();

  // 1. Authenticate device token from Authorization header
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return NextResponse.json({ error: 'Missing device token' }, { status: 401 });
  }

  const tokenHash = hashDeviceToken(token);

  let device: { id: string; tenantId: string; revokedAt: Date | null } | null = null;

  try {
    const deviceList = await db
      .select()
      .from(devices)
      .where(eq(devices.tokenHash, tokenHash));

    if (deviceList[0]) {
      device = deviceList[0];
    }
  } catch {
    // DB offline; fallback to memory device
  }

  if (!device) {
    device = findMemoryDeviceByTokenHash(tokenHash);
  }

  if (!device || device.revokedAt !== null) {
    return NextResponse.json(
      { error: 'Invalid or revoked device token' },
      { status: 401 },
    );
  }

  // 2. Rate limiting: 60 requests/min per device (Amd-3)
  const rateLimit = await checkRateLimit(`ingest:device:${device.id}`, 60, 60);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  // 3. Validate body & schema
  let rawBodyText = '';
  try {
    rawBodyText = await req.text();
  } catch {
    return NextResponse.json({ error: 'Failed to read request body' }, { status: 400 });
  }

  // Check 256 KB body size limit
  if (Buffer.byteLength(rawBodyText, 'utf8') > 256 * 1024) {
    return NextResponse.json({ error: 'Payload exceeds 256 KB' }, { status: 413 });
  }

  let bodyJson: unknown;
  try {
    bodyJson = JSON.parse(rawBodyText);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Check schemaVersion compatibility
  if (
    typeof bodyJson === 'object' &&
    bodyJson !== null &&
    'schemaVersion' in bodyJson &&
    (bodyJson as { schemaVersion: unknown }).schemaVersion !== SCHEMA_VERSION
  ) {
    return NextResponse.json(
      { error: 'Unsupported schemaVersion. Please update the extension.' },
      { status: 409 },
    );
  }

  const parseResult = IngestRequestSchema.safeParse(bodyJson);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parseResult.error.format() },
      { status: 422 },
    );
  }

  const data = parseResult.data;

  // 4. Check pageTotals against the rows
  const calculatedAmountPaise = data.rows.reduce(
    (sum, row) => sum + row.amountPaise,
    0,
  );

  const totalsMatch = calculatedAmountPaise === data.pageTotals.amountPaise;

  if (!totalsMatch) {
    return NextResponse.json(
      { error: 'Page totals do not match rows sum' },
      { status: 422 },
    );
  }

  // 5. Execute upsert in DB if connected, or memory fallback
  let response: IngestResponse;

  try {
    response = await withTenantContext(device.tenantId, async (tx: AppTransaction) => {
      let inserted = 0;
      let updated = 0;
      let unchanged = 0;
      const rejected: Array<{ txnId: string; reason: string }> = [];

      for (const row of data.rows) {
        // Resolve status if 'unknown' but statusRaw contains identifiable keywords
        let resolvedStatus: TransactionStatus = row.status;
        if (resolvedStatus === 'unknown' && row.statusRaw) {
          const rawLower = row.statusRaw.toLowerCase().trim();
          if (
            rawLower.includes('fail') ||
            rawLower.includes('declin') ||
            rawLower.includes('reject') ||
            rawLower.includes('cancel') ||
            rawLower.includes('error')
          ) {
            resolvedStatus = 'failed';
          } else if (rawLower.includes('success') || rawLower === 'done' || rawLower === 'ok') {
            resolvedStatus = 'success';
          } else if (rawLower.includes('refund') || rawLower.includes('revers')) {
            resolvedStatus = 'refunded';
          } else if (rawLower.includes('pend') || rawLower.includes('process')) {
            resolvedStatus = 'pending';
          }
        }

        const existingRows = await tx
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.tenantId, device!.tenantId),
              eq(transactions.source, row.source),
              eq(transactions.txnId, row.txnId),
            ),
          );

        const existing = existingRows[0];

        if (!existing) {
          const encryptedCustomerNo = encryptCustomerNo(row.customerNo, device!.tenantId);
          const customerLast4 = extractCustomerLast4(row.customerNo);
          const customerNoHash = hashCustomerNo(row.customerNo);

          const [insertedTxn] = await tx
            .insert(transactions)
            .values({
              tenantId: device!.tenantId,
              deviceId: device!.id,
              source: row.source,
              txnId: row.txnId,
              service: row.service,
              serviceName: row.serviceName,
              customerNo: encryptedCustomerNo,
              customerLast4,
              customerNoHash,
              occurredAt: new Date(row.occurredAt),
              status: resolvedStatus,
              statusRaw: row.statusRaw,
              operatorRef: row.operatorRef || '',
              amountPaise: row.amountPaise,
              discountPct: String(row.discountPct),
              discountPaise: row.discountPaise,
              parserVersion: data.parserVersion,
            })
            .returning({ id: transactions.id });
          inserted++;

          if (insertedTxn?.id) {
            await reconcileTransactionWithRechargeOrder(tx, device!.tenantId, {
              id: insertedTxn.id,
              source: row.source,
              customerNoHash,
              amountPaise: row.amountPaise,
              status: resolvedStatus,
              occurredAt: new Date(row.occurredAt),
            });
          }
        } else {
          if (!isValidStatusTransition(existing.status, resolvedStatus)) {
            rejected.push({
              txnId: row.txnId,
              reason: `Disallowed status downgrade from ${existing.status} to ${resolvedStatus}`,
            });
            continue;
          }

          if (existing.status !== resolvedStatus) {
            await tx
              .update(transactions)
              .set({
                status: resolvedStatus,
                statusRaw: row.statusRaw,
                updatedAt: now,
                operatorRef: row.operatorRef || existing.operatorRef,
              })
              .where(eq(transactions.id, existing.id));
            updated++;
          } else {
            unchanged++;
          }

          await reconcileTransactionWithRechargeOrder(tx, device!.tenantId, {
            id: existing.id,
            source: existing.source,
            customerNoHash: existing.customerNoHash,
            amountPaise: existing.amountPaise,
            status: resolvedStatus,
            occurredAt: existing.occurredAt,
          });
        }
      }

      const accepted = inserted + updated + unchanged;

      await tx.insert(syncEvents).values({
        tenantId: device!.tenantId,
        deviceId: device!.id,
        capturedAt: new Date(data.capturedAt),
        status: 'ok',
        rowCounts: { accepted, inserted, updated, unchanged, rejected },
        parserVersion: data.parserVersion,
      });

      await tx
        .update(devices)
        .set({
          lastSeenAt: now,
          parserVersion: data.parserVersion,
          status: 'ok',
        })
        .where(eq(devices.id, device!.id));

      return {
        accepted,
        inserted,
        updated,
        unchanged,
        rejected,
        serverTime: now.toISOString(),
      };
    });
  } catch {
    // In-memory fallback
    const apiTransactions: ApiTransaction[] = data.rows.map((row) => {
      let resolvedStatus: TransactionStatus = row.status;
      if (resolvedStatus === 'unknown' && row.statusRaw) {
        const rawLower = row.statusRaw.toLowerCase().trim();
        if (
          rawLower.includes('fail') ||
          rawLower.includes('declin') ||
          rawLower.includes('reject') ||
          rawLower.includes('cancel') ||
          rawLower.includes('error')
        ) {
          resolvedStatus = 'failed';
        } else if (rawLower.includes('success') || rawLower === 'done' || rawLower === 'ok') {
          resolvedStatus = 'success';
        } else if (rawLower.includes('refund') || rawLower.includes('revers')) {
          resolvedStatus = 'refunded';
        } else if (rawLower.includes('pend') || rawLower.includes('process')) {
          resolvedStatus = 'pending';
        }
      }

      const last4 = extractCustomerLast4(row.customerNo);
      return {
        id: crypto.randomUUID(),
        tenantId: device!.tenantId,
        txnId: row.txnId,
        source: row.source,
        service: row.service,
        serviceName: row.serviceName,
        customerLast4: last4,
        customerNoMasked: `••••••${last4}`,
        occurredAt: row.occurredAt,
        status: resolvedStatus,
        statusRaw: row.statusRaw,
        operatorRef: row.operatorRef || '',
        amountPaise: row.amountPaise,
        discountPct: row.discountPct,
        discountPaise: row.discountPaise,
        parserVersion: data.parserVersion,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
    });

    addMemoryTransactions(apiTransactions);

    response = {
      accepted: data.rows.length,
      inserted: data.rows.length,
      updated: 0,
      unchanged: 0,
      rejected: [],
      serverTime: now.toISOString(),
    };
  }

  // Broadcast live SSE event to connected dashboard clients (M4)
  if (response.inserted > 0 || response.updated > 0) {
    broadcastSseEvent('transaction.updated', {
      inserted: response.inserted,
      updated: response.updated,
      serverTime: response.serverTime,
      rows: data.rows.map((r) => {
        let s = r.status;
        if (s === 'unknown' && r.statusRaw) {
          const rawLower = r.statusRaw.toLowerCase().trim();
          if (
            rawLower.includes('fail') ||
            rawLower.includes('declin') ||
            rawLower.includes('reject') ||
            rawLower.includes('cancel') ||
            rawLower.includes('error')
          ) {
            s = 'failed';
          } else if (rawLower.includes('success') || rawLower === 'done' || rawLower === 'ok') {
            s = 'success';
          } else if (rawLower.includes('refund') || rawLower.includes('revers')) {
            s = 'refunded';
          } else if (rawLower.includes('pend') || rawLower.includes('process')) {
            s = 'pending';
          }
        }
        return { ...r, status: s };
      }),
    });
  }

  return NextResponse.json(response, { status: 200 });
}
