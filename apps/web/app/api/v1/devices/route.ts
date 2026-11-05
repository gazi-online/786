import { NextRequest, NextResponse } from 'next/server';
import { db, withTenantContext } from '@/lib/db';
import { devices, pairingCodes } from '@/drizzle/schema';
import { desc, eq, and } from 'drizzle-orm';
import { hashPairingCode } from '@/lib/crypto';
import { generateUnambiguousPairingCode } from '@/lib/pairing-code';
import { getTenantSession, canPerformAction } from '@/lib/auth';
import {
  saveMemoryPairingCode,
  listMemoryDevices,
  getMemoryPairingStatus,
} from '@/lib/memory-store';

export async function GET(req: NextRequest) {
  const session = await getTenantSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized: Authentication required' }, { status: 401 });
  }

  // Check pairing code claim status if requested
  const codeParam = req.nextUrl.searchParams.get('code');
  if (codeParam) {
    const clean = codeParam.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const codeHash = hashPairingCode(clean);

    try {
      const matchingCodes = await db
        .select()
        .from(pairingCodes)
        .where(and(eq(pairingCodes.tenantId, session.tenant.id), eq(pairingCodes.codeHash, codeHash)));
      const found = matchingCodes[0];
      if (found && found.usedAt) {
        const recentDevices = await db
          .select()
          .from(devices)
          .where(eq(devices.tenantId, session.tenant.id))
          .orderBy(desc(devices.createdAt))
          .limit(1);
        return NextResponse.json({
          paired: true,
          deviceId: recentDevices[0]?.id || 'terminal-db',
          label: recentDevices[0]?.label || 'POS Terminal (Chrome)',
        });
      }
    } catch {
      // Database not available; fallback to memory store
    }

    const memStatus = process.env.NODE_ENV !== 'production' ? getMemoryPairingStatus(clean) : { paired: false };
    if (memStatus.paired) {
      return NextResponse.json({
        paired: true,
        deviceId: memStatus.deviceId || 'terminal-mem',
        label: memStatus.label || 'POS Terminal (Chrome)',
      });
    }

    return NextResponse.json({ paired: false });
  }

  const isDev = process.env.NODE_ENV !== 'production';

  try {
    const rows = await withTenantContext(session.tenant.id, async (tx) => {
      return await tx
        .select()
        .from(devices)
        .where(eq(devices.tenantId, session.tenant.id))
        .orderBy(desc(devices.createdAt))
        .limit(50);
    });

    return NextResponse.json({
      devices: rows.map((d) => ({
        id: d.id,
        label: d.label || 'POS Terminal (Chrome)',
        status: d.status,
        parserVersion: d.parserVersion || '1.0.0',
        extensionVersion: d.extensionVersion || d.parserVersion || '1.0.0',
        portal: d.portal || null,
        portalLoggedIn: d.portalLoggedIn ?? true,
        lastSyncAt: d.lastSyncAt?.toISOString() || null,
        errorCategory: d.errorCategory || null,
        lastSeenAt: d.lastSeenAt?.toISOString() || null,
        revokedAt: d.revokedAt?.toISOString() || null,
        createdAt: d.createdAt.toISOString(),
      })),
    });
  } catch {
    if (isDev) {
      const memDevs = listMemoryDevices();
      if (memDevs.length > 0) {
        return NextResponse.json({
          devices: memDevs.map((d) => ({
            id: d.id,
            label: d.label,
            status: d.status,
            parserVersion: d.parserVersion,
            extensionVersion: d.extensionVersion || d.parserVersion || '1.0.0',
            portal: d.portal || null,
            portalLoggedIn: d.portalLoggedIn ?? true,
            lastSyncAt: d.lastSyncAt ? d.lastSyncAt.toISOString() : null,
            errorCategory: d.errorCategory || null,
            lastSeenAt: d.lastSeenAt.toISOString(),
            revokedAt: d.revokedAt ? d.revokedAt.toISOString() : null,
            createdAt: d.createdAt.toISOString(),
          })),
        });
      }

      return NextResponse.json({
        devices: [],
      });
    }

    return NextResponse.json(
      { error: 'Database not configured or unavailable' },
      { status: 503 },
    );
  }
}

/**
 * Generate a new single-use 8-character pairing code (TTL: 10 mins)
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getTenantSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized: Authentication required' }, { status: 401 });
    }
    if (!canPerformAction(session.role, 'pairing:create')) {
      return NextResponse.json(
        { error: 'Forbidden: Viewers are not permitted to create pairing codes' },
        { status: 403 },
      );
    }

    const { clean: rawCode, formatted } = generateUnambiguousPairingCode();
    const codeHash = hashPairingCode(rawCode);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const isDev = process.env.NODE_ENV !== 'production';

    if (isDev) {
      // Save in memory store ONLY in local development
      saveMemoryPairingCode(rawCode, codeHash, expiresAt);
    }

    try {
      await db.insert(pairingCodes).values({
        tenantId: session.tenant.id,
        codeHash,
        expiresAt,
      });
    } catch {
      if (!isDev) {
        return NextResponse.json(
          { error: 'Database not configured or unavailable' },
          { status: 503 },
        );
      }
      // In dev, allow memory fallback
    }

    return NextResponse.json({
      code: formatted,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create pairing code';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
