import { NextRequest, NextResponse } from 'next/server';
import { getTenantSession, canPerformAction } from '@/lib/auth';
import { sendWhatsAppTestAlert } from '@/lib/whatsapp';

export async function POST(req: NextRequest) {
  const session = await getTenantSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized: Authentication required' }, { status: 401 });
  }

  if (!canPerformAction(session.role, 'settings:modify')) {
    return NextResponse.json(
      { error: 'Forbidden: Viewers are not permitted to send test notifications' },
      { status: 403 },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const result = await sendWhatsAppTestAlert(session.tenant.id, body.whatsapp);
    if (!result.success) {
      return NextResponse.json(
        { ok: false, error: result.error || 'Failed to dispatch test notification' },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      message: 'Test alert sent successfully to WhatsApp API',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
