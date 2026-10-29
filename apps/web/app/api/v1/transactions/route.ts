import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { transactions } from '@/drizzle/schema';
import { desc, and, eq, or, ilike, lt } from 'drizzle-orm';
import type { ApiTransaction, TransactionStatus } from '@walletsync/contract';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limitParam = parseInt(searchParams.get('limit') || '50', 10);
    const limit = Math.min(Math.max(1, limitParam), 100);
    const cursor = searchParams.get('cursor');
    const status = searchParams.get('status');
    const service = searchParams.get('service');
    const operator = searchParams.get('operator');
    const search = searchParams.get('search');

    const conditions = [];

    // Filter by status
    if (status) {
      conditions.push(eq(transactions.status, status as TransactionStatus));
    }

    // Filter by service
    if (service) {
      conditions.push(eq(transactions.service, service));
    }

    // Filter by operator / serviceName
    if (operator) {
      conditions.push(eq(transactions.serviceName, operator));
    }

    // Search by txnId or customerLast4
    if (search && search.trim()) {
      const q = search.trim();
      conditions.push(
        or(
          ilike(transactions.txnId, `%${q}%`),
          eq(transactions.customerLast4, q.slice(-4)),
        ),
      );
    }

    // Cursor pagination by occurredAt
    if (cursor) {
      conditions.push(lt(transactions.occurredAt, new Date(cursor)));
    }

    const rows = await db
      .select()
      .from(transactions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(transactions.occurredAt))
      .limit(limit);

    // Transform into ApiTransaction format (PII minimization: masked phone number)
    const formatted: ApiTransaction[] = rows.map((r) => {
      const last4 = r.customerLast4;
      const masked = `••••••${last4}`;

      return {
        id: r.id,
        tenantId: r.tenantId,
        txnId: r.txnId,
        source: r.source,
        service: r.service,
        serviceName: r.serviceName,
        customerLast4: last4,
        customerNoHash: r.customerNoHash,
        customerNoMasked: masked,
        occurredAt: r.occurredAt.toISOString(),
        status: r.status,
        statusRaw: r.statusRaw,
        operatorRef: r.operatorRef,
        amountPaise: r.amountPaise,
        discountPct: parseFloat(r.discountPct) || 0,
        discountPaise: r.discountPaise,
        parserVersion: r.parserVersion,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });

    const nextCursor =
      rows.length === limit ? rows[rows.length - 1]?.occurredAt.toISOString() : null;

    return NextResponse.json({
      items: formatted,
      nextCursor,
      count: formatted.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch transactions';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
