import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, type AppTransaction } from '@/lib/db';
import { pairingCodes, devices } from '@/drizzle/schema';
import { eq, and, isNull, gt } from 'drizzle-orm';
import {
  hashPairingCode,
  generateDeviceToken,
  hashDeviceToken,
} from '@/lib/crypto';
import { isUnambiguousCode } from '@/lib/pairing-code';
import { checkRateLimit } from '@/lib/rate-limit';
import { broadcastSseEvent } from '@/lib/sse';
import {
  consumeMemoryPairingCode,
  registerMemoryDevice,
} from '@/lib/memory-store';

const PairRequestSchema = z.object({
  code: z.string().min(8).max(16),
  label: z.string().optional(),
});

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-requested-with',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST(req: NextRequest) {
  try {
    // 1. Rate limiting on pairing attempts per IP and per code in shared store
    const clientIp = req.headers.get('x-forwarded-for') || 'anon';
    const ipRateLimit = await checkRateLimit(`pair:ip:${clientIp}`, 10, 60);
    if (!ipRateLimit.success) {
      return NextResponse.json(
        { error: 'Too many pairing attempts from this IP' },
        { status: 429, headers: { 'Retry-After': '60' } },
      );
    }

    // 2. Body validation
    const json = await req.json();
    const parseResult = PairRequestSchema.safeParse(json);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid pairing request', details: parseResult.error.format() },
        { status: 422 },
      );
    }

    const { code, label } = parseResult.data;
    const cleanCode = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!isUnambiguousCode(cleanCode)) {
      return NextResponse.json(
        { error: 'Invalid pairing code: must be 8 characters from unambiguous alphabet (excluding 0, O, 1, I)' },
        { status: 400 },
      );
    }
    const codeHash = hashPairingCode(cleanCode);
    const now = new Date();

    // Rate limit per code (lock code after 5 failed attempts)
    const codeRateLimit = await checkRateLimit(`pair:code:${codeHash}`, 5, 600);
    if (!codeRateLimit.success) {
      return NextResponse.json(
        { error: 'Pairing code is locked due to too many failed attempts' },
        { status: 429, headers: { 'Retry-After': '600' } },
      );
    }

    const isDev = process.env.NODE_ENV !== 'production';
    let deviceId: string | undefined;
    let deviceToken: string | undefined;

    // 3. Try PostgreSQL if connected
    try {
      const pairResult = await db.transaction(async (tx: AppTransaction) => {
        const matchingCodes = await tx
          .select()
          .from(pairingCodes)
          .where(
            and(
              eq(pairingCodes.codeHash, codeHash),
              isNull(pairingCodes.usedAt),
              gt(pairingCodes.expiresAt, now),
            ),
          );

        const activeCode = matchingCodes[0];
        if (!activeCode) {
          return null;
        }

        await tx
          .update(pairingCodes)
          .set({ usedAt: now })
          .where(eq(pairingCodes.id, activeCode.id));

        const rawDeviceToken = generateDeviceToken();
        const tokenHash = hashDeviceToken(rawDeviceToken);

        const [newDevice] = await tx
          .insert(devices)
          .values({
            tenantId: activeCode.tenantId,
            tokenHash,
            label: label || 'Chrome Extension',
            status: 'ok',
            lastSeenAt: now,
          })
          .returning();

        return {
          deviceId: newDevice?.id,
          deviceToken: rawDeviceToken,
        };
      });

      if (pairResult) {
        deviceId = pairResult.deviceId;
        deviceToken = pairResult.deviceToken;
      }
    } catch {
      if (!isDev) {
        return NextResponse.json(
          { error: 'Database not configured or unavailable' },
          { status: 503, headers: CORS_HEADERS },
        );
      }
      // In dev, continue to memory check
    }

    // 4. In-memory check ONLY for local development / demo
    if (isDev && (!deviceId || !deviceToken)) {
      const rawDeviceToken = generateDeviceToken();
      const tokenHash = hashDeviceToken(rawDeviceToken);
      const memDevice = registerMemoryDevice(rawDeviceToken, tokenHash, label);
      const isValid = consumeMemoryPairingCode(cleanCode, codeHash, memDevice.id, label || 'POS Terminal (Chrome)');
      if (isValid) {
        deviceId = memDevice.id;
        deviceToken = rawDeviceToken;
      }
    }

    if (!deviceId || !deviceToken) {
      return NextResponse.json(
        { error: 'Invalid or expired pairing code' },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    // Broadcast real-time SSE event to all connected dashboard tabs
    broadcastSseEvent('device.paired', {
      deviceId,
      label: label || 'POS Terminal (Chrome)',
      serverTime: now.toISOString(),
    });

    // Also notify transaction update so dashboard immediately fetches latest stream
    broadcastSseEvent('transaction.updated', {
      reason: 'device_paired',
      serverTime: now.toISOString(),
    });

    return NextResponse.json(
      {
        deviceId,
        deviceToken,
        serverTime: now.toISOString(),
      },
      { status: 201, headers: CORS_HEADERS },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Pairing failed';
    return NextResponse.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
}
