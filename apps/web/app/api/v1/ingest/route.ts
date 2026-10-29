import { NextRequest, NextResponse } from 'next/server';
import {
  IngestRequestSchema,
  SCHEMA_VERSION,
  type IngestResponse,
  type TransactionStatus,
} from '@walletsync/contract';
import { db, withTenantContext, type AppTransaction } from '@/lib/db';
import {
  devices,
  tenants,
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
  if (current === 'pending') {
    return incoming === 'success' || incoming === 'failed';
  }
  if (current === 'success') {
    return incoming === 'refunded';
  }
  return false;
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

  // Lookup device
  const deviceList = await db
    .select()
    .from(devices)
    .where(eq(devices.tokenHash, tokenHash));

  const device = deviceList[0];
  if (!device || device.revokedAt !== null) {
    return NextResponse.json(
      { error: 'Invalid or revoked device token' },
      { status: 401 },
    );
  }

  // 2. Check tenant status
  const tenantList = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, device.tenantId));

  const tenant = tenantList[0];
  if (!tenant || tenant.status === 'suspended') {
    return NextResponse.json(
      { error: 'Tenant account is suspended or invalid' },
      { status: 403 },
    );
  }

  // 3. Rate limiting: 30 requests/min per device (Amd-3)
  const rateLimit = await checkRateLimit(`ingest:device:${device.id}`, 30, 60);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  // 4. Validate body & schema
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

  // Check schemaVersion compatibility first
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

  // 5. Check pageTotals against the rows
  type IngestRow = (typeof data.rows)[number];
  const calculatedSum = data.rows.reduce(
    (sum: number, r: IngestRow) => sum + r.amountPaise,
    0,
  );
  if (data.pageTotals.amountPaise !== calculatedSum) {
    // Record health event as totals_mismatch
    await db.insert(syncEvents).values({
      tenantId: device.tenantId,
      deviceId: device.id,
      capturedAt: new Date(data.capturedAt),
      status: 'totals_mismatch',
      rowCounts: {
        accepted: 0,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        rejected: data.rows.map((r: IngestRow) => ({
          txnId: r.txnId,
          reason: 'Totals mismatch between rows and pageTotals',
        })),
      },
      parserVersion: data.parserVersion,
    });

    return NextResponse.json(
      { error: 'Page totals do not match rows sum' },
      { status: 422 },
    );
  }

  // 6. Execute upsert in transaction scoped by tenant_id (Amd-1)
  const result = await withTenantContext(device.tenantId, async (tx: AppTransaction) => {
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    const rejected: Array<{ txnId: string; reason: string }> = [];

    for (const row of data.rows) {
      // Find existing transaction by (tenantId, source, txnId)
      const existingRows = await tx
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.tenantId, device.tenantId),
            eq(transactions.source, row.source),
            eq(transactions.txnId, row.txnId),
          ),
        );

      const existing = existingRows[0];

      if (!existing) {
        // Insert new canonical transaction
        const encryptedCustomerNo = encryptCustomerNo(row.customerNo);
        const customerLast4 = extractCustomerLast4(row.customerNo);
        const customerNoHash = hashCustomerNo(row.customerNo);

        await tx.insert(transactions).values({
          tenantId: device.tenantId,
          deviceId: device.id,
          source: row.source,
          txnId: row.txnId,
          service: row.service,
          serviceName: row.serviceName,
          customerNo: encryptedCustomerNo,
          customerLast4,
          customerNoHash,
          occurredAt: new Date(row.occurredAt),
          status: row.status,
          statusRaw: row.statusRaw,
          operatorRef: row.operatorRef || '',
          amountPaise: row.amountPaise,
          discountPct: String(row.discountPct),
          discountPaise: row.discountPaise,
          parserVersion: data.parserVersion,
        });
        inserted++;
      } else {
        // Enforce forward-only status transition
        if (!isValidStatusTransition(existing.status, row.status)) {
          rejected.push({
            txnId: row.txnId,
            reason: `Disallowed status downgrade from ${existing.status} to ${row.status}`,
          });
          continue;
        }

        if (existing.status !== row.status) {
          // Status updated
          await tx
            .update(transactions)
            .set({
              status: row.status,
              statusRaw: row.statusRaw,
              updatedAt: now,
              operatorRef: row.operatorRef || existing.operatorRef,
            })
            .where(eq(transactions.id, existing.id));
          updated++;
        } else {
          unchanged++;
        }
      }
    }

    const accepted = inserted + updated + unchanged;

    // Record sync event
    await tx.insert(syncEvents).values({
      tenantId: device.tenantId,
      deviceId: device.id,
      capturedAt: new Date(data.capturedAt),
      status: 'ok',
      rowCounts: { accepted, inserted, updated, unchanged, rejected },
      parserVersion: data.parserVersion,
    });

    // Update device lastSeenAt and parserVersion
    await tx
      .update(devices)
      .set({
        lastSeenAt: now,
        parserVersion: data.parserVersion,
        status: 'ok',
      })
      .where(eq(devices.id, device.id));

    const response: IngestResponse = {
      accepted,
      inserted,
      updated,
      unchanged,
      rejected,
      serverTime: now.toISOString(),
    };

    return response;
  });

  // Broadcast live SSE event to connected dashboard clients (M4)
  if (result.inserted > 0 || result.updated > 0) {
    broadcastSseEvent('transaction.updated', {
      inserted: result.inserted,
      updated: result.updated,
      serverTime: result.serverTime,
      rows: data.rows,
    });
  }

  return NextResponse.json(result, { status: 200 });
}
