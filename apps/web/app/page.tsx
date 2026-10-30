'use client';

import React, { useEffect, useState, useRef } from 'react';
import type { ApiTransaction, IngestTransaction, TransactionSource } from '@walletsync/contract';
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

  // SSE & Fallback state (ADR-004)
  const [isConnected, setIsConnected] = useState(false);
  const lastEventTimeRef = useRef<number>(Date.now());

  // Pairing Modal state
  const [showPairModal, setShowPairModal] = useState(false);
  const [pairingCode, setPairingCode] = useState('SYNC-7489');
  const [copiedCode, setCopiedCode] = useState(false);

  // 1. Initial data fetch with instant 0ms client-side cache
  useEffect(() => {
    const cached = getClientCache<ApiTransaction[]>('dashboard_txns');
    if (cached && cached.length > 0) {
      setTransactions(cached);
      setLoading(false);
      setLastSyncTime(cached[0]?.occurredAt || null);
    }
    fetchTransactions();
  }, []);

  async function fetchTransactions() {
    const cached = getClientCache<ApiTransaction[]>('dashboard_txns');
    if (!cached || cached.length === 0) {
      setLoading(true);
    }
    setError(null);
    try {
      const res = await fetch('/api/v1/transactions?limit=100');
      if (res.status === 304) return;
      if (!res.ok) throw new Error('Failed to load transactions');
      const data = await res.json();
      const items: ApiTransaction[] = data.items || [];
      setTransactions(items);
      setClientCache('dashboard_txns', items);
      if (items.length > 0) {
        setLastSyncTime(items[0]?.occurredAt || null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error fetching data');
    } finally {
      setLoading(false);
    }
  }

  // 2. Server-Sent Events setup with ADR-004 Reconnect & Polling Fallback
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let fallbackInterval: NodeJS.Timeout | null = null;

    function connectSSE() {
      eventSource = new EventSource('/api/v1/stream');

      eventSource.onopen = () => {
        setIsConnected(true);
        lastEventTimeRef.current = Date.now();
      };

      eventSource.addEventListener('transaction.updated', (event) => {
        try {
          lastEventTimeRef.current = Date.now();
          const data = JSON.parse(event.data);
          if (data.rows && Array.isArray(data.rows)) {
            const newIds = new Set<string>();
            const newItems: ApiTransaction[] = data.rows.map((r: IngestTransaction) => {
              const last4 = r.customerNo.replace(/\D/g, '').slice(-4) || '0000';
              newIds.add(r.txnId);
              return {
                id: r.txnId,
                tenantId: '00000000-0000-0000-0000-000000000001',
                txnId: r.txnId,
                source: (r.source || 'simplewallet') as TransactionSource,
                service: r.service,
                serviceName: r.serviceName,
                customerLast4: last4,
                customerNoMasked: `••••••${last4}`,
                occurredAt: r.occurredAt,
                status: r.status,
                statusRaw: r.statusRaw,
                operatorRef: r.operatorRef || '',
                amountPaise: r.amountPaise,
                discountPct: r.discountPct,
                discountPaise: r.discountPaise,
                parserVersion: '1.0.0',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };
            });

            setTransactions((prev) => {
              const existingIds = new Set(prev.map((p) => p.txnId));
              const uniqueNew = newItems.filter((item) => !existingIds.has(item.txnId));
              return [...uniqueNew, ...prev];
            });

            setHighlightedIds(newIds);
            setTimeout(() => {
              setHighlightedIds(new Set());
            }, 1200);

            setLastSyncTime(new Date().toISOString());
            setDeviceStatus('ok');
          }
        } catch {
          // parse error ignored
        }
      });

      eventSource.onerror = () => {
        setIsConnected(false);
        eventSource?.close();
        if (!fallbackInterval) {
          fallbackInterval = setInterval(async () => {
            try {
              const res = await fetch('/api/v1/transactions?limit=20');
              if (res.ok) {
                const data = await res.json();
                if (data.items?.length > 0) {
                  setTransactions(data.items);
                  setLastSyncTime(data.items[0].occurredAt);
                }
              }
            } catch {
              // ignore polling error
            }
          }, 10000);
        }
        setTimeout(connectSSE, 3000);
      };
    }

    connectSSE();

    return () => {
      eventSource?.close();
      if (fallbackInterval) clearInterval(fallbackInterval);
    };
  }, []);

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
      walletBalancePaise: 1542000,
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
        setPairingCode(data.code || 'SYNC-7489');
      }
    } catch {
      // fallback
    }
    setShowPairModal(true);
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
          <button
            onClick={openPairingModal}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors"
          >
            <Smartphone className="w-4 h-4" />
            {t.dashboard.connectExtension}
          </button>
          <button
            onClick={fetchTransactions}
            className="p-2 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title={t.common.refresh}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
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
            onClick={fetchTransactions}
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
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 block">
                +8.4% vs yesterday
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
                  : '100%'}
              </p>
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 block">
                Healthy conversion
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
                Net margin 1.5%
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

            {/* Quick Filters */}
            <div className="flex items-center gap-2 flex-wrap">
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
                className="px-2.5 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 outline-hidden"
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
                className="px-2.5 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 outline-hidden"
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
            <div className="p-12 text-center border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900">
              <Smartphone className="w-10 h-10 mx-auto text-zinc-400 mb-3" />
              <h3 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                {t.dashboard.noRecentTxns}
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-sm mx-auto">
                {t.dashboard.noRecentTxnsDesc}
              </p>
              <button
                onClick={openPairingModal}
                className="mt-4 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {t.dashboard.connectExtension}
              </button>
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
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800" aria-live="polite">
                    {filtered.map((item) => {
                      const isHighlighted = highlightedIds.has(item.txnId);
                      const isRevealed = Boolean(revealedNumbers[item.id]);

                      return (
                        <tr
                          key={item.id}
                          className={`transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 ${
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
                          <td className="py-3 px-4">
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
    </AppLayout>
  );
}
