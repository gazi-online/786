import { NextRequest, NextResponse } from 'next/server';
import { getTenantSession } from '@/lib/auth';
import { lookupTelecomDetails } from '@/lib/telecom';

export async function GET(req: NextRequest) {
  const session = await getTenantSession(req);
  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized: Authentication required' },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(req.url);
  const mobile = searchParams.get('mobile')?.trim() || '';

  const clean = mobile.replace(/\D/g, '');
  if (clean.length !== 10) {
    return NextResponse.json(
      { error: 'Invalid mobile number: Exactly 10 digits required' },
      { status: 400 },
    );
  }

  const result = lookupTelecomDetails(clean);
  if (!result) {
    return NextResponse.json(
      { error: 'Unable to resolve telecom operator and circle for this number' },
      { status: 404 },
    );
  }

  return NextResponse.json({ success: true, ...result }, { status: 200 });
}
