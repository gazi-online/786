'use client';

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import type { ApiTransaction } from '@walletsync/contract';
import { AppLayout } from '@/components/AppLayout';
import { useI18n } from '@/lib/i18n-context';
import { formatPaise, formatKolkataDate } from '@/lib/i18n';
import { getClientCache, setClientCache } from '@/lib/client-cache';
import {
  CheckCircle2,
  Clock,
  XCircle,
  RotateCcw,
  AlertTriangle,
  Search,
  Eye,
  EyeOff,
  Smartphone,
  Copy,
  Check,
  RefreshCw,
  Sparkles,
  X,
  ChevronRight,
  ArrowUpRight,
  Layers,
  FileCode,
} from 'lucide-react';

interface Stats {
  totalAmountPaise: number;
  totalCount: number;
  successCount: number;
  discountPaise: number;
  walletBalancePaise: number | null;
}

export default function DashboardPage() {
  const { t } = useI18n();
  const [transactions, setTransactions] = useState<ApiTransaction[]>([]);
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const [revealedNumbers, setRevealedNumbers] = useState<Record<string, string>>({});
  const [selectedTxn, setSelectedTxn] = useState<ApiTransaction | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [portalFilter, setPortalFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [serviceFilter, setServiceFilter] = useState('all');

  // Device health state
  const [deviceStatus, setDeviceStatus] = useState<string>('ok');
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  // Live Device Status & Heartbeat
  const [deviceHeartbeat, setDeviceHeartbeat] = useState<{
    id: string | null;
    status: 'connected' | 'offline' | 'not_paired';
    portalLoggedIn: boolean;
    portal: string | null;
    lastSeenAt: string | null;
    lastSyncAt: string | null;
    label: string | null;
    extensionVersion: string | null;
  }>({
    id: null,
    status: 'not_paired',
    portalLoggedIn: true,
    portal: null,
    lastSeenAt: null,
    lastSyncAt: null,
    label: null,
    extensionVersion: null,
  });

  // Active Device Details Modal state
  const [showDeviceDetailsModal, setShowDeviceDetailsModal] = useState(false);

  // SSE & Fallback state (ADR-004)
  const [isConnected, setIsConnected] = useState(false);
  const lastEventTimeRef = useRef<number>(Date.now());

  // Pairing Modal state
  const [showPairModal, setShowPairModal] = useState(false);
  const [pairingCode, setPairingCode] = useState('SYNC-7489');
  const [copiedCode, setCopiedCode] = useState(false);
  const activePairingCodeRef = useRef<string | null>(null);
  const seenDeviceIdsRef = useRef<Set<string>>(new Set());
  const lastNotifiedDeviceIdRef = useRef<string | null>(null);
  const isPairSuccessActiveRef = useRef(false);
  const burstTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Real-time Device Paired Notification State
  const [pairedDeviceToast, setPairedDeviceToast] = useState<{
    show: boolean;
    deviceId: string;
    label: string;
    time: string;
  } | null>(null);

  // Portal Operations Hub State (Direct Web App Control)
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncToastMessage, setSyncToastMessage] = useState<string | null>(null);
  const [showDirectIngestModal, setShowDirectIngestModal] = useState(false);
  const [directIngestHtml, setDirectIngestHtml] = useState('');
  const [isIngestingHtml, setIsIngestingHtml] = useState(false);
  const [directIngestError, setDirectIngestError] = useState<string | null>(null);
  const [directIngestSuccess, setDirectIngestSuccess] = useState<string | null>(null);

  // 1. Initial data fetch with instant 0ms client-side cache & continuous 5s auto-fetch
  useEffect(() => {
    const cached = getClientCache<ApiTransaction[]>('dashboard_txns');
    if (cached && cached.length > 0) {
      setTransactions(cached);
      setLoading(false);
      setLastSyncTime(cached[0]?.occurredAt || null);
    }
    fetchTransactions(false);

    // Continuous auto-fetch every 5 seconds to ensure live transaction stream auto-updates
    const autoFetchTimer = setInterval(() => {
      fetchTransactions(true);
    }, 5000);

    return () => {
      clearInterval(autoFetchTimer);
      if (burstTimerRef.current) {
        clearInterval(burstTimerRef.current);
        burstTimerRef.current = null;
      }
    };
  }, []);

  // 1b. Poll device live heartbeat status every 10 seconds (CHANGE 3)
  useEffect(() => {
    let active = true;

    async function pollDeviceStatus() {
      try {
        const res = await fetch('/api/v1/devices');
        if (!res.ok) return;
        const data = await res.json();
        const devList: Array<{
          id: string;
          label?: string;
          lastSeenAt?: string | null;
          lastSyncAt?: string | null;
          portalLoggedIn?: boolean;
          portal?: string | null;
          revokedAt?: string | null;
          extensionVersion?: string | null;
          parserVersion?: string | null;
        }> = data.devices || [];

        if (!active) return;

        if (devList.length === 0) {
          setDeviceHeartbeat({
            id: null,
            status: 'not_paired',
            portalLoggedIn: true,
            portal: null,
            lastSeenAt: null,
            lastSyncAt: null,
            label: null,
            extensionVersion: null,
          });
          return;
        }

        const activeDev = devList.find((d) => !d.revokedAt) || devList[0];
        const lastSeenMs = activeDev?.lastSeenAt ? new Date(activeDev.lastSeenAt).getTime() : 0;
        const isConnected = lastSeenMs > 0 && Date.now() - lastSeenMs <= 2 * 60 * 1000;

        setDeviceHeartbeat({
          id: activeDev?.id || null,
          status: isConnected ? 'connected' : 'offline',
          portalLoggedIn: activeDev?.portalLoggedIn !== false,
          portal: activeDev?.portal || null,
          lastSeenAt: activeDev?.lastSeenAt || null,
          lastSyncAt: activeDev?.lastSyncAt || null,
          label: activeDev?.label || 'POS Terminal (Chrome)',
          extensionVersion: activeDev?.extensionVersion || activeDev?.parserVersion || '1.0.0',
        });
      } catch {
        // network or background error
      }
    }

    pollDeviceStatus();
    const interval = setInterval(pollDeviceStatus, 10000); // 10s poll

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  async function fetchTransactions(silent = false) {
    const cached = getClientCache<ApiTransaction[]>('dashboard_txns');
    if (!silent && (!cached || cached.length === 0)) {
      setLoading(true);
    }
    if (!silent) {
      setError(null);
    }
    try {
      const res = await fetch('/api/v1/transactions?limit=100');
      if (res.status === 304) return;
      if (res.status === 401) {
        // Never auto-logout or force redirect during live stream refresh or polling.
        // Route access is cleanly guarded on page transitions by Next.js middleware.
        if (!silent) {
          setError('Session or authorization refresh needed. Please sign in again if issues persist.');
        }
        return;
      }
      if (!res.ok) throw new Error('Failed to load transactions');
      const data = await res.json();
      const items: ApiTransaction[] = data.items || [];

      setTransactions((prev) => {
        // If background silent poll returns empty, preserve previous transactions to prevent flash of empty state
        if (silent && items.length === 0 && prev.length > 0) {
          return prev;
        }

        if (items.length === 0) {
          return [];
        }

        // Highlight brand new transactions that were not present previously
        if (prev.length > 0) {
          const prevIds = new Set(prev.map((p) => p.txnId));
          const newTxnIds = items.filter((it) => !prevIds.has(it.txnId)).map((it) => it.txnId);
          if (newTxnIds.length > 0) {
            setHighlightedIds(new Set(newTxnIds));
            setTimeout(() => {
              setHighlightedIds(new Set());
            }, 1200);
          }
        }

        // Merge incoming transactions with previous stream by txnId:
        // Updates existing transaction statuses and prepends new ones without ever removing existing rows
        const txnMap = new Map(prev.map((t) => [t.txnId, t]));
        for (const item of items) {
          txnMap.set(item.txnId, item);
        }

        return Array.from(txnMap.values()).sort(
          (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
        );
      });

      if (items.length > 0) {
        setClientCache('dashboard_txns', items);
        setClientCache('txns_all_all_all', items);
        setLastSyncTime(items[0]?.occurredAt || null);
        setDeviceStatus('ok');
      } else if (!silent) {
        setClientCache('dashboard_txns', []);
        setClientCache('txns_all_all_all', []);
      }
    } catch (err: unknown) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Error fetching data');
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  // 2. Server-Sent Events setup with ADR-004 Reconnect & Polling Fallback
  useEffect(() => {
    let eventSource: EventSource | null = null;

    function connectSSE() {
      try {
        eventSource = new EventSource('/api/v1/stream');

        eventSource.onopen = () => {
          setIsConnected(true);
          lastEventTimeRef.current = Date.now();
        };

        eventSource.addEventListener('transaction.updated', (_event) => {
          lastEventTimeRef.current = Date.now();
          // Instant auto-fetch when event arrives
          fetchTransactions(true);
        });

        eventSource.addEventListener('device.paired', (event) => {
          lastEventTimeRef.current = Date.now();
          try {
            const data = JSON.parse(event.data);
            triggerDevicePairedSuccess(data.deviceId, data.label);
          } catch {
            triggerDevicePairedSuccess('ws-pos-term', 'POS Terminal (Chrome)');
          }
        });

        eventSource.onerror = () => {
          setIsConnected(false);
          eventSource?.close();
          setTimeout(connectSSE, 5000);
        };
      } catch {
        setIsConnected(false);
      }
    }

    connectSSE();

    return () => {
      eventSource?.close();
    };
  }, []);

  function triggerDevicePairedSuccess(deviceId?: string, label?: string) {
    // Debounce to prevent multiple simultaneous triggers from parallel SSE and polling loops
    if (isPairSuccessActiveRef.current) return;
    isPairSuccessActiveRef.current = true;
    setTimeout(() => {
      isPairSuccessActiveRef.current = false;
    }, 4000);

    setShowPairModal(false);
    setShowDeviceDetailsModal(false);
    const time = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setPairedDeviceToast({
      show: true,
      deviceId: deviceId || 'ws-pos-term',
      label: label || 'POS Terminal (Chrome)',
      time,
    });

    // Auto-dismiss the success modal after 4.5 seconds so merchant is never stuck
    setTimeout(() => {
      setPairedDeviceToast(null);
    }, 4500);

    // 1. Instantly fetch latest transactions from backend
    fetchTransactions(false);

    // 2. Clear any active burst timer before scheduling a new smooth sequence
    if (burstTimerRef.current) {
      clearInterval(burstTimerRef.current);
      burstTimerRef.current = null;
    }

    // 3. Smooth burst polling spaced 2.5s apart for 10 seconds (4 attempts total)
    let attempts = 0;
    burstTimerRef.current = setInterval(() => {
      attempts++;
      fetchTransactions(true);
      if (attempts >= 4) {
        if (burstTimerRef.current) {
          clearInterval(burstTimerRef.current);
          burstTimerRef.current = null;
        }
      }
    }, 2500);
  }

  // Continuous pairing detector: polls pending code (even if modal is closed) + detects any newly connected device
  useEffect(() => {
    let active = true;

    // Restore pending code on mount if available
    try {
      const savedCode = localStorage.getItem('ws_pending_pair_code');
      if (savedCode && !activePairingCodeRef.current) {
        activePairingCodeRef.current = savedCode;
      }
    } catch {
      // ignore storage errors
    }

    const timer = setInterval(async () => {
      if (!active) return;

      const codeToCheck = activePairingCodeRef.current || (showPairModal ? pairingCode : null);

      // 1. Check specific code status if a pairing code was generated
      if (codeToCheck) {
        try {
          const res = await fetch(`/api/v1/devices?code=${encodeURIComponent(codeToCheck)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.paired && active) {
              activePairingCodeRef.current = null;
              try {
                localStorage.removeItem('ws_pending_pair_code');
              } catch {
                // ignore
              }
              triggerDevicePairedSuccess(data.deviceId, data.label);
              return;
            }
          }
        } catch {
          // ignore network glitches
        }
      }

      // 2. Continuous fallback: check device list delta
      try {
        const dRes = await fetch('/api/v1/devices');
        if (dRes.ok) {
          const dData = await dRes.json();
          const devList: Array<{ id: string; label: string; createdAt: string }> = dData.devices || [];

          if (seenDeviceIdsRef.current.size === 0 && devList.length > 0) {
            // Initial seed of known devices on first load
            devList.forEach((d) => seenDeviceIdsRef.current.add(d.id));
          } else if (devList.length > 0) {
            // Find any brand new device not seen yet
            const brandNew = devList.find((d) => !seenDeviceIdsRef.current.has(d.id));
            if (brandNew && brandNew.id !== lastNotifiedDeviceIdRef.current) {
              seenDeviceIdsRef.current.add(brandNew.id);
              lastNotifiedDeviceIdRef.current = brandNew.id;
              activePairingCodeRef.current = null;
              try {
                localStorage.removeItem('ws_pending_pair_code');
              } catch {
                // ignore
              }
              triggerDevicePairedSuccess(brandNew.id, brandNew.label);
            }
          }
        }
      } catch {
        // ignore
      }
    }, 1500);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [showPairModal, pairingCode]);

  // 3. Stats calculation
  const stats: Stats = transactions.reduce(
    (acc, t) => {
      acc.totalAmountPaise += t.amountPaise;
      acc.totalCount += 1;
      if (t.status === 'success') acc.successCount += 1;
      acc.discountPaise += t.discountPaise;
      return acc;
    },
    {
      totalAmountPaise: 0,
      totalCount: 0,
      successCount: 0,
      discountPaise: 0,
      walletBalancePaise: null,
    },
  );

  // 4. Reveal customer number handler
  async function handleReveal(id: string) {
    if (revealedNumbers[id]) {
      const next = { ...revealedNumbers };
      delete next[id];
      setRevealedNumbers(next);
      return;
    }

    try {
      const res = await fetch(`/api/v1/transactions/${id}/reveal`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setRevealedNumbers((prev) => ({ ...prev, [id]: data.customerNo }));
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to reveal customer number');
      }
    } catch {
      alert('Error contacting reveal endpoint');
    }
  }

  // 5. Generate pair code modal
  async function openPairingModal() {
    try {
      const res = await fetch('/api/v1/devices', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        const code = data.code;
        if (!code) {
          alert('Failed to generate pairing code');
          return;
        }
        setPairingCode(code);
        activePairingCodeRef.current = code;
        try {
          localStorage.setItem('ws_pending_pair_code', code);
        } catch {
          // ignore storage error
        }
        setShowPairModal(true);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || `Server returned ${res.status}: Failed to generate pairing code`);
      }
    } catch {
      alert('Network error connecting to pairing server');
    }
  }

  // Portal Counts
  const simplewalletCount = transactions.filter((t) => t.source === 'simplewallet' || !t.source).length;
  const egpaymentCount = transactions.filter((t) => t.source === 'egpayment').length;

  // Master Sync All Portals
  async function handleSyncAllDataNow() {
    setIsSyncingAll(true);
    try {
      const res = await fetch('/api/v1/transactions');
      if (res.ok) {
        const data = await res.json();
        const items: ApiTransaction[] = data.items || [];
        if (items.length > 0) {
          setTransactions(items);
          setClientCache('dashboard_txns', items);
          setClientCache('txns_all_all_all', items);
          setLastSyncTime(items[0]?.occurredAt || null);
          setSyncToastMessage(`Synchronized ${items.length} live transactions successfully ✓`);
        } else {
          setSyncToastMessage(
            deviceHeartbeat.status === 'connected'
              ? 'Terminal connected. Keep SimpleWallet or EGPayment history tab open in browser to stream live records.'
              : 'No live records yet today. Launch portal or use Direct HTML Ingest to sync immediately.',
          );
        }
      } else {
        await fetchTransactions(true);
        setSyncToastMessage('Transactions refreshed');
      }
      setTimeout(() => setSyncToastMessage(null), 4000);
    } catch {
      setSyncToastMessage('Sync completed');
      setTimeout(() => setSyncToastMessage(null), 2500);
    } finally {
      setIsSyncingAll(false);
    }
  }

  // Direct HTML Ingestion from portal
  async function handleDirectIngestSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!directIngestHtml.trim()) {
      setDirectIngestError('Please paste HTML content first.');
      return;
    }
    setIsIngestingHtml(true);
    setDirectIngestError(null);
    setDirectIngestSuccess(null);

    try {
      const res = await fetch('/api/v1/portal/ingest-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: directIngestHtml }),
      });
      const data = await res.json();
      if (res.ok) {
        setDirectIngestSuccess(data.message || 'Transactions ingested successfully!');
        setDirectIngestHtml('');
        await fetchTransactions(true);
        setTimeout(() => {
          setShowDirectIngestModal(false);
          setDirectIngestSuccess(null);
        }, 1800);
      } else {
        setDirectIngestError(data.error || data.detail || 'Failed to ingest HTML');
      }
    } catch {
      setDirectIngestError('Network error ingesting HTML');
    } finally {
      setIsIngestingHtml(false);
    }
  }

  // Filtered transactions
  const filtered = transactions.filter((t) => {
    if (portalFilter !== 'all' && t.source !== portalFilter) return false;
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (serviceFilter !== 'all' && t.service !== serviceFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchTxn = t.txnId.toLowerCase().includes(q);
      const matchLast4 = t.customerLast4.includes(q);
      if (!matchTxn && !matchLast4) return false;
    }
    return true;
  });

  return (
    <AppLayout>
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-6 border-b border-zinc-200 dark:border-zinc-800 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.dashboard.title}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {t.dashboard.subtitle}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {deviceHeartbeat.status !== 'not_paired' ? (
            <button
              onClick={() => setShowDeviceDetailsModal(true)}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs transition-colors cursor-pointer"
            >
              <span className={`w-2 h-2 rounded-full ${deviceHeartbeat.status === 'connected' ? 'bg-white animate-pulse' : 'bg-zinc-300'}`} />
              <Smartphone className="w-4 h-4" />
              <span>{deviceHeartbeat.status === 'connected' ? 'Connected Terminal' : 'Paired Terminal'}</span>
            </button>
          ) : (
            <button
              onClick={openPairingModal}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer"
            >
              <Smartphone className="w-4 h-4" />
              {t.dashboard.connectExtension}
            </button>
          )}

          <button
            onClick={() => fetchTransactions(false)}
            className="p-2 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            title={t.common.refresh}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Live Terminal Heartbeat Status Bar (CHANGE 3) */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 my-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-xs">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
            Terminal Status:
          </span>

          {deviceHeartbeat.status === 'connected' && (
            <button
              type="button"
              onClick={() => setShowDeviceDetailsModal(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 cursor-pointer transition-colors"
              title="Click to view connected terminal details"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Connected (View Details)
            </button>
          )}

          {deviceHeartbeat.status === 'offline' && (
            <button
              type="button"
              onClick={() => setShowDeviceDetailsModal(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-500/10 hover:bg-zinc-500/20 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20 cursor-pointer transition-colors"
              title="Click to view terminal details"
            >
              <span className="w-2 h-2 rounded-full bg-zinc-400" />
              Offline (View Details)
            </button>
          )}

          {deviceHeartbeat.status === 'not_paired' && (
            <button
              type="button"
              onClick={openPairingModal}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/20 cursor-pointer transition-colors"
              title="Click to pair a new extension"
            >
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              Not paired (Click to Connect)
            </button>
          )}

          {!deviceHeartbeat.portalLoggedIn && deviceHeartbeat.status === 'connected' && (
            <button
              type="button"
              onClick={() => setShowDeviceDetailsModal(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 border border-amber-500/30 cursor-pointer transition-colors"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              Portal login needed
            </button>
          )}
        </div>

        <div className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
          <span>
            Last synced:{' '}
            {deviceHeartbeat.lastSyncAt
              ? formatKolkataDate(deviceHeartbeat.lastSyncAt)
              : lastSyncTime
              ? formatKolkataDate(lastSyncTime)
              : 'Never'}
          </span>
        </div>
      </div>

      {/* ==================================================== */}
      {/* RECHARGE PORTAL CONTROL HUB (Operate Directly from Web App) */}
      {/* ==================================================== */}
      <div className="p-4 my-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 shadow-xs space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-600/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                Recharge Portal Hub & Live Sync
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  Direct Web Control
                </span>
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Operate and launch your recharge portals directly from this dashboard without needing the extension popup.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setShowDirectIngestModal(true)}
              className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
              title="Manually paste and ingest table HTML from any browser"
            >
              <FileCode className="w-3.5 h-3.5 text-blue-500" />
              <span>Direct HTML Ingest</span>
            </button>

            <button
              type="button"
              onClick={handleSyncAllDataNow}
              disabled={isSyncingAll}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md shadow-blue-600/20 flex items-center gap-2 cursor-pointer active:scale-95 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingAll ? 'animate-spin' : ''}`} />
              <span>{isSyncingAll ? 'Syncing All Portals...' : 'Sync All Data Now'}</span>
            </button>
          </div>
        </div>

        {/* Dual Portal Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          {/* Card 1: SimpleWallet */}
          <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-950/40 hover:border-blue-500/40 transition-all flex flex-col justify-between group">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center font-black text-xs text-blue-500 dark:text-blue-400">
                  SW
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-xs text-zinc-900 dark:text-zinc-100">SimpleWallet</h3>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Auto-Click Show Active
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-400 font-mono">simplewallet.in</span>
                </div>
              </div>

              <a
                href="https://simplewallet.in/web/MyTrans.aspx?ST=1&mID=824&PID=821"
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer active:scale-95"
                title="Launch SimpleWallet transaction history in a new tab"
              >
                <span>Launch SimpleWallet</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </div>

            <div className="pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60 flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
              <span>Today's Synced: <strong className="text-zinc-900 dark:text-zinc-200 font-semibold">{simplewalletCount} records</strong></span>
              <span className="text-[10px] text-zinc-400">Opens MyTrans.aspx directly</span>
            </div>
          </div>

          {/* Card 2: EG Payment */}
          <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-950/40 hover:border-amber-500/40 transition-all flex flex-col justify-between group">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center font-black text-xs text-amber-500 dark:text-amber-400">
                  EG
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-xs text-zinc-900 dark:text-zinc-100">EG Payment</h3>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live Stream Ready
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-400 font-mono">egpayment.com</span>
                </div>
              </div>

              <a
                href="https://egpayment.com/users/recharge_history"
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer active:scale-95"
                title="Launch EG Payment recharge history in a new tab"
              >
                <span>Launch EG Payment</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </div>

            <div className="pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60 flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
              <span>Today's Synced: <strong className="text-zinc-900 dark:text-zinc-200 font-semibold">{egpaymentCount} records</strong></span>
              <span className="text-[10px] text-zinc-400">Auto-extracted in background</span>
            </div>
          </div>
        </div>
      </div>

      {/* Device Health Banner */}
      {deviceStatus !== 'ok' && (
        <div
          role="alert"
          className="my-6 p-4 rounded-xl border border-amber-300 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 flex items-start gap-3 text-amber-900 dark:text-amber-200"
        >
          <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div>
            <h4 className="font-semibold text-sm">Sync Warning</h4>
            <p className="text-xs mt-0.5">
              {deviceStatus === 'logged_out' && t.dashboard.deviceLoggedOutWarning}
              {deviceStatus === 'layout_changed' && t.dashboard.deviceLayoutChangedWarning}
              {deviceStatus === 'offline' && t.dashboard.deviceOfflineWarning}
            </p>
          </div>
        </div>
      )}

      {/* STATE 1: LOADING SKELETON */}
      {loading && transactions.length === 0 && (
        <div className="py-6 space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-28 rounded-xl bg-zinc-200 dark:bg-zinc-800/60 animate-pulse p-4 flex flex-col justify-between"
              >
                <div className="h-4 w-20 bg-zinc-300 dark:bg-zinc-700 rounded" />
                <div className="h-7 w-28 bg-zinc-300 dark:bg-zinc-700 rounded" />
                <div className="h-3 w-16 bg-zinc-300 dark:bg-zinc-700 rounded" />
              </div>
            ))}
          </div>
          <div className="h-64 rounded-xl bg-zinc-200 dark:bg-zinc-800/60 animate-pulse" />
        </div>
      )}

      {/* STATE 2: ERROR */}
      {error && (
        <div
          role="alert"
          className="my-8 p-6 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 text-center"
        >
          <XCircle className="w-8 h-8 mx-auto text-red-500 mb-2" />
          <h3 className="font-semibold text-red-900 dark:text-red-200">{t.common.error}</h3>
          <p className="text-sm text-red-600 dark:text-red-400 mt-1 mb-4">{error}</p>
          <button
            onClick={() => fetchTransactions(false)}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            {t.common.retry}
          </button>
        </div>
      )}

      {/* STATE 3 & 4: POPULATED & EMPTY STATES */}
      {!loading && !error && (
        <div className="space-y-6 pt-6">
          {/* KPI Cards Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {t.dashboard.kpiSalesToday}
              </span>
              <p className="text-xl sm:text-2xl font-bold tracking-tight mt-1 text-zinc-900 dark:text-zinc-100 tabular-nums">
                {formatPaise(stats.totalAmountPaise)}
              </p>
              <span className="text-[11px] text-zinc-500 mt-1 block">
                {stats.totalCount > 0 ? '+0% vs yesterday' : '—'}
              </span>
            </div>

            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {t.dashboard.kpiCount}
              </span>
              <p className="text-xl sm:text-2xl font-bold tracking-tight mt-1 text-zinc-900 dark:text-zinc-100 tabular-nums">
                {stats.totalCount}
              </p>
              <span className="text-[11px] text-zinc-500 mt-1 block">
                {stats.successCount} successful
              </span>
            </div>

            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {t.dashboard.kpiSuccessRate}
              </span>
              <p className="text-xl sm:text-2xl font-bold tracking-tight mt-1 text-zinc-900 dark:text-zinc-100 tabular-nums">
                {stats.totalCount > 0
                  ? `${Math.round((stats.successCount / stats.totalCount) * 100)}%`
                  : '0%'}
              </p>
              <span className="text-[11px] text-zinc-500 mt-1 block">
                {stats.totalCount > 0 ? 'Healthy conversion' : 'No transactions'}
              </span>
            </div>

            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {t.dashboard.kpiDiscount}
              </span>
              <p className="text-xl sm:text-2xl font-bold tracking-tight mt-1 text-zinc-900 dark:text-zinc-100 tabular-nums">
                {formatPaise(stats.discountPaise)}
              </p>
              <span className="text-[11px] text-zinc-500 mt-1 block">
                {stats.totalAmountPaise > 0
                  ? `Net margin ${((stats.discountPaise / stats.totalAmountPaise) * 100).toFixed(1)}%`
                  : '0% margin'}
              </span>
            </div>

            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs col-span-2 lg:col-span-1">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {t.dashboard.kpiWalletBalance}
              </span>
              <p className="text-xl sm:text-2xl font-bold tracking-tight mt-1 text-zinc-900 dark:text-zinc-100 tabular-nums">
                {stats.walletBalancePaise ? formatPaise(stats.walletBalancePaise) : '—'}
              </p>
              <span className="text-[11px] text-zinc-500 mt-1 block">
                {lastSyncTime
                  ? `${t.common.lastSynced} ${formatKolkataDate(lastSyncTime)}`
                  : t.common.neverSynced}
              </span>
            </div>
          </div>

          {/* Live Feed Header and Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  {isConnected && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  )}
                  <span
                    className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                      isConnected ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                  />
                </span>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {t.dashboard.liveFeedTitle}
                </h2>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {t.dashboard.liveFeedSubtitle}
              </p>
            </div>

            {/* Quick Filters, Manual Refresh & Auto-Sync Status */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Auto-sync: 5s</span>
              </span>

              <button
                onClick={() => {
                  setIsRefreshing(true);
                  fetchTransactions(true).finally(() => {
                    setTimeout(() => setIsRefreshing(false), 500);
                  });
                }}
                className="p-1.5 text-zinc-600 dark:text-zinc-300 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors shadow-2xs cursor-pointer"
                title="Refresh Transactions Now"
                aria-label="Refresh Transactions"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
              </button>

              <select
                value={portalFilter}
                onChange={(e) => setPortalFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200 font-medium outline-hidden cursor-pointer"
              >
                <option value="all">{t.common.allPortals}</option>
                <option value="simplewallet">SimpleWallet (simplewallet.in)</option>
                <option value="egpayment">EG Payment (egpayment.com)</option>
              </select>

              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  placeholder={t.transactions.searchPlaceholder}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-hidden focus:border-blue-500 w-44 sm:w-56"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 outline-hidden cursor-pointer"
              >
                <option value="all">{t.transactions.filterAllStatuses}</option>
                <option value="success">{t.common.statusSuccess}</option>
                <option value="pending">{t.common.statusPending}</option>
                <option value="failed">{t.common.statusFailed}</option>
                <option value="refunded">{t.common.statusRefunded}</option>
              </select>

              <select
                value={serviceFilter}
                onChange={(e) => setServiceFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 outline-hidden cursor-pointer"
              >
                <option value="all">{t.transactions.filterAllServices}</option>
                <option value="PREPAID">PREPAID</option>
                <option value="DTH">DTH</option>
                <option value="POSTPAID">POSTPAID</option>
              </select>
            </div>
          </div>

          {/* Transactions Table or Empty State */}
          {filtered.length === 0 ? (
            <div className="p-12 text-center border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900 shadow-2xs">
              <Smartphone className="w-10 h-10 mx-auto text-zinc-400 mb-3" />
              <h3 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                {t.dashboard.noRecentTxns}
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-sm mx-auto">
                {deviceHeartbeat.status !== 'not_paired'
                  ? 'Your terminal is connected and ready. Open SimpleWallet or EG Payment in your browser and click "Sync Both Portals" in the extension to capture transactions.'
                  : t.dashboard.noRecentTxnsDesc}
              </p>
              {deviceHeartbeat.status !== 'not_paired' ? (
                <button
                  type="button"
                  onClick={() => setShowDeviceDetailsModal(true)}
                  className="mt-4 px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors inline-flex items-center gap-2 cursor-pointer shadow-xs"
                >
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  View Connected Terminal
                </button>
              ) : (
                <button
                  type="button"
                  onClick={openPairingModal}
                  className="mt-4 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors inline-flex items-center gap-2 cursor-pointer shadow-xs"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {t.dashboard.connectExtension}
                </button>
              )}
            </div>
          ) : (
            <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900 shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-50 dark:bg-zinc-950/60 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 font-medium">
                    <tr>
                      <th className="py-3 px-4">{t.common.txnId}</th>
                      <th className="py-3 px-4">{t.common.portal}</th>
                      <th className="py-3 px-4">{t.common.service} / {t.common.operator}</th>
                      <th className="py-3 px-4">{t.common.customer}</th>
                      <th className="py-3 px-4">{t.common.status}</th>
                      <th className="py-3 px-4 text-right">{t.common.amount}</th>
                      <th className="py-3 px-4 text-right">{t.common.discount}</th>
                      <th className="py-3 px-4 text-right">{t.common.date}</th>
                      <th className="py-3 px-4 text-center">{t.common.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800" aria-live="polite">
                    {filtered.map((item) => {
                      const isHighlighted = highlightedIds.has(item.txnId);
                      const isRevealed = Boolean(revealedNumbers[item.id]);

                      return (
                        <tr
                          key={item.id}
                          onClick={() => setSelectedTxn(item)}
                          className={`transition-colors cursor-pointer hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 ${
                            isHighlighted ? 'animate-row-highlight bg-blue-50 dark:bg-blue-950/40' : ''
                          }`}
                        >
                          <td className="py-3 px-4 font-mono font-medium text-zinc-900 dark:text-zinc-100">
                            {item.txnId}
                          </td>
                          <td className="py-3 px-4">
                            {item.source === 'egpayment' ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-900/60 shadow-2xs">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                                <span>EG Payment</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-900/60 shadow-2xs">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                                <span>SimpleWallet</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">
                              {item.serviceName}
                            </span>
                            <span className="text-[10px] text-zinc-400 block">
                              {item.service}
                            </span>
                          </td>
                          <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-zinc-600 dark:text-zinc-300">
                                {isRevealed ? revealedNumbers[item.id] : item.customerNoMasked}
                              </span>
                              <button
                                onClick={() => handleReveal(item.id)}
                                className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded"
                                title={isRevealed ? t.common.hide : t.common.reveal}
                                aria-label={isRevealed ? t.common.hide : t.common.reveal}
                              >
                                {isRevealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              </button>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                                item.status === 'success'
                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                    : item.status === 'pending'
                                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                    : item.status === 'failed'
                                    ? 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                                    : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                              }`}
                            >
                              {item.status === 'success' && <CheckCircle2 className="w-3 h-3" />}
                              {item.status === 'pending' && <Clock className="w-3 h-3" />}
                              {item.status === 'failed' && <XCircle className="w-3 h-3" />}
                              {item.status === 'refunded' && <RotateCcw className="w-3 h-3" />}
                              <span>
                                {item.status === 'success'
                                  ? t.common.statusSuccess
                                  : item.status === 'pending'
                                  ? t.common.statusPending
                                  : item.status === 'failed'
                                  ? t.common.statusFailed
                                  : item.status === 'refunded'
                                  ? t.common.statusRefunded
                                  : t.common.statusUnknown}
                              </span>
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-medium text-zinc-900 dark:text-zinc-100 tabular-nums">
                            {formatPaise(item.amountPaise)}
                          </td>
                          <td className="py-3 px-4 text-right text-zinc-500 tabular-nums">
                            {formatPaise(item.discountPaise)}
                          </td>
                          <td className="py-3 px-4 text-right text-zinc-400 whitespace-nowrap tabular-nums">
                            {formatKolkataDate(item.occurredAt)}
                          </td>
                          <td className="py-3 px-4 text-center" onClick={(e) => { e.stopPropagation(); setSelectedTxn(item); }}>
                            <button
                              className="p-1 text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                              title={t.transactions.detailsTitle}
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Transaction Details Modal */}
      {selectedTxn && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
          onClick={() => setSelectedTxn(null)}
        >
          <div
            className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-4">
              <div>
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                  {t.transactions.detailsTitle}
                </h3>
                <span className="font-mono text-xs text-zinc-400">{selectedTxn.txnId}</span>
              </div>
              <button
                onClick={() => setSelectedTxn(null)}
                className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="text-zinc-500 font-medium">Source Website:</span>
                {selectedTxn.source === 'egpayment' ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-bold text-[11px] bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    EG Payment (egpayment.com)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-bold text-[11px] bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    SimpleWallet (simplewallet.in)
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-zinc-400 block">{t.common.service}</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{selectedTxn.service}</span>
              </div>
              <div>
                <span className="text-zinc-400 block">{t.common.operator}</span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{selectedTxn.serviceName}</span>
              </div>
              <div>
                <span className="text-zinc-400 block">{t.transactions.operatorRef}</span>
                <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                  {selectedTxn.operatorRef || 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-zinc-400 block">{t.common.status}</span>
                <span className="font-semibold uppercase text-emerald-600 dark:text-emerald-400">
                  {selectedTxn.status}
                </span>
              </div>
              <div>
                <span className="text-zinc-400 block">{t.common.amount}</span>
                <span className="font-bold text-base text-zinc-900 dark:text-zinc-100 tabular-nums">
                  {formatPaise(selectedTxn.amountPaise)}
                </span>
              </div>
              <div>
                <span className="text-zinc-400 block">{t.common.discount}</span>
                <span className="font-medium text-base text-zinc-600 dark:text-zinc-300 tabular-nums">
                  {formatPaise(selectedTxn.discountPaise)} ({selectedTxn.discountPct}%)
                </span>
              </div>
              <div className="col-span-2">
                <span className="text-zinc-400 block">{t.common.customer}</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-mono text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {revealedNumbers[selectedTxn.id] || selectedTxn.customerNoMasked}
                  </span>
                  <button
                    onClick={() => handleReveal(selectedTxn.id)}
                    className="px-2 py-0.5 text-[11px] font-medium rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    {revealedNumbers[selectedTxn.id] ? (
                      <>
                        <EyeOff className="w-3 h-3" />
                        <span>{t.common.hide}</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-3 h-3" />
                        <span>{t.common.reveal}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
              <div className="col-span-2">
                <span className="text-zinc-400 block">{t.transactions.time}</span>
                <span className="text-zinc-700 dark:text-zinc-300 tabular-nums">
                  {formatKolkataDate(selectedTxn.occurredAt)}
                </span>
              </div>
            </div>

            <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl text-[11px] text-zinc-500 border border-zinc-200/80 dark:border-zinc-700/60">
              {t.transactions.revealNotice}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedTxn(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-700 cursor-pointer"
              >
                {t.common.close}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pairing Code Modal */}
      {showPairModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-xl">
            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              {t.devices.modalTitle}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              {t.devices.modalDesc}
            </p>

            <div className="my-6 p-4 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
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

            <p className="text-[11px] text-zinc-400 mb-6">
              {t.devices.extensionInstruction}
            </p>

            <div className="flex justify-end">
              <button
                onClick={() => setShowPairModal(false)}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
              >
                {t.common.close}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Connected Terminal Details Modal */}
      {showDeviceDetailsModal && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setShowDeviceDetailsModal(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in zoom-in-95 duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-2xl relative overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-start justify-between pb-4 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                    Active Extension Terminal
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Currently linked Chrome Extension
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDeviceDetailsModal(false)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Status Indicator */}
            <div className="my-4 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700/60 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${deviceHeartbeat.status === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'}`} />
                <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  {deviceHeartbeat.status === 'connected' ? 'Online & Syncing' : 'Terminal Offline'}
                </span>
              </div>
              <span className={`text-[11px] font-mono font-medium px-2 py-0.5 rounded-full ${
                deviceHeartbeat.status === 'connected'
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                  : 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border border-zinc-500/30'
              }`}>
                {deviceHeartbeat.status === 'connected' ? 'CONNECTED' : 'OFFLINE'}
              </span>
            </div>

            {/* Portal Alert Warning if logged out */}
            {!deviceHeartbeat.portalLoggedIn && deviceHeartbeat.status === 'connected' && (
              <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 flex items-start gap-2.5 text-amber-800 dark:text-amber-200 text-xs">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block">Portal Login Needed</span>
                  <span>Your portal session is expired or logged out. Log back into SimpleWallet or EGPayment in Chrome.</span>
                </div>
              </div>
            )}

            {/* Detailed Metadata Grid */}
            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between py-1.5 border-b border-zinc-100 dark:border-zinc-800/80">
                <span className="text-zinc-500 dark:text-zinc-400 font-medium">Terminal Name</span>
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {deviceHeartbeat.label || 'POS Terminal (Chrome)'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-zinc-100 dark:border-zinc-800/80">
                <span className="text-zinc-500 dark:text-zinc-400 font-medium">Extension Version</span>
                <span className="font-mono text-zinc-700 dark:text-zinc-300">
                  v{deviceHeartbeat.extensionVersion || '0.1.0'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-zinc-100 dark:border-zinc-800/80">
                <span className="text-zinc-500 dark:text-zinc-400 font-medium">Active Portal</span>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  {deviceHeartbeat.portal
                    ? deviceHeartbeat.portal === 'simplewallet'
                      ? 'SimpleWallet.in'
                      : 'EGPayment.com'
                    : 'SimpleWallet & EGPayment'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-zinc-100 dark:border-zinc-800/80">
                <span className="text-zinc-500 dark:text-zinc-400 font-medium">Last Heartbeat</span>
                <span className="text-zinc-700 dark:text-zinc-300">
                  {deviceHeartbeat.lastSeenAt ? formatKolkataDate(deviceHeartbeat.lastSeenAt) : 'Just now'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1.5">
                <span className="text-zinc-500 dark:text-zinc-400 font-medium">Last Synced Record</span>
                <span className="text-zinc-700 dark:text-zinc-300 font-medium">
                  {deviceHeartbeat.lastSyncAt
                    ? formatKolkataDate(deviceHeartbeat.lastSyncAt)
                    : lastSyncTime
                    ? formatKolkataDate(lastSyncTime)
                    : 'Never'}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-6 pt-4 border-t border-zinc-100 dark:border-zinc-800 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    fetchTransactions(false);
                    setShowDeviceDetailsModal(false);
                  }}
                  className="flex-1 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Sync Stream Now
                </button>
                <Link
                  href="/devices"
                  onClick={() => setShowDeviceDetailsModal(false)}
                  className="py-2 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-medium text-xs transition-colors flex items-center justify-center gap-1 cursor-pointer"
                >
                  Manage
                </Link>
              </div>

              <button
                onClick={() => {
                  setShowDeviceDetailsModal(false);
                  openPairingModal();
                }}
                className="w-full py-1.5 text-center text-[11px] text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
              >
                + Pair New / Additional Extension
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Terminal Paired / Device Connected High-Tech Modal Popup */}
      {pairedDeviceToast?.show && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setPairedDeviceToast(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in zoom-in-95 duration-200 cursor-pointer"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-[#0B0D13] border border-emerald-500/40 rounded-2xl p-6 shadow-2xl relative overflow-hidden text-zinc-100 cursor-default"
          >
            {/* Top Emerald Ambient Glow */}
            <div className="absolute -top-14 -left-14 w-36 h-36 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -top-14 -right-14 w-36 h-36 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />

            <div className="flex items-start justify-between relative z-10">
              <div className="flex items-center gap-3">
                <div className="relative flex items-center justify-center w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                  <span className="absolute w-4 h-4 rounded-full bg-emerald-500 animate-ping opacity-75" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      Terminal Paired
                    </span>
                    <span className="text-[11px] text-zinc-400 font-mono">{pairedDeviceToast.time}</span>
                  </div>
                  <h3 className="text-base font-semibold text-zinc-50 mt-1">
                    Device Successfully Connected!
                  </h3>
                </div>
              </div>
              <button
                onClick={() => setPairedDeviceToast(null)}
                className="text-zinc-400 hover:text-zinc-100 p-1 rounded-lg hover:bg-zinc-800/60 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-zinc-300 mt-3 leading-relaxed">
              Your WalletSync Chrome Extension is now linked with your web dashboard. Live transaction ingestion has been activated automatically.
            </p>

            <div className="mt-4 p-3.5 rounded-xl bg-zinc-900/90 border border-zinc-800 flex items-center justify-between text-xs font-mono">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase text-zinc-500 tracking-wider font-semibold">Terminal Label</span>
                <span className="text-zinc-200 font-medium">{pairedDeviceToast.label}</span>
              </div>
              <div className="flex flex-col gap-0.5 items-end">
                <span className="text-[10px] uppercase text-zinc-500 tracking-wider font-semibold">Live Stream</span>
                <span className="text-emerald-400 flex items-center gap-1.5 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  INGEST ACTIVE
                </span>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={() => {
                  setPairedDeviceToast(null);
                  fetchTransactions(false);
                }}
                className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs tracking-wide transition-all shadow-lg shadow-emerald-950/40 flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                View Live Transactions
              </button>
            </div>

            <p className="text-[10px] text-zinc-500 text-center mt-3 font-mono">
              Auto-closing in 4s • click anywhere to dismiss
            </p>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* DIRECT PORTAL HTML INGEST MODAL */}
      {/* ==================================================== */}
      {showDirectIngestModal && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setShowDirectIngestModal(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in zoom-in-95 duration-200 cursor-pointer"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-2xl relative overflow-hidden text-zinc-900 dark:text-zinc-100 cursor-default space-y-4"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
                  <FileCode className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
                    Direct Portal HTML Ingest
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Sync records instantly without browser extensions
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowDirectIngestModal(false)}
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleDirectIngestSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Paste Portal Page HTML / Table (#gvList or history page):
                </label>
                <textarea
                  value={directIngestHtml}
                  onChange={(e) => setDirectIngestHtml(e.target.value)}
                  placeholder="Paste HTML from SimpleWallet (MyTrans.aspx) or EG Payment recharge history..."
                  rows={6}
                  className="w-full p-3 text-xs font-mono rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  required
                />
                <p className="text-[11px] text-zinc-400 mt-1">
                  Tip: In SimpleWallet, right-click &gt; View Page Source or inspect table <code className="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">#gvList</code> and copy its HTML.
                </p>
              </div>

              {directIngestError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span>{directIngestError}</span>
                </div>
              )}

              {directIngestSuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{directIngestSuccess}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDirectIngestModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-xl border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isIngestingHtml || !directIngestHtml.trim()}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white shadow-md shadow-blue-600/20 transition-all flex items-center gap-2 cursor-pointer"
                >
                  {isIngestingHtml ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Parsing & Ingesting...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Parse & Sync Records</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Live Sync Toast Banner */}
      {syncToastMessage && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xl border border-zinc-800 dark:border-zinc-200 flex items-center gap-2.5 text-xs font-semibold animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span>{syncToastMessage}</span>
        </div>
      )}
    </AppLayout>
  );
}
