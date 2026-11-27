import {
  getMemoryWhatsAppSettings,
  setMemoryWhatsAppSettings,
  type MemoryWhatsAppSettings,
} from '@/lib/memory-store';
import { extractCustomerLast4 } from '@/lib/crypto';

export interface WhatsAppSettings {
  enabled: boolean;
  apiUrl: string;
  apiKey: string;
  notifyNumber: string;
}

export interface WhatsAppAlertPayload {
  event: 'transaction.alert' | 'test.ping';
  recipient: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

export interface WhatsAppDispatchResult {
  success: boolean;
  status?: number;
  error?: string;
}

export interface IngestAlertRow {
  source: string;
  txnId: string;
  service: string;
  serviceName: string;
  customerNo: string;
  status: string;
  statusRaw?: string;
  amountPaise: number;
  occurredAt: string;
  operatorRef?: string;
}

/**
 * Resolves current WhatsApp settings for a tenant.
 * Hierarchy:
 * 1. Tenant in-memory store
 * 2. Environment variable fallbacks (if configured)
 * 3. Safe defaults (disabled)
 */
export function getWhatsAppSettings(tenantId: string): WhatsAppSettings {
  const stored = getMemoryWhatsAppSettings(tenantId);
  if (stored) {
    return { ...stored };
  }

  // Fallback to environment variables if provided
  const envUrl =
    process.env.WHATSAPP_API_URL ||
    'https://openwa-integration-service.vercel.app/api/send';
  const envKey = process.env.WHATSAPP_API_KEY || '';
  const envNumber = process.env.WHATSAPP_NOTIFY_NUMBER || '';
  const envEnabled = process.env.WHATSAPP_NOTIFY_ENABLED === 'true';

  return {
    enabled: envEnabled,
    apiUrl: envUrl,
    apiKey: envKey,
    notifyNumber: envNumber,
  };
}

/**
 * Saves WhatsApp settings for a tenant.
 */
export function saveWhatsAppSettings(
  tenantId: string,
  updates: Partial<WhatsAppSettings>,
): WhatsAppSettings {
  const current = getWhatsAppSettings(tenantId);
  const updated: MemoryWhatsAppSettings = {
    enabled: updates.enabled !== undefined ? updates.enabled : current.enabled,
    apiUrl: updates.apiUrl !== undefined ? updates.apiUrl.trim() : current.apiUrl,
    apiKey: updates.apiKey !== undefined ? updates.apiKey.trim() : current.apiKey,
    notifyNumber:
      updates.notifyNumber !== undefined ? updates.notifyNumber.trim() : current.notifyNumber,
  };

  return setMemoryWhatsAppSettings(tenantId, updated);
}

/**
 * Formats a clean, readable WhatsApp alert message.
 * Strictly adheres to PII safety rules: Customer mobile number is always masked
 * to last 4 digits (e.g. ••••••1234).
 */
export function formatWhatsAppAlert(row: IngestAlertRow): string {
  const amountRupees = (row.amountPaise / 100).toFixed(2);
  const last4 = extractCustomerLast4(row.customerNo);
  const statusEmoji =
    row.status === 'success'
      ? '✅'
      : row.status === 'pending'
        ? '⏳'
        : row.status === 'refunded'
          ? '↩️'
          : '❌';

  const lines = [
    `🔔 *WalletSync - New Transaction Alert*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `💰 *Amount:* ₹${amountRupees}`,
    `${statusEmoji} *Status:* ${row.status.toUpperCase()}`,
    `🆔 *Txn ID:* \`${row.txnId}\``,
    `🏦 *Portal:* ${row.source} (${row.serviceName})`,
    `👤 *Customer:* ••••••${last4}`,
  ];

  if (row.operatorRef) {
    lines.push(`📑 *Ref / Order:* ${row.operatorRef}`);
  }

  lines.push(`🕒 *Time:* ${row.occurredAt}`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━`);

  return lines.join('\n');
}

/**
 * Sends a POST webhook payload to the configured WhatsApp service URL.
 * Catches all network/HTTP errors to guarantee fail-safe operation.
 */
export async function sendWhatsAppNotification(
  settings: WhatsAppSettings,
  payload: WhatsAppAlertPayload,
): Promise<WhatsAppDispatchResult> {
  if (!settings.enabled) {
    return { success: false, error: 'WhatsApp notifications are disabled' };
  }

  if (!settings.apiUrl) {
    return { success: false, error: 'WhatsApp API / Webhook URL is not configured' };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'WalletSync-Webhook/1.0',
    };

    if (settings.apiKey) {
      headers['X-API-Key'] = settings.apiKey;
      headers['Authorization'] = settings.apiKey.startsWith('Bearer ')
        ? settings.apiKey
        : `Bearer ${settings.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    // Formatted payload compatible with both OpenWA Developer Hub (phone, text)
    // and standard webhook endpoints (recipient, message, data).
    const cleanPhone = (settings.notifyNumber || '').replace(/^\+/, '').trim();
    const requestBody = {
      phone: cleanPhone,
      text: payload.message,
      recipient: settings.notifyNumber,
      message: payload.message,
      event: payload.event,
      data: payload.data,
      timestamp: payload.timestamp,
    };

    const response = await fetch(settings.apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return {
        success: false,
        status: response.status,
        error: `HTTP ${response.status}: ${errorText.slice(0, 200)}`,
      };
    }

    return {
      success: true,
      status: response.status,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Network dispatch error: ${msg}`,
    };
  }
}

/**
 * Dispatches alerts for newly ingested transactions.
 * Handled safely so errors never interfere with ingestion.
 */
export async function dispatchWhatsAppTransactionAlerts(
  tenantId: string,
  rows: IngestAlertRow[],
): Promise<void> {
  const settings = getWhatsAppSettings(tenantId);
  if (!settings.enabled || !settings.apiUrl) {
    return;
  }

  for (const row of rows) {
    const message = formatWhatsAppAlert(row);
    const last4 = extractCustomerLast4(row.customerNo);

    await sendWhatsAppNotification(settings, {
      event: 'transaction.alert',
      recipient: settings.notifyNumber,
      message,
      data: {
        txnId: row.txnId,
        source: row.source,
        service: row.service,
        serviceName: row.serviceName,
        customerLast4: last4,
        status: row.status,
        amountPaise: row.amountPaise,
        occurredAt: row.occurredAt,
        operatorRef: row.operatorRef || '',
      },
      timestamp: new Date().toISOString(),
    }).catch((err) => {
      console.warn('[WhatsApp Alert] Failed to dispatch webhook for txn:', row.txnId, err);
    });
  }
}

/**
 * Sends a test verification ping to confirm WhatsApp API integration.
 */
export async function sendWhatsAppTestAlert(
  tenantId: string,
  customSettings?: Partial<WhatsAppSettings>,
): Promise<WhatsAppDispatchResult> {
  const current = getWhatsAppSettings(tenantId);
  const settings: WhatsAppSettings = {
    ...current,
    ...customSettings,
    enabled: true, // Force enabled for test ping
  };

  const testMessage = [
    `🔔 *WalletSync - WhatsApp Integration Test*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `✅ Status: Connection verified successfully!`,
    `🏢 Tenant ID: \`${tenantId}\``,
    `🕒 Time: ${new Date().toISOString()}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `You will receive instant alerts here whenever transactions are synced from your wallet portals.`,
  ].join('\n');

  return sendWhatsAppNotification(settings, {
    event: 'test.ping',
    recipient: settings.notifyNumber,
    message: testMessage,
    data: {
      tenantId,
      test: true,
    },
    timestamp: new Date().toISOString(),
  });
}
