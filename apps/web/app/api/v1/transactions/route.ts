import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { transactions } from '@/drizzle/schema';
import { desc, and, eq, or, ilike, lt } from 'drizzle-orm';
import type { ApiTransaction, TransactionStatus, TransactionSource } from '@walletsync/contract';
import { getMemoryTransactions } from '@/lib/memory-store';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limitParam = parseInt(searchParams.get('limit') || '50', 10);
    const limit = Math.min(Math.max(1, limitParam), 100);
    const cursor = searchParams.get('cursor');
    const status = searchParams.get('status');
    const source = searchParams.get('source');
    const service = searchParams.get('service');
    const operator = searchParams.get('operator');
    const search = searchParams.get('search');

    const conditions = [];

    if (source && source !== 'all') {
      conditions.push(eq(transactions.source, source as TransactionSource));
    }
    if (status) {
      conditions.push(eq(transactions.status, status as TransactionStatus));
    }
    if (service) {
      conditions.push(eq(transactions.service, service));
    }
    if (operator) {
      conditions.push(eq(transactions.serviceName, operator));
    }
    if (search && search.trim()) {
      const q = search.trim();
      conditions.push(
        or(
          ilike(transactions.txnId, `%${q}%`),
          eq(transactions.customerLast4, q.slice(-4)),
        ),
      );
    }
    if (cursor) {
      conditions.push(lt(transactions.occurredAt, new Date(cursor)));
    }

    let formatted: ApiTransaction[] = [];

    try {
      const rows = await db
        .select()
        .from(transactions)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(transactions.occurredAt))
        .limit(limit);

      formatted = rows.map((r) => {
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
    } catch {
      // Merge memory transactions
    }

    const memList = getMemoryTransactions();
    if (memList.length > 0) {
      const seen = new Set(formatted.map((f) => f.txnId));
      for (const m of memList) {
        if (!seen.has(m.txnId)) {
          if (source && source !== 'all' && m.source !== source) continue;
          if (status && status !== 'all' && m.status !== status) continue;
          if (service && service !== 'all' && m.service !== service) continue;
          formatted.unshift(m);
          seen.add(m.txnId);
        }
      }
    }

    const nextCursor =
      formatted.length === limit ? formatted[formatted.length - 1]?.occurredAt : null;

    return NextResponse.json({
      items: formatted.slice(0, limit),
      nextCursor,
      count: formatted.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch transactions';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
