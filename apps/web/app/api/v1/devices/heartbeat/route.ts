import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { devices } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { hashDeviceToken } from '@/lib/crypto';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  findMemoryDeviceByTokenHash,
  updateMemoryDeviceHeartbeat,
} from '@/lib/memory-store';

const HeartbeatSchema = z.object({
  extensionVersion: z.string().max(32),
  portal: z.enum(['simplewallet', 'egpayment']).nullable(),
  portalLoggedIn: z.boolean(),
  lastSyncAt: z.string().nullable(),
  errorCategory: z.string().nullable(),
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
  const now = new Date();

  // 1. Authenticate device token from Authorization header
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return NextResponse.json(
      { error: 'Missing device token' },
      { status: 401, headers: CORS_HEADERS },
    );
  }

  const tokenHash = hashDeviceToken(token);
  const isDev = process.env.NODE_ENV === 'development';

  let device: { id: string; revokedAt: Date | null } | null = null;

  try {
    const deviceList = await db
      .select({ id: devices.id, revokedAt: devices.revokedAt })
      .from(devices)
      .where(eq(devices.tokenHash, tokenHash));

    if (deviceList[0]) {
      device = deviceList[0];
    }
  } catch {
    // Database offline / unavailable
  }

  if (!device && isDev) {
    const memDevice = findMemoryDeviceByTokenHash(tokenHash);
    if (memDevice) {
      device = { id: memDevice.id, revokedAt: memDevice.revokedAt };
    }
  }

  if (!device || device.revokedAt !== null) {
    return NextResponse.json(
      { error: 'Invalid or revoked device token' },
      { status: 401, headers: CORS_HEADERS },
    );
  }

  // 2. Rate limiting: 120 heartbeats/min per device
  const rateLimit = await checkRateLimit(`heartbeat:device:${device.id}`, 120, 60);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { ...CORS_HEADERS, 'Retry-After': '60' } },
    );
  }

  // 3. Validate request payload with Zod
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const parseResult = HeartbeatSchema.safeParse(bodyJson);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid heartbeat payload', details: parseResult.error.format() },
      { status: 422, headers: CORS_HEADERS },
    );
  }

  const { extensionVersion, portal, portalLoggedIn, lastSyncAt, errorCategory } = parseResult.data;
  const parsedLastSyncAt = lastSyncAt ? new Date(lastSyncAt) : null;

  // 4. Update device row in PostgreSQL
  try {
    await db
      .update(devices)
      .set({
        lastSeenAt: now,
        extensionVersion,
        portal,
        portalLoggedIn,
        lastSyncAt: parsedLastSyncAt && !isNaN(parsedLastSyncAt.getTime()) ? parsedLastSyncAt : null,
        errorCategory,
      })
      .where(eq(devices.id, device.id));
  } catch {
    // If DB update fails in production, report 503
    if (!isDev) {
      return NextResponse.json(
        { error: 'Database not configured or unavailable' },
        { status: 503, headers: CORS_HEADERS },
      );
    }
  }

  // 5. Update memory store in development
  if (isDev) {
    updateMemoryDeviceHeartbeat(tokenHash, {
      extensionVersion,
      portal,
      portalLoggedIn,
      lastSyncAt: parsedLastSyncAt && !isNaN(parsedLastSyncAt.getTime()) ? parsedLastSyncAt : null,
      errorCategory,
      lastSeenAt: now,
    });
  }

  return NextResponse.json(
    { ok: true, serverTime: now.toISOString() },
    { status: 200, headers: CORS_HEADERS },
  );
}
