import { NextRequest, NextResponse } from 'next/server';
import { signUpUser } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';

  // 1. IP Rate Limiting (e.g. max 10 signups per minute per IP)
  const ipRateLimit = await checkRateLimit(`auth:signup:ip:${ip}`, 10, 60);
  if (!ipRateLimit.success) {
    return NextResponse.json(
      { error: 'Too many requests: Rate limit exceeded. Try again later.' },
      { status: 429 },
    );
  }

  // 2. Extract Bearer token from authorization header or cookie
  const authHeader = req.headers.get('authorization');
  let token = '';
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else {
    const cookie = req.cookies.get('sb-auth-token')?.value;
    if (cookie) token = cookie;
  }

  if (!token) {
    return NextResponse.json(
      { error: 'Unauthorized: Valid Supabase JWT required for tenant sign-up' },
      { status: 401 },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const storeName = typeof body?.storeName === 'string' ? body.storeName : undefined;

    // 3. Account / Token rate limiting
    const tokenHash = token.slice(-16);
    const accountRateLimit = await checkRateLimit(`auth:signup:token:${tokenHash}`, 5, 60);
    if (!accountRateLimit.success) {
      return NextResponse.json(
        { error: 'Too many requests for this account. Try again later.' },
        { status: 429 },
      );
    }

    // 4. Provision tenant and owner (userId derived solely from verified JWT sub)
    const result = await signUpUser({ token, storeName });

    return NextResponse.json(
      {
        ok: true,
        tenant: result.tenant,
        membership: result.membership,
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Sign-up failed';
    const isConflict =
      message.toLowerCase().includes('one tenant per user') ||
      message.toLowerCase().includes('already an owner');
    const isUnauthorized = message.toLowerCase().includes('unauthorized');
    const status = isConflict ? 409 : isUnauthorized ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

