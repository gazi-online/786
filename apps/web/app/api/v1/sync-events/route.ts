import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { syncEvents } from '@/drizzle/schema';
import { desc } from 'drizzle-orm';

export async function GET(_req: NextRequest) {
  try {
    const rows = await db
      .select()
      .from(syncEvents)
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list sync events';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
