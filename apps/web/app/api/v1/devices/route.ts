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

    const memStatus = getMemoryPairingStatus(clean);
    if (memStatus.paired) {
      return NextResponse.json({
        paired: true,
        deviceId: memStatus.deviceId || 'terminal-mem',
        label: memStatus.label || 'POS Terminal (Chrome)',
      });
    }

    return NextResponse.json({ paired: false });
  }

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
        lastSeenAt: d.lastSeenAt?.toISOString() || null,
        revokedAt: d.revokedAt?.toISOString() || null,
        createdAt: d.createdAt.toISOString(),
      })),
    });
  } catch {
    const memDevs = listMemoryDevices();
    if (memDevs.length > 0) {
      return NextResponse.json({
        devices: memDevs.map((d) => ({
          id: d.id,
          label: d.label,
          status: d.status,
          parserVersion: d.parserVersion,
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

    // Save in memory store so extension pairing works immediately
    saveMemoryPairingCode(rawCode, codeHash, expiresAt);

    try {
      await db.insert(pairingCodes).values({
        tenantId: session.tenant.id,
        codeHash,
        expiresAt,
      });
    } catch {
      // Handled via memory store
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
