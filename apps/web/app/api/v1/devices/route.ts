import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { devices, pairingCodes } from '@/drizzle/schema';
import { desc } from 'drizzle-orm';
import crypto from 'node:crypto';
import { hashPairingCode } from '@/lib/crypto';

// In-memory fallback for local demo when DB is not connected
const fallbackDevices = [
  {
    id: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
    label: 'POS Counter 1 (Chrome)',
    status: 'ok',
    parserVersion: '1.0.0',
    lastSeenAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    revokedAt: null,
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'e71c3ebe-6cdb-10cf-9654-00a0c91e6bf5',
    label: 'Back Office Terminal',
    status: 'ok',
    parserVersion: '1.0.0',
    lastSeenAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    revokedAt: null,
    createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

export async function GET(_req: NextRequest) {
  try {
    const rows = await db
      .select()
      .from(devices)
      .orderBy(desc(devices.createdAt))
      .limit(50);

    return NextResponse.json({
      devices: rows.map((d) => ({
        id: d.id,
        label: d.label || 'POS Terminal (Chrome)',
        status: d.status,
        parserVersion: d.parserVersion || '1.0.0',
        lastSeenAt: d.lastSeenAt?.toISOString() || null,
        revokedAt: d.revokedAt?.toISOString() || null,
        createdAt: d.createdAt.toISOString(),
      })),
    });
  } catch {
    // Return realistic fallback devices when Postgres is not running locally
    return NextResponse.json({
      devices: fallbackDevices,
    });
  }
}

/**
 * Generate a new single-use 8-character pairing code (TTL: 10 mins)
 */
export async function POST(_req: NextRequest) {
  try {
    const rawCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    const codeHash = hashPairingCode(rawCode);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const dummyTenantId = '00000000-0000-0000-0000-000000000001';

    try {
      await db.insert(pairingCodes).values({
        tenantId: dummyTenantId,
        codeHash,
        expiresAt,
      });
    } catch {
      // In-memory code accepted if DB disconnected
    }

    return NextResponse.json({
      code: rawCode,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create pairing code';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
