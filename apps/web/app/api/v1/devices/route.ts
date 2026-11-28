import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { devices, pairingCodes } from '@/drizzle/schema';
import { and, desc, eq } from 'drizzle-orm';
import { hashPairingCode } from '@/lib/crypto';
import { generateUnambiguousPairingCode } from '@/lib/pairing-code';
import { getTenantSession, canPerformAction } from '@/lib/auth';
import {
  saveMemoryPairingCode,
  listMemoryDevices,
  isMemoryPairingCodeUsed,
} from '@/lib/memory-store';

export async function GET(req: NextRequest) {
  const session = await getTenantSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized: Authentication required' }, { status: 401 });
  }

  const checkCode = req.nextUrl.searchParams.get('checkCode');
  let checkCodeClean = '';
  let checkCodeHash = '';
  if (checkCode) {
    checkCodeClean = checkCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (checkCodeClean.length >= 6) {
      checkCodeHash = hashPairingCode(checkCodeClean);
    }
  }

  try {
    let paired = false;
    if (checkCodeHash) {
      const codeRows = await db
        .select({ usedAt: pairingCodes.usedAt })
        .from(pairingCodes)
        .where(
          and(
            eq(pairingCodes.tenantId, session.tenant.id),
            eq(pairingCodes.codeHash, checkCodeHash),
          ),
        )
        .limit(1);
      if (codeRows[0]?.usedAt) {
        paired = true;
      } else if (isMemoryPairingCodeUsed(checkCodeClean, checkCodeHash)) {
        paired = true;
      }
    }

    const rows = await db
      .select()
      .from(devices)
      .where(eq(devices.tenantId, session.tenant.id))
      .orderBy(desc(devices.createdAt))
      .limit(50);

    return NextResponse.json({
      paired,
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
    const paired = checkCodeHash
      ? isMemoryPairingCodeUsed(checkCodeClean, checkCodeHash)
      : false;
    const memDevs = listMemoryDevices();
    if (memDevs.length > 0) {
      return NextResponse.json({
        paired,
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
      paired,
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
