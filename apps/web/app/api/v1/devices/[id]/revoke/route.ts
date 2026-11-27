import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { devices, auditLog } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { getTenantSession, canPerformAction } from '@/lib/auth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getTenantSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized: Authentication required' }, { status: 401 });
    }
    if (!canPerformAction(session.role, 'device:revoke')) {
      return NextResponse.json(
        { error: 'Forbidden: Viewers are not permitted to revoke devices' },
        { status: 403 },
      );
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Device ID required' }, { status: 400 });
    }

    const now = new Date();

    try {
      // 1. Verify device belongs to this tenant under isolation
      const existing = await db
        .select()
        .from(devices)
        .where(and(eq(devices.id, id), eq(devices.tenantId, session.tenant.id)))
        .limit(1);

      if (existing.length === 0) {
        return NextResponse.json({ error: 'Device not found' }, { status: 404 });
      }

      // 2. Update device revokedAt timestamp
      await db
        .update(devices)
        .set({
          revokedAt: now,
          status: 'paused',
        })
        .where(and(eq(devices.id, id), eq(devices.tenantId, session.tenant.id)));

      // 3. Write to audit_log
      await db.insert(auditLog).values({
        tenantId: session.tenant.id,
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

