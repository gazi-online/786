import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parse } from '@walletsync/parsers';
import type { TransactionStatus } from '@walletsync/contract';
import { getTenantSession } from '@/lib/auth';
import { withTenantContext, type AppTransaction } from '@/lib/db';
import { transactions, syncEvents } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import {
  encryptCustomerNo,
  extractCustomerLast4,
  hashCustomerNo,
} from '@/lib/crypto';
import { broadcastSseEvent } from '@/lib/sse';
import { reconcileTransactionWithRechargeOrder } from '@/lib/reconciliation';

const IngestHtmlSchema = z.object({
  html: z.string().min(10, 'HTML content is required'),
});

export async function POST(req: NextRequest) {
  const session = await getTenantSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized: Authentication required' }, { status: 401 });
  }

  try {
    const json = await req.json();
    const parseBody = IngestHtmlSchema.safeParse(json);
    if (!parseBody.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parseBody.error.format() },
        { status: 422 },
      );
    }

    const { html } = parseBody.data;
    const parseResult = parse(html);

    if (!parseResult.ok) {
      return NextResponse.json(
        {
          error: `Parser failed to extract transactions: ${parseResult.reason}`,
          detail: parseResult.detail || 'Make sure you copy the entire portal page or transaction table HTML.',
        },
        { status: 400 },
      );
    }

    const rows = parseResult.rows;
    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { error: 'No transaction records found in the provided HTML.' },
        { status: 400 },
      );
    }

    const tenantId = session.tenant.id;
    const now = new Date();

    const result = await withTenantContext(tenantId, async (tx: AppTransaction) => {
      let inserted = 0;
      let updated = 0;
      let unchanged = 0;

      for (const row of rows) {
        const existingRows = await tx
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.tenantId, tenantId),
              eq(transactions.source, row.source),
              eq(transactions.txnId, row.txnId),
            ),
          );

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

        const existing = existingRows[0];

        if (!existing) {
          const encryptedCustomerNo = encryptCustomerNo(row.customerNo, tenantId);
          const customerLast4 = extractCustomerLast4(row.customerNo);
          const customerNoHash = hashCustomerNo(row.customerNo);

          const [insertedTxn] = await tx
            .insert(transactions)
            .values({
              tenantId,
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
              parserVersion: parseResult.parserVersion,
            })
            .returning({ id: transactions.id });
          inserted++;

          if (insertedTxn?.id) {
            await reconcileTransactionWithRechargeOrder(tx, tenantId, {
              id: insertedTxn.id,
              source: row.source,
              customerNoHash,
              amountPaise: row.amountPaise,
              status: resolvedStatus,
              occurredAt: new Date(row.occurredAt),
            });
          }
        } else {
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

          await reconcileTransactionWithRechargeOrder(tx, tenantId, {
            id: existing.id,
            source: existing.source,
            customerNoHash: existing.customerNoHash,
            amountPaise: existing.amountPaise,
            status: resolvedStatus,
            occurredAt: existing.occurredAt,
          });
        }
      }

      await tx.insert(syncEvents).values({
        tenantId,
        capturedAt: new Date(parseResult.capturedAt),
        status: 'ok',
        rowCounts: { accepted: rows.length, inserted, updated, unchanged, rejected: [] },
        parserVersion: parseResult.parserVersion,
      });

      return { inserted, updated, unchanged, total: rows.length };
    });

    // Broadcast SSE update so live dashboard reflects changes instantly
    try {
      broadcastSseEvent('sync_completed', {
        tenantId,
        total: result.total,
        inserted: result.inserted,
        portal: parseResult.source,
      });
    } catch {
      // Ignore SSE error
    }

    return NextResponse.json({
      ok: true,
      message: `Successfully synchronized ${result.total} transactions (${result.inserted} new) from ${parseResult.source}!`,
      portal: parseResult.source,
      stats: result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
