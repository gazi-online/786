import { eq, and, sql, gte, notInArray } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { type AppTransaction, db } from '@/lib/db';
import {
  rechargeOrders,
  tenantRechargeSettings,
  auditLog,
  devices,
} from '@/drizzle/schema';
import { hashDeviceToken } from '@/lib/crypto';

export interface TenantRechargeSettingsData {
  tenantId: string;
  rechargeEnabled: boolean;
  perOrderMaxPaise: number;
  dailyMaxPaise: number;
  maxOrdersPerMinute: number;
}

export const DEFAULT_RECHARGE_SETTINGS: Omit<TenantRechargeSettingsData, 'tenantId'> = {
  rechargeEnabled: false,
  perOrderMaxPaise: 100000, // ₹1,000.00
  dailyMaxPaise: 500000, // ₹5,000.00
  maxOrdersPerMinute: 5,
};

/**
 * Fetch or initialize recharge settings for a tenant.
 */
export async function getTenantRechargeSettings(
  tenantId: string,
  tx: AppTransaction,
): Promise<TenantRechargeSettingsData> {
  const rows = await tx
    .select()
    .from(tenantRechargeSettings)
    .where(eq(tenantRechargeSettings.tenantId, tenantId))
    .limit(1);

  if (rows.length > 0 && rows[0]) {
    return {
      tenantId: rows[0].tenantId,
      rechargeEnabled: rows[0].rechargeEnabled,
      perOrderMaxPaise: rows[0].perOrderMaxPaise,
      dailyMaxPaise: rows[0].dailyMaxPaise,
      maxOrdersPerMinute: rows[0].maxOrdersPerMinute,
    };
  }

  // Not yet created in DB; return conservative defaults
  return {
    tenantId,
    ...DEFAULT_RECHARGE_SETTINGS,
  };
}

/**
 * Cancels all currently queued orders for a tenant.
 * Used when recharge is disabled or as an operational kill-switch helper.
 */
export async function cancelAllQueuedRechargeOrders(
  tenantId: string,
  actorId: string | null,
  tx: AppTransaction,
): Promise<{ cancelledCount: number }> {
  const queuedOrders = await tx
    .select({ id: rechargeOrders.id })
    .from(rechargeOrders)
    .where(
      and(
        eq(rechargeOrders.tenantId, tenantId),
        eq(rechargeOrders.status, 'queued'),
      ),
    );

  if (queuedOrders.length === 0) {
    return { cancelledCount: 0 };
  }

  const orderIds = queuedOrders.map((o) => o.id);
  const now = new Date();

  await tx
    .update(rechargeOrders)
    .set({
      status: 'cancelled',
      updatedAt: now,
    })
    .where(
      and(
        eq(rechargeOrders.tenantId, tenantId),
        eq(rechargeOrders.status, 'queued'),
      ),
    );

  // Write audit log entry for batch cancellation
  await tx.insert(auditLog).values({
    tenantId,
    actorId,
    action: 'cancel_all_queued_recharge_orders',
    targetType: 'recharge_orders',
    targetId: `${orderIds.length} orders`,
    meta: {
      cancelledCount: orderIds.length,
      reason: 'recharge_disabled_or_admin_cancel',
    },
    createdAt: now,
  });

  return { cancelledCount: orderIds.length };
}

export const RECHARGE_TIMEZONE = 'Asia/Kolkata';

/**
 * Returns a Date representing 00:00:00.000 in Asia/Kolkata for the given reference date (or now).
 * Since Asia/Kolkata is UTC+05:30 with no Daylight Saving Time,
 * 00:00:00 IST corresponds to 18:30:00 UTC of the previous calendar day.
 */
export function getStartOfIstDay(referenceDate: Date = new Date()): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: RECHARGE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(referenceDate);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;

  const istMidnightIso = `${year}-${month}-${day}T00:00:00.000+05:30`;
  return new Date(istMidnightIso);
}

/**
 * Returns true if two dates fall on the same calendar day in Asia/Kolkata.
 */
export function isSameIstDay(date1: Date, date2: Date): boolean {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: RECHARGE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date1) === formatter.format(date2);
}

/**
 * Calculates sum of amount_paise of non-failed, non-cancelled orders today (Asia/Kolkata IST day).
 */
export async function getTodayActiveRechargeTotalPaise(
  tenantId: string,
  tx: AppTransaction,
  referenceDate: Date = new Date(),
): Promise<number> {
  const startOfDay = getStartOfIstDay(referenceDate);

  const result = await tx
    .select({
      total: sql<string>`COALESCE(SUM(${rechargeOrders.amountPaise}), 0)`,
    })
    .from(rechargeOrders)
    .where(
      and(
        eq(rechargeOrders.tenantId, tenantId),
        gte(rechargeOrders.createdAt, startOfDay),
        notInArray(rechargeOrders.status, ['failed', 'cancelled']),
      ),
    );

  return parseInt(result[0]?.total || '0', 10);
}

/**
 * Checks for a potential duplicate order: same customerNoHash and amountPaise within the last 10 minutes
 * that is not failed or cancelled.
 */
export async function findRecentDuplicateOrder(
  tenantId: string,
  customerNoHash: string,
  amountPaise: number,
  tx: AppTransaction,
): Promise<boolean> {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  const recent = await tx
    .select({ id: rechargeOrders.id })
    .from(rechargeOrders)
    .where(
      and(
        eq(rechargeOrders.tenantId, tenantId),
        eq(rechargeOrders.customerNoHash, customerNoHash),
        eq(rechargeOrders.amountPaise, amountPaise),
        gte(rechargeOrders.createdAt, tenMinutesAgo),
        notInArray(rechargeOrders.status, ['failed', 'cancelled']),
      ),
    )
    .limit(1);

  return recent.length > 0;
}

export type DeviceAuthResult =
  | { ok: true; device: { id: string; tenantId: string; label: string | null } }
  | { ok: false; status: 401 | 503; error: string };

/**
 * Authenticates a device for recharge operations (Claim & Status updates).
 * Enforces DB-only verification (no in-memory fallback), strictly checks for revocation,
 * and allows x-test-device-id headers only during isolated unit testing.
 */
export async function verifyDeviceForRecharge(req: NextRequest): Promise<DeviceAuthResult> {
  // 1. Check test-header auth gating in non-production test mode
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.ALLOW_TEST_HEADER_AUTH === 'true'
  ) {
    const testDeviceId = req.headers.get('x-test-device-id');
    const testTenantId = req.headers.get('x-test-tenant-id');
    if (testDeviceId && testTenantId) {
      return {
        ok: true,
        device: {
          id: testDeviceId,
          tenantId: testTenantId,
          label: 'Test POS Device',
        },
      };
    }
  }

  // 2. Extract Bearer token
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return { ok: false, status: 401, error: 'Unauthorized: Missing device token' };
  }

  const tokenHash = hashDeviceToken(token);

  // 3. Database-only lookup (strictly no memory store for financial operations)
  try {
    const deviceRows = await db
      .select({
        id: devices.id,
        tenantId: devices.tenantId,
        label: devices.label,
        revokedAt: devices.revokedAt,
      })
      .from(devices)
      .where(eq(devices.tokenHash, tokenHash))
      .limit(1);

    const device = deviceRows[0];
    if (!device || device.revokedAt !== null) {
      return { ok: false, status: 401, error: 'Unauthorized: Invalid or revoked device token' };
    }

    return {
      ok: true,
      device: {
        id: device.id,
        tenantId: device.tenantId,
        label: device.label,
      },
    };
  } catch (err) {
    console.error('[Recharge Auth] Database error verifying device token:', err);
    return { ok: false, status: 503, error: 'Service Unavailable: Database error' };
  }
}


