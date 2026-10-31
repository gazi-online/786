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
    });
  } catch {
    return NextResponse.json({
      events: [],
    });
  }
}
