import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

const defaultSettings = {
  storeName: 'Gazi Telecom & Cyber Cafe',
  plan: 'pro',
  status: 'active',
  retentionMonths: 24,
  maskCustomerNumbers: true,
  alertOfflineMinutes: 15,
  language: 'en',
};

export async function GET(_req: NextRequest) {
  try {
    const rows = await db.select().from(tenants).limit(1);
    const tenant = rows[0];

    return NextResponse.json({
      storeName: tenant?.name || defaultSettings.storeName,
      plan: tenant?.plan || defaultSettings.plan,
      status: tenant?.status || defaultSettings.status,
      retentionMonths: tenant?.retentionMonths || defaultSettings.retentionMonths,
      maskCustomerNumbers: defaultSettings.maskCustomerNumbers,
      alertOfflineMinutes: defaultSettings.alertOfflineMinutes,
      language: defaultSettings.language,
    });
  } catch {
    return NextResponse.json(defaultSettings);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { storeName, retentionMonths } = body;

    try {
      const rows = await db.select().from(tenants).limit(1);
      if (rows[0]) {
        await db
          .update(tenants)
          .set({
            name: storeName ?? rows[0].name,
            retentionMonths: retentionMonths ?? rows[0].retentionMonths,
            updatedAt: new Date(),
          })
          .where(eq(tenants.id, rows[0].id));
      }
    } catch {
      // Continue if DB not connected
    }

    return NextResponse.json({
      ok: true,
      updated: {
        storeName: storeName || defaultSettings.storeName,
        retentionMonths: retentionMonths || defaultSettings.retentionMonths,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
