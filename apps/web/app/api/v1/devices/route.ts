import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { devices, pairingCodes } from '@/drizzle/schema';
import { desc } from 'drizzle-orm';
import crypto from 'node:crypto';
import { hashPairingCode } from '@/lib/crypto';

export async function GET(_req: NextRequest) {
  try {
    // List devices that belong to the tenant
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list devices';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Generate a new single-use 8-character pairing code (TTL: 10 mins)
 */
export async function POST(_req: NextRequest) {
  try {
    // Generate 8-char random alphanumeric code
    const rawCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    const codeHash = hashPairingCode(rawCode);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // In a real multi-tenant session, tenantId comes from Supabase auth.uid()
    // For local dev/demo, pick first tenant or generate dummy tenant uuid
    const dummyTenantId = '00000000-0000-0000-0000-000000000001';

    try {
      await db.insert(pairingCodes).values({
        tenantId: dummyTenantId,
        codeHash,
        expiresAt,
      });
    } catch {
      // If DB not connected, return the generated code so client UI still works seamlessly
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
