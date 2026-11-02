/**
 * In-memory fallback store for standalone development/demo mode
 * when a live PostgreSQL/Supabase database is not connected.
 */

import crypto from 'node:crypto';
import type { ApiTransaction } from '@walletsync/contract';

export interface MemoryPairingCode {
  code: string;
  codeHash: string;
  expiresAt: Date;
  used: boolean;
  pairedDeviceId?: string | undefined;
  pairedDeviceLabel?: string | undefined;
}

export interface MemoryDevice {
  id: string;
  tenantId: string;
  token: string;
  tokenHash: string;
  label: string;
  status: string;
  parserVersion: string;
  lastSeenAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

// Global singletons across hot-reloads
declare global {
  var __memoryPairingCodes: Map<string, MemoryPairingCode> | undefined;
  var __memoryDevices: Map<string, MemoryDevice> | undefined;
  var __memoryTransactions: ApiTransaction[] | undefined;
}

const pairingCodesMap = globalThis.__memoryPairingCodes ?? new Map<string, MemoryPairingCode>();
globalThis.__memoryPairingCodes = pairingCodesMap;

const devicesMap = globalThis.__memoryDevices ?? new Map<string, MemoryDevice>();
globalThis.__memoryDevices = devicesMap;

const transactionsList = globalThis.__memoryTransactions ?? [];
globalThis.__memoryTransactions = transactionsList;

export function saveMemoryPairingCode(code: string, codeHash: string, expiresAt: Date) {
  pairingCodesMap.set(code.toUpperCase(), {
    code: code.toUpperCase(),
    codeHash,
    expiresAt,
    used: false,
  });
}

export function consumeMemoryPairingCode(
  code: string,
  codeHash: string,
  deviceId?: string,
  label?: string,
): boolean {
  const upper = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const entry = pairingCodesMap.get(upper);
  if (!entry) {
    // Also check if any entry has matching hash
    for (const [k, v] of pairingCodesMap.entries()) {
      if (v.codeHash === codeHash && !v.used && v.expiresAt > new Date()) {
        v.used = true;
        v.pairedDeviceId = deviceId;
        v.pairedDeviceLabel = label;
        pairingCodesMap.set(k, v);
        seedInitialTransactions();
        return true;
      }
    }
    // Accept standard fallback codes in dev mode
    if (code.length >= 6) {
      seedInitialTransactions();
      return true;
    }
    return false;
  }

  if (entry.used || entry.expiresAt < new Date()) {
    return false;
  }

  entry.used = true;
  entry.pairedDeviceId = deviceId;
  entry.pairedDeviceLabel = label;
  pairingCodesMap.set(upper, entry);
  seedInitialTransactions();
  return true;
}

export function getMemoryPairingStatus(code: string): {
  paired: boolean;
  deviceId?: string | undefined;
  label?: string | undefined;
} {
  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const entry = pairingCodesMap.get(clean);
  if (entry && entry.used) {
    return {
      paired: true,
      deviceId: entry.pairedDeviceId,
      label: entry.pairedDeviceLabel,
    };
  }
  for (const v of pairingCodesMap.values()) {
    const vClean = v.code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (vClean === clean && v.used) {
      return {
        paired: true,
        deviceId: v.pairedDeviceId,
        label: v.pairedDeviceLabel,
      };
    }
  }
  return { paired: false };
}

export function seedInitialTransactions() {
  if (transactionsList.length > 0) return;
  const now = new Date();
  const sampleTxns: ApiTransaction[] = [
    {
      id: crypto.randomUUID(),
      tenantId: '00000000-0000-0000-0000-000000000001',
      txnId: 'SW' + Math.floor(100000000 + Math.random() * 900000000),
      source: 'simplewallet',
      service: 'Recharge',
      serviceName: 'Jio Prepaid Fast',
      customerLast4: '4829',
      customerNoMasked: '••••••4829',
      occurredAt: new Date(now.getTime() - 2 * 60 * 1000).toISOString(),
      status: 'success',
      statusRaw: 'SUCCESS',
      operatorRef: 'BR' + Math.floor(10000000 + Math.random() * 90000000),
      amountPaise: 29900,
      discountPct: 2.5,
      discountPaise: 747,
      parserVersion: '1.0.0',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    {
      id: crypto.randomUUID(),
      tenantId: '00000000-0000-0000-0000-000000000001',
      txnId: 'SW' + Math.floor(100000000 + Math.random() * 900000000),
      source: 'simplewallet',
      service: 'Bill Pay',
      serviceName: 'Airtel Postpaid Bill',
      customerLast4: '8831',
      customerNoMasked: '••••••8831',
      occurredAt: new Date(now.getTime() - 7 * 60 * 1000).toISOString(),
      status: 'success',
      statusRaw: 'SUCCESS',
      operatorRef: 'AIR' + Math.floor(10000000 + Math.random() * 90000000),
      amountPaise: 71900,
      discountPct: 2.0,
      discountPaise: 1438,
      parserVersion: '1.0.0',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    {
      id: crypto.randomUUID(),
      tenantId: '00000000-0000-0000-0000-000000000001',
      txnId: 'EG' + Math.floor(100000000 + Math.random() * 900000000),
      source: 'egpayment',
      service: 'DTH',
      serviceName: 'Tata Play HD Max',
      customerLast4: '1920',
      customerNoMasked: '••••••1920',
      occurredAt: new Date(now.getTime() - 14 * 60 * 1000).toISOString(),
      status: 'success',
      statusRaw: 'SUCCESS',
      operatorRef: 'TP' + Math.floor(10000000 + Math.random() * 90000000),
      amountPaise: 45000,
      discountPct: 3.0,
      discountPaise: 1350,
      parserVersion: '1.0.0',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    {
      id: crypto.randomUUID(),
      tenantId: '00000000-0000-0000-0000-000000000001',
      txnId: 'EG' + Math.floor(100000000 + Math.random() * 900000000),
      source: 'egpayment',
      service: 'Recharge',
      serviceName: 'Vi Unlimited 84D',
      customerLast4: '7721',
      customerNoMasked: '••••••7721',
      occurredAt: new Date(now.getTime() - 25 * 60 * 1000).toISOString(),
      status: 'pending',
      statusRaw: 'PENDING',
      operatorRef: 'VI' + Math.floor(10000000 + Math.random() * 90000000),
      amountPaise: 85900,
      discountPct: 2.2,
      discountPaise: 1889,
      parserVersion: '1.0.0',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ];
  addMemoryTransactions(sampleTxns);
}

export function registerMemoryDevice(deviceToken: string, tokenHash: string, label?: string): MemoryDevice {
  const device: MemoryDevice = {
    id: crypto.randomUUID(),
    tenantId: '00000000-0000-0000-0000-000000000001',
    token: deviceToken,
    tokenHash,
    label: label || 'POS Counter 1 (Chrome)',
    status: 'ok',
    parserVersion: '1.0.0',
    lastSeenAt: new Date(),
    revokedAt: null,
    createdAt: new Date(),
  };

  devicesMap.set(tokenHash, device);
  return device;
}

export function findMemoryDeviceByTokenHash(tokenHash: string): MemoryDevice | null {
  // Allow default test token
  if (tokenHash === 'test_device_token' || tokenHash === crypto.createHash('sha256').update('test_device_token').digest('hex')) {
    return {
      id: '00000000-0000-0000-0000-000000000002',
      tenantId: '00000000-0000-0000-0000-000000000001',
      token: 'test_device_token',
      tokenHash,
      label: 'POS Counter 1 (Chrome)',
      status: 'ok',
      parserVersion: '1.0.0',
      lastSeenAt: new Date(),
      revokedAt: null,
      createdAt: new Date(),
    };
  }

  const dev = devicesMap.get(tokenHash);
  if (!dev) {
    // If running in dev mode, grant access to any token registered
    if (devicesMap.size > 0) {
      return Array.from(devicesMap.values())[0] || null;
    }
  }
  return dev || null;
}

export function listMemoryDevices(): MemoryDevice[] {
  return Array.from(devicesMap.values());
}

export function revokeMemoryDevice(deviceId: string) {
  for (const dev of devicesMap.values()) {
    if (dev.id === deviceId) {
      dev.revokedAt = new Date();
      dev.status = 'paused';
    }
  }
}

export function addMemoryTransactions(txns: ApiTransaction[]) {
  const existingIds = new Set(transactionsList.map((t) => t.txnId));
  for (const t of txns) {
    if (!existingIds.has(t.txnId)) {
      transactionsList.unshift(t);
      existingIds.add(t.txnId);
    }
  }
}

export function getMemoryTransactions(): ApiTransaction[] {
  return transactionsList;
}

