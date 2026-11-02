import type { DeviceStatus, IngestRequest, IngestTransaction } from '@walletsync/contract';

export const MIN_AUTO_CLICK_INTERVAL_SECONDS = 60;

export interface StorageData {
  // Device & API configuration
  deviceId: string | null;
  deviceToken: string | null;
  apiUrl: string;
  portalUrl: string; // Amd-8: per-device portal URL config

  // Status & Health
  status: DeviceStatus;
  lastSyncTime: string | null;
  errorMessage: string | null;
  isPaused: boolean;

  // Per-Portal status tracking
  simplewalletLastSync: string | null;
  egpaymentLastSync: string | null;
  simplewalletCount: number;
  egpaymentCount: number;

  // Preferences
  pollingIntervalMinutes: number; // default 2, min 1
  keepAliveMode: 'fetch' | 'reload';

  // Auto-click setting (Round 10: defaults to safest option, capped minimum)
  autoClickEnabled: boolean; // default: false (safest option)
  autoClickIntervalSeconds: number; // default: 120, minimum: 60

  // Metrics for popup display
  todayCount: number;
  todayAmountPaise: number;
  recentTransactions: Array<{
    txnId: string;
    source?: 'simplewallet' | 'egpayment';
    service: string;
    serviceName: string;
    customerLast4: string;
    customerMasked: string;
    amountPaise: number;
    status: string;
    occurredAt: string;
  }>;

  // Offline buffer (last 50 payloads)
  offlineQueue: IngestRequest[];
}

// Build-time API origin injected by WXT config from WALLETSYNC_API_ORIGIN env var
declare const __BUILD_API_URL__: string | undefined;

export const DEFAULT_STORAGE: StorageData = {
  deviceId: null,
  deviceToken: null,
  apiUrl:
    typeof __BUILD_API_URL__ !== 'undefined' && __BUILD_API_URL__
      ? __BUILD_API_URL__
      : 'https://api.walletsync.example.com',
  portalUrl: 'https://simplewallet.in/web/MyTrans.aspx?ST=1&mID=824&PID=821',
  status: 'ok',
  lastSyncTime: null,
  errorMessage: null,
  isPaused: false,
  simplewalletLastSync: null,
  egpaymentLastSync: null,
  simplewalletCount: 0,
  egpaymentCount: 0,
  pollingIntervalMinutes: 2,
  keepAliveMode: 'fetch',
  autoClickEnabled: false, // Safest default: off until merchant explicitly enables it
  autoClickIntervalSeconds: 120, // Capped at MIN_AUTO_CLICK_INTERVAL_SECONDS (60s)
  todayCount: 0,
  todayAmountPaise: 0,
  recentTransactions: [],
  offlineQueue: [],
};

export async function getStorage(): Promise<StorageData> {
  const result = await chrome.storage.local.get(null);
  return { ...DEFAULT_STORAGE, ...result } as StorageData;
}

export async function setStorage(data: Partial<StorageData>): Promise<void> {
  await chrome.storage.local.set(data);
}
