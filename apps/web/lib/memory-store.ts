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

export function consumeMemoryPairingCode(code: string, codeHash: string): boolean {
  const upper = code.toUpperCase();
  const entry = pairingCodesMap.get(upper);
  if (!entry) {
    // Also check if any entry has matching hash
    for (const [k, v] of pairingCodesMap.entries()) {
      if (v.codeHash === codeHash && !v.used && v.expiresAt > new Date()) {
        v.used = true;
        pairingCodesMap.set(k, v);
        return true;
      }
    }
    // Accept standard fallback codes in dev mode
    if (code.length >= 6) {
      return true;
    }
    return false;
  }

  if (entry.used || entry.expiresAt < new Date()) {
    return false;
  }

  entry.used = true;
  pairingCodesMap.set(upper, entry);
  return true;
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

