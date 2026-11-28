import { NextRequest, NextResponse } from 'next/server';
import { getTenantSession, canPerformAction } from '@/lib/auth';
import { withTenantContext } from '@/lib/db';
import { tenantRechargeSettings, auditLog } from '@/drizzle/schema';
import { UpdateRechargeSettingsRequestSchema } from '@walletsync/contract';
import {
  getTenantRechargeSettings,
  cancelAllQueuedRechargeOrders,
} from '@/lib/recharge';

export async function GET(req: NextRequest) {
  const session = await getTenantSession(req);
  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized: Authentication required' },
      { status: 401 },
    );
  }

  if (!canPerformAction(session.role, 'dashboard:view')) {
    return NextResponse.json(
      { error: 'Forbidden: Insufficient permissions' },
      { status: 403 },
    );
  }

  try {
    return await withTenantContext(session.tenant.id, async (tx) => {
      const settings = await getTenantRechargeSettings(session.tenant.id, tx);
      return NextResponse.json({ settings }, { status: 200 });
    });
  } catch (err) {
    console.error('[Recharge Settings] Database error in GET:', err);
    return NextResponse.json(
      { error: 'Service Unavailable: Database is currently unreachable' },
      { status: 503 },
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await getTenantSession(req);
  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized: Authentication required' },
      { status: 401 },
    );
  }

  // Owner and admin allowed, viewer denied
  if (!canPerformAction(session.role, 'settings:modify')) {
    return NextResponse.json(
      { error: 'Forbidden: Insufficient permissions to modify recharge settings' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = UpdateRechargeSettingsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const {
    rechargeEnabled,
    perOrderMaxPaise,
    dailyMaxPaise,
    maxOrdersPerMinute,
    cancelQueuedOnDisable,
  } = parsed.data;

  try {
    return await withTenantContext(session.tenant.id, async (tx) => {
      const current = await getTenantRechargeSettings(session.tenant.id, tx);
      const isDisabling =
        rechargeEnabled === false && current.rechargeEnabled === true;

      let cancelledCount = 0;
      // If turning recharge_enabled off, or if explicitly requested, cancel all queued orders
      if (isDisabling || cancelQueuedOnDisable) {
        const cancelResult = await cancelAllQueuedRechargeOrders(
          session.tenant.id,
          session.user.id,
          tx,
        );
        cancelledCount = cancelResult.cancelledCount;
      }

      const now = new Date();

      const newSettings = {
        tenantId: session.tenant.id,
        rechargeEnabled:
          rechargeEnabled !== undefined ? rechargeEnabled : current.rechargeEnabled,
        perOrderMaxPaise:
          perOrderMaxPaise !== undefined ? perOrderMaxPaise : current.perOrderMaxPaise,
        dailyMaxPaise:
          dailyMaxPaise !== undefined ? dailyMaxPaise : current.dailyMaxPaise,
        maxOrdersPerMinute:
          maxOrdersPerMinute !== undefined
            ? maxOrdersPerMinute
            : current.maxOrdersPerMinute,
        updatedAt: now,
      };

      await tx
        .insert(tenantRechargeSettings)
        .values({
          ...newSettings,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: tenantRechargeSettings.tenantId,
          set: {
            rechargeEnabled: newSettings.rechargeEnabled,
            perOrderMaxPaise: newSettings.perOrderMaxPaise,
            dailyMaxPaise: newSettings.dailyMaxPaise,
            maxOrdersPerMinute: newSettings.maxOrdersPerMinute,
            updatedAt: now,
          },
        });

      // Write audit log entry
      await tx.insert(auditLog).values({
        tenantId: session.tenant.id,
        actorId: session.user.id,
        action: isDisabling ? 'disable_recharge_kill_switch' : 'update_recharge_settings',
        targetType: 'tenant_recharge_settings',
        targetId: session.tenant.id,
        meta: {
          previousEnabled: current.rechargeEnabled,
          newEnabled: newSettings.rechargeEnabled,
          perOrderMaxPaise: newSettings.perOrderMaxPaise,
          dailyMaxPaise: newSettings.dailyMaxPaise,
          maxOrdersPerMinute: newSettings.maxOrdersPerMinute,
          cancelledQueuedCount: cancelledCount,
        },
        createdAt: now,
      });

      return NextResponse.json(
        {
          settings: newSettings,
          cancelledQueuedCount: cancelledCount,
        },
        { status: 200 },
      );
    });
  } catch (err) {
    console.error('[Recharge Settings] Database error in POST:', err);
    return NextResponse.json(
      { error: 'Service Unavailable: Database is currently unreachable' },
      { status: 503 },
    );
  }
}

