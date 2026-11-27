import { NextRequest, NextResponse } from 'next/server';
import { getTenantSession } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';

  // 1. IP Rate Limiting (max 20 signin attempts per minute)
  const ipRateLimit = await checkRateLimit(`auth:signin:ip:${ip}`, 20, 60);
  if (!ipRateLimit.success) {
    return NextResponse.json(
      { error: 'Too many requests: Rate limit exceeded. Try again later.' },
      { status: 429 },
    );
  }

  // 2. Resolve session from token / cookie
  const session = await getTenantSession(req);
  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid credentials or session expired' },
      { status: 401 },
    );
  }

  // 3. Account rate limiting per user ID
  const accountRateLimit = await checkRateLimit(`auth:signin:user:${session.user.id}`, 20, 60);
  if (!accountRateLimit.success) {
    return NextResponse.json(
      { error: 'Too many requests for this account. Try again later.' },
      { status: 429 },
    );
  }

  return NextResponse.json({
    ok: true,
    user: session.user,
    tenant: session.tenant,
    role: session.role,
  });
}

