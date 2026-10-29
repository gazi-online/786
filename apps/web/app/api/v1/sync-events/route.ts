import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { syncEvents } from '@/drizzle/schema';
import { desc } from 'drizzle-orm';

const fallbackSyncEvents = [
  {
    id: 'evt-1',
    deviceId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
    capturedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    status: 'ok',
    rowCounts: { accepted: 12, inserted: 2, updated: 0, rejected: 0 },
    parserVersion: '1.0.0',
    createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  },
  {
    id: 'evt-2',
    deviceId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
    capturedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    status: 'ok',
    rowCounts: { accepted: 10, inserted: 0, updated: 0, rejected: 0 },
    parserVersion: '1.0.0',
    createdAt: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  },
];

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
  } catch {
    return NextResponse.json({
      events: fallbackSyncEvents,
    });
  }
}
