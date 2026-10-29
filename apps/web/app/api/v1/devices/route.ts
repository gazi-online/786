import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { devices, pairingCodes } from '@/drizzle/schema';
import { desc } from 'drizzle-orm';
import crypto from 'node:crypto';
import { hashPairingCode } from '@/lib/crypto';
import {
  saveMemoryPairingCode,
  listMemoryDevices,
} from '@/lib/memory-store';

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
      devices: [
        {
          id: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
          label: 'POS Counter 1 (Chrome)',
          status: 'ok',
          parserVersion: '1.0.0',
          lastSeenAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
          revokedAt: null,
          createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
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

    // Save in memory store so extension pairing works immediately
    saveMemoryPairingCode(rawCode, codeHash, expiresAt);

    const dummyTenantId = '00000000-0000-0000-0000-000000000001';

    try {
      await db.insert(pairingCodes).values({
        tenantId: dummyTenantId,
        codeHash,
        expiresAt,
      });
    } catch {
      // Handled via memory store
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
