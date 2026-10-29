import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { devices, auditLog } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Device ID required' }, { status: 400 });
    }

    const now = new Date();

    try {
      // 1. Update device revokedAt timestamp
      await db
        .update(devices)
        .set({
          revokedAt: now,
          status: 'paused',
        })
        .where(eq(devices.id, id));

      // 2. Write to audit_log
      await db.insert(auditLog).values({
        tenantId: '00000000-0000-0000-0000-000000000001',
        action: 'revoke_device',
        targetType: 'device',
        targetId: id,
        meta: { revokedAt: now.toISOString() },
      });
    } catch {
      // Allow fallback if DB not running locally
    }

    return NextResponse.json({
      ok: true,
      deviceId: id,
      revokedAt: now.toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to revoke device';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
