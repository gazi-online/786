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
import { checkRateLimit } from '@/lib/rate-limit';

const PairRequestSchema = z.object({
  code: z.string().min(6).max(12),
  label: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    // 1. Rate limiting on pairing attempts
    const clientIp = req.headers.get('x-forwarded-for') || 'anon';
    const rateLimit = await checkRateLimit(`pair:${clientIp}`, 10, 60);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: 'Too many pairing attempts' },
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
    const codeHash = hashPairingCode(code);
    const now = new Date();

    // 3. Find and consume valid pairing code in a transaction
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

      // Mark pairing code as used
      await tx
        .update(pairingCodes)
        .set({ usedAt: now })
        .where(eq(pairingCodes.id, activeCode.id));

      // Generate device token
      const rawDeviceToken = generateDeviceToken();
      const tokenHash = hashDeviceToken(rawDeviceToken);

      // Create new device row
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

    if (!pairResult) {
      return NextResponse.json(
        { error: 'Invalid or expired pairing code' },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        deviceId: pairResult.deviceId,
        deviceToken: pairResult.deviceToken,
        serverTime: now.toISOString(),
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
