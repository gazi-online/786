import { NextRequest, NextResponse } from 'next/server';
import { withTenantContext } from '@/lib/db';
import { transactions } from '@/drizzle/schema';
import { desc, and, eq, or, ilike, lt } from 'drizzle-orm';
import type { ApiTransaction, TransactionStatus, TransactionSource } from '@walletsync/contract';
import { getMemoryTransactions } from '@/lib/memory-store';
import { computeTenantScopedETag } from '@/lib/etag';
import { getTenantSession } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const session = await getTenantSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized: Authentication required' }, { status: 401 });
  }

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

    const conditions = [eq(transactions.tenantId, session.tenant.id)];

    if (source && source !== 'all') {
      conditions.push(eq(transactions.source, source as TransactionSource));
    }
    if (status && status !== 'all') {
      conditions.push(eq(transactions.status, status as TransactionStatus));
    }
    if (service && service !== 'all') {
      conditions.push(eq(transactions.service, service));
    }
    if (operator && operator !== 'all') {
      conditions.push(eq(transactions.serviceName, operator));
    }
    if (search && search.trim()) {
      const q = search.trim();
      const searchClause = or(
        ilike(transactions.txnId, `%${q}%`),
        eq(transactions.customerLast4, q.slice(-4)),
      );
      if (searchClause) {
        conditions.push(searchClause);
      }
    }
    if (cursor) {
      conditions.push(lt(transactions.occurredAt, new Date(cursor)));
    }

    let formatted: ApiTransaction[] = [];

    // Query PostgreSQL using withTenantContext so PostgreSQL RLS satisfies user_has_tenant_access
    try {
      const rows = await withTenantContext(session.tenant.id, async (tx) => {
        return await tx
          .select()
          .from(transactions)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(transactions.occurredAt))
          .limit(limit);
      });

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

    const getCompositeKey = (t: { source?: string | null; txnId: string | number }) =>
      `${(t.source || 'simplewallet').toLowerCase().trim()}_${String(t.txnId || '').trim()}`;

    // Deduplicate any records and optionally merge memory store (in dev/demo only if DB returned empty)
    const memList = getMemoryTransactions();
    if (memList.length > 0 && (process.env.NODE_ENV !== 'production' || formatted.length === 0)) {
      const seen = new Set(formatted.map(getCompositeKey));
      for (const m of memList) {
        if (m.tenantId && m.tenantId !== session.tenant.id && m.tenantId !== '00000000-0000-0000-0000-000000000001') {
          continue;
        }
        const mKey = getCompositeKey(m);
        if (!seen.has(mKey)) {
          if (source && source !== 'all' && m.source !== source) continue;
          if (status && status !== 'all' && m.status !== status) continue;
          if (service && service !== 'all' && m.service !== service) continue;
          formatted.push(m);
          seen.add(mKey);
        }
      }
    }

    // Final deduplication pass to strictly guarantee no duplicate (source, txnId) records in the response
    const dedupMap = new Map<string, ApiTransaction>();
    for (const item of formatted) {
      const key = getCompositeKey(item);
      if (!dedupMap.has(key)) {
        dedupMap.set(key, item);
      }
    }
    const cleanList = Array.from(dedupMap.values()).sort((a, b) => {
      const timeA = new Date(a.occurredAt).getTime();
      const timeB = new Date(b.occurredAt).getTime();
      return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
    });

    const nextCursor =
      cleanList.length === limit ? cleanList[cleanList.length - 1]?.occurredAt : null;

    const itemsToReturn = cleanList.slice(0, limit);

    // Compute max(updatedAt) across the filtered result set
    let maxUpdatedAt = '0';
    for (const item of itemsToReturn) {
      if (item.updatedAt > maxUpdatedAt) {
        maxUpdatedAt = item.updatedAt;
      }
    }

    const tenantId = itemsToReturn[0]?.tenantId || session.tenant.id;
    const etag = computeTenantScopedETag({
      tenantId,
      count: itemsToReturn.length,
      maxUpdatedAt,
      queryParams: { limit, cursor, status, source, service, operator, search },
    });

    const headers: Record<string, string> = {
      ETag: etag,
      'Cache-Control': 'private, no-cache, stale-while-revalidate=10',
      Vary: 'Cookie, Authorization',
    };

    if (req.headers.get('if-none-match') === etag) {
      return new NextResponse(null, {
        status: 304,
        headers,
      });
    }

    return NextResponse.json(
      {
        items: itemsToReturn,
        nextCursor,
        count: formatted.length,
      },
      {
        headers,
      },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch transactions';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
