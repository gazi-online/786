import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { syncEvents } from '@/drizzle/schema';
import { desc, eq } from 'drizzle-orm';
import { getTenantSession } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const session = await getTenantSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized: Authentication required' }, { status: 401 });
  }

  try {
    const rows = await db
      .select()
      .from(syncEvents)
      .where(eq(syncEvents.tenantId, session.tenant.id))
      .orderBy(desc(syncEvents.capturedAt))
      .limit(30);

    const portalStats: Record<string, { balancePaise: number | null; commissionPaise: number | null; updatedAt: string }> = {};
    for (const r of rows) {
      const counts = r.rowCounts as { portal?: string; balancePaise?: number | null; commissionPaise?: number | null };
      const p = counts?.portal || 'simplewallet';
      if (!portalStats[p] && (counts?.balancePaise !== undefined || counts?.commissionPaise !== undefined)) {
        portalStats[p] = {
          balancePaise: counts.balancePaise ?? null,
          commissionPaise: counts.commissionPaise ?? null,
          updatedAt: r.capturedAt.toISOString(),
        };
      }
    }

    return NextResponse.json({
      events: rows.map((e) => ({
        id: e.id,
        deviceId: e.deviceId,
        capturedAt: e.capturedAt.toISOString(),
        status: e.status,
        rowCounts: e.rowCounts,
        parserVersion: e.parserVersion || '1.0.0',
        createdAt: e.createdAt.toISOString(),
      })),
      portalStats,
    });
  } catch {
    return NextResponse.json({
      events: [],
      portalStats: {},
    });
  }
}
