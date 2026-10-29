import type { DeviceStatus, IngestRequest, IngestTransaction } from '@walletsync/contract';

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

export const DEFAULT_STORAGE: StorageData = {
  deviceId: null,
  deviceToken: null,
  apiUrl: 'http://localhost:3000',
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

