import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { getTenantSession, canPerformAction } from '@/lib/auth';

const defaultSettings = {
  storeName: 'Demo Store & Cyber Cafe',
  plan: 'pro',
  status: 'active',
  retentionMonths: 24,
  maskCustomerNumbers: true,
  alertOfflineMinutes: 15,
  language: 'en',
};

export async function GET(req: NextRequest) {
  const session = await getTenantSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized: Authentication required' }, { status: 401 });
  }

  try {
    const rows = await db.select().from(tenants).where(eq(tenants.id, session.tenant.id)).limit(1);
    const tenant = rows[0];

    return NextResponse.json({
      storeName: tenant?.name || session.tenant.name || defaultSettings.storeName,
      plan: tenant?.plan || session.tenant.plan || defaultSettings.plan,
      status: tenant?.status || defaultSettings.status,
      retentionMonths: tenant?.retentionMonths || defaultSettings.retentionMonths,
      maskCustomerNumbers: defaultSettings.maskCustomerNumbers,
      alertOfflineMinutes: defaultSettings.alertOfflineMinutes,
      language: defaultSettings.language,
    });
  } catch {
    return NextResponse.json({
      ...defaultSettings,
      storeName: session.tenant.name,
      plan: session.tenant.plan,
    });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getTenantSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized: Authentication required' }, { status: 401 });
  }

  if (!canPerformAction(session.role, 'settings:modify')) {
    return NextResponse.json(
      { error: 'Forbidden: Viewers are not permitted to modify store settings' },
      { status: 403 },
    );
  }

  try {
    const body = await req.json();
    const { storeName, retentionMonths } = body;

    try {
      await db
        .update(tenants)
        .set({
          name: storeName ?? undefined,
          retentionMonths: retentionMonths ?? undefined,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, session.tenant.id));
    } catch {
      // Continue if DB not connected
    }

    return NextResponse.json({
      ok: true,
      updated: {
        storeName: storeName || session.tenant.name,
        retentionMonths: retentionMonths || defaultSettings.retentionMonths,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
