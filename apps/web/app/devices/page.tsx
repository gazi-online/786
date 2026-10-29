'use client';

import React, { useEffect, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { useI18n } from '@/lib/i18n-context';
import { formatKolkataDate } from '@/lib/i18n';
import {
  Cpu,
  ShieldCheck,
  Smartphone,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  RefreshCw,
  AlertCircle,
  Activity,
} from 'lucide-react';

interface DeviceItem {
  id: string;
  label: string;
  status: string;
  parserVersion: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface SyncEvent {
  id: string;
  deviceId: string | null;
  capturedAt: string;
  status: string;
  rowCounts: { accepted?: number; inserted?: number; updated?: number; rejected?: number };
  parserVersion: string;
}

export default function DevicesPage() {
  const { t } = useI18n();
  const [devicesList, setDevicesList] = useState<DeviceItem[]>([]);
  const [syncEvents, setSyncEvents] = useState<SyncEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pairing Modal state
  const [showPairModal, setShowPairModal] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [devRes, evtRes] = await Promise.all([
        fetch('/api/v1/devices'),
        fetch('/api/v1/sync-events'),
      ]);

      if (devRes.ok) {
        const dJson = await devRes.json();
        setDevicesList(dJson.devices || []);
      }
      if (evtRes.ok) {
        const eJson = await evtRes.json();
        setSyncEvents(eJson.events || []);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading devices');
    } finally {
      setLoading(false);
    }
  }

  async function handleGeneratePairingCode() {
    setGeneratingCode(true);
    try {
      const res = await fetch('/api/v1/devices', { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        setPairingCode(json.code);
        setShowPairModal(true);
      }
    } catch {
      alert('Failed to generate pairing code');
    } finally {
      setGeneratingCode(false);
    }
  }

  async function handleRevokeDevice(id: string) {
    if (!window.confirm(t.devices.revokeConfirm)) return;

    try {
      const res = await fetch(`/api/v1/devices/${id}/revoke`, { method: 'POST' });
      if (res.ok) {
        setDevicesList((prev) =>
          prev.map((d) => (d.id === id ? { ...d, status: 'paused', revokedAt: new Date().toISOString() } : d)),
        );
      } else {
        alert('Failed to revoke device');
      }
    } catch {
      alert('Network error while revoking device');
    }
  }

  return (
    <AppLayout>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-6 border-b border-zinc-200 dark:border-zinc-800 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.devices.title}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {t.devices.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleGeneratePairingCode}
            disabled={generatingCode}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            {t.devices.pairNewDevice}
          </button>
          <button
            onClick={loadData}
            className="p-2 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title={t.common.refresh}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Read-Only Guarantee Box */}
      <div className="my-6 p-4 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/20 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
        <div className="space-y-1">
          <span className="text-xs font-bold text-blue-900 dark:text-blue-200 uppercase tracking-wide">
            {t.devices.readOnlyBadge}
          </span>
          <p className="text-xs text-blue-800 dark:text-blue-300">
            {t.devices.readOnlyExplanation}
          </p>
        </div>
      </div>

      {/* STATE 1: LOADING SKELETON */}
      {loading && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-40 rounded-xl bg-zinc-200 dark:bg-zinc-800/60 animate-pulse" />
            ))}
          </div>
          <div className="h-64 rounded-xl bg-zinc-200 dark:bg-zinc-800/60 animate-pulse" />
        </div>
      )}

      {/* STATE 2: ERROR */}
      {error && !loading && (
        <div className="my-8 p-6 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 text-center">
          <AlertCircle className="w-8 h-8 mx-auto text-red-500 mb-2" />
          <h3 className="font-semibold text-red-900 dark:text-red-200">{t.common.error}</h3>
          <p className="text-xs text-red-600 dark:text-red-400 mt-1 mb-4">{error}</p>
          <button
            onClick={loadData}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
          >
            {t.common.retry}
          </button>
        </div>
      )}

      {/* STATE 3: EMPTY DEVICES */}
      {!loading && !error && devicesList.length === 0 && (
        <div className="my-8 p-12 text-center border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900">
          <Cpu className="w-10 h-10 mx-auto text-zinc-400 mb-3" />
          <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
            {t.devices.emptyDevices}
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-sm mx-auto">
            {t.devices.emptyDevicesDesc}
          </p>
          <button
            onClick={handleGeneratePairingCode}
            className="mt-4 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            {t.devices.pairNewDevice}
          </button>
        </div>
      )}

      {/* STATE 4: POPULATED DEVICES & ACTIVITY */}
      {!loading && !error && devicesList.length > 0 && (
        <div className="space-y-8">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-4">
              {t.devices.activeDevices}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {devicesList.map((dev) => {
                const isRevoked = Boolean(dev.revokedAt);
                return (
                  <div
                    key={dev.id}
                    className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs space-y-3"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-700 dark:text-zinc-300">
                          <Smartphone className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            {dev.label}
                          </h3>
                          <span className="text-[11px] font-mono text-zinc-400">ID: {dev.id.slice(0, 8)}...</span>
                        </div>
                      </div>

                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                          isRevoked
                            ? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                            : dev.status === 'ok'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                        }`}
                      >
                        {isRevoked ? (
                          t.devices.revoked
                        ) : dev.status === 'ok' ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            {t.devices.statusOk}
                          </>
                        ) : (
                          <>
                            <AlertTriangle className="w-3 h-3" />
                            {dev.status}
                          </>
                        )}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-zinc-100 dark:border-zinc-800">
                      <div>
                        <span className="text-zinc-400 block">{t.devices.parserVersion}</span>
                        <span className="font-mono text-zinc-700 dark:text-zinc-300">
                          v{dev.parserVersion}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-400 block">{t.common.lastSynced}</span>
                        <span className="text-zinc-700 dark:text-zinc-300 tabular-nums">
                          {dev.lastSeenAt ? formatKolkataDate(dev.lastSeenAt) : t.common.neverSynced}
                        </span>
                      </div>
                    </div>

                    {!isRevoked && (
                      <div className="pt-2 flex justify-end">
                        <button
                          onClick={() => handleRevokeDevice(dev.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {t.devices.revoke}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sync Events Activity Log */}
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-600" />
              {t.devices.syncHistory}
            </h2>

            {syncEvents.length === 0 ? (
              <div className="p-6 text-center border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900 text-xs text-zinc-400">
                No sync activity logged yet.
              </div>
            ) : (
              <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900 shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-50 dark:bg-zinc-950/60 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 font-medium">
                    <tr>
                      <th className="py-3 px-4">{t.common.date}</th>
                      <th className="py-3 px-4">{t.common.status}</th>
                      <th className="py-3 px-4 text-right">{t.devices.rowsAccepted}</th>
                      <th className="py-3 px-4 text-right">{t.devices.parserVersion}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {syncEvents.map((evt) => (
                      <tr key={evt.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                        <td className="py-3 px-4 text-zinc-700 dark:text-zinc-300 tabular-nums">
                          {formatKolkataDate(evt.capturedAt)}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              evt.status === 'ok'
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                            }`}
                          >
                            {evt.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-medium text-zinc-900 dark:text-zinc-100">
                          {evt.rowCounts.accepted ?? evt.rowCounts.inserted ?? 0}
                        </td>
                        <td className="py-3 px-4 text-right text-zinc-500 font-mono">
                          v{evt.parserVersion}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pairing Code Dialog */}
      {showPairModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              {t.devices.modalTitle}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t.devices.modalDesc}
            </p>

            <div className="p-4 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
              <span className="font-mono text-2xl font-bold tracking-widest text-blue-600 dark:text-blue-400">
                {pairingCode}
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(pairingCode);
                  setCopiedCode(true);
                  setTimeout(() => setCopiedCode(false), 2000);
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 hover:bg-zinc-50 flex items-center gap-1.5 shadow-2xs"
              >
                {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedCode ? t.common.copied : t.common.copy}</span>
              </button>
            </div>

            <p className="text-[11px] text-zinc-400">
              {t.devices.extensionInstruction}
            </p>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowPairModal(false)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-700"
              >
                {t.common.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
