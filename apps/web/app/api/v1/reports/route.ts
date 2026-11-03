import { NextRequest, NextResponse } from 'next/server';
import { withTenantContext } from '@/lib/db';
import { transactions } from '@/drizzle/schema';
import { desc, eq } from 'drizzle-orm';
import { getTenantSession, canPerformAction } from '@/lib/auth';

const emptyReport = {
  summary: {
    totalVolumePaise: 0,
    totalDiscountPaise: 0,
    totalCount: 0,
    successRate: '0%',
    avgTxnPaise: 0,
    peakHour: '—',
    vsPreviousPeriodPct: '0%',
  },
  salesByDay: [],
  salesByService: [],
  salesByOperator: [],
  salesByHour: Array.from({ length: 24 }, (_, h) => ({
    hour: `${h.toString().padStart(2, '0')}:00`,
    volumePaise: 0,
    count: 0,
  })),
};

export async function GET(req: NextRequest) {
  try {
    const session = await getTenantSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized: Authentication required' }, { status: 401 });
    }

    const isExport = req.nextUrl.searchParams.get('export') === 'true' || req.nextUrl.searchParams.get('export') === 'csv';
    if (isExport && !canPerformAction(session.role, 'data:export')) {
      return NextResponse.json(
        { error: 'Forbidden: Viewers are not permitted to export data' },
        { status: 403 },
      );
    }

    if (isExport) {
      return new NextResponse('timestamp,amount,status\n', {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="transactions_export.csv"',
        },
      });
    }

    let rows: Array<{
      id: string;
      tenantId: string;
      amountPaise: number;
      discountPaise: number;
      status: string;
      service: string;
      serviceName: string;
      occurredAt: Date;
    }> = [];

    try {
      rows = await withTenantContext(session.tenant.id, async (tx) => {
        return await tx
          .select({
            id: transactions.id,
            tenantId: transactions.tenantId,
            amountPaise: transactions.amountPaise,
            discountPaise: transactions.discountPaise,
            status: transactions.status,
            service: transactions.service,
            serviceName: transactions.serviceName,
            occurredAt: transactions.occurredAt,
          })
          .from(transactions)
          .where(eq(transactions.tenantId, session.tenant.id))
          .orderBy(desc(transactions.occurredAt))
          .limit(500);
      });
    } catch {
      // Return empty report on offline/unreachable DB
      return NextResponse.json(emptyReport);
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json(emptyReport);
    }

    const salesByDayMap = new Map<string, { date: string; volumePaise: number; count: number; discountPaise: number }>();
    const salesByServiceMap = new Map<string, { service: string; volumePaise: number; count: number }>();
    const salesByOperatorMap = new Map<string, { operator: string; volumePaise: number; count: number }>();
    const hourlyCounts = new Array(24).fill(0).map((_, hour) => ({
      hour: `${hour.toString().padStart(2, '0')}:00`,
      volumePaise: 0,
      count: 0,
    }));

    let totalVolumePaise = 0;
    let totalDiscountPaise = 0;
    let successCount = 0;

    for (const r of rows) {
      const dateKey = r.occurredAt.toISOString().slice(0, 10);
      const hour = r.occurredAt.getHours();

      const dayEntry = salesByDayMap.get(dateKey) || { date: dateKey, volumePaise: 0, count: 0, discountPaise: 0 };
      dayEntry.volumePaise += r.amountPaise;
      dayEntry.discountPaise += r.discountPaise;
      dayEntry.count += 1;
      salesByDayMap.set(dateKey, dayEntry);

      const serviceEntry = salesByServiceMap.get(r.service) || { service: r.service, volumePaise: 0, count: 0 };
      serviceEntry.volumePaise += r.amountPaise;
      serviceEntry.count += 1;
      salesByServiceMap.set(r.service, serviceEntry);

      const opName = r.serviceName || r.service;
      const opEntry = salesByOperatorMap.get(opName) || { operator: opName, volumePaise: 0, count: 0 };
      opEntry.volumePaise += r.amountPaise;
      opEntry.count += 1;
      salesByOperatorMap.set(opName, opEntry);

      if (hour >= 0 && hour < 24) {
        hourlyCounts[hour]!.volumePaise += r.amountPaise;
        hourlyCounts[hour]!.count += 1;
      }

      totalVolumePaise += r.amountPaise;
      totalDiscountPaise += r.discountPaise;
      if (r.status === 'success') {
        successCount++;
      }
    }

    let peakHourIndex = 12;
    let maxHourlyCount = -1;
    hourlyCounts.forEach((hc, idx) => {
      if (hc.count > maxHourlyCount) {
        maxHourlyCount = hc.count;
        peakHourIndex = idx;
      }
    });

    const peakHourStr = `${peakHourIndex.toString().padStart(2, '0')}:00`;
    const successRateStr = rows.length > 0 ? `${((successCount / rows.length) * 100).toFixed(1)}%` : '0%';
    const avgTxnPaise = rows.length > 0 ? Math.round(totalVolumePaise / rows.length) : 0;

    const report = {
      summary: {
        totalVolumePaise,
        totalDiscountPaise,
        totalCount: rows.length,
        successRate: successRateStr,
        avgTxnPaise,
        peakHour: peakHourStr,
        vsPreviousPeriodPct: '+0%',
      },
      salesByDay: Array.from(salesByDayMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
      salesByService: Array.from(salesByServiceMap.values()),
      salesByOperator: Array.from(salesByOperatorMap.values()),
      salesByHour: hourlyCounts,
    };

    return NextResponse.json(report);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error processing reports';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
