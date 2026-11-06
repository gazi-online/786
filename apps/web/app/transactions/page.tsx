'use client';

import React, { useEffect, useState, useRef } from 'react';
import type { ApiTransaction } from '@walletsync/contract';
import { AppLayout } from '@/components/AppLayout';
import { useI18n } from '@/lib/i18n-context';
import { formatPaise, formatKolkataDate } from '@/lib/i18n';
import { getClientCache, setClientCache } from '@/lib/client-cache';
import {
  Search,
  Download,
  CheckCircle2,
  Clock,
  XCircle,
  RotateCcw,
  Eye,
  EyeOff,
  ChevronRight,
  X,
  FileSpreadsheet,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

function getTxnCompositeKey(t: { source?: string | null; txnId: string | number }): string {
  const src = (t.source || 'simplewallet').toLowerCase().trim();
  const id = String(t.txnId || '').trim();
  return `${src}_${id}`;
}

export default function TransactionsPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<ApiTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [portal, setPortal] = useState('all');
  const [status, setStatus] = useState('all');
  const [service, setService] = useState('all');
  const [datePreset, setDatePreset] = useState('all');

  // Selected Transaction for Detail Drawer
  const [selectedTxn, setSelectedTxn] = useState<ApiTransaction | null>(null);
  const [revealedNumbers, setRevealedNumbers] = useState<Record<string, string>>({});

  // Device-adaptive mobile pagination
  const [mobileLimit, setMobileLimit] = useState(25);

  const isDefaultFilter = portal === 'all' && status === 'all' && service === 'all';
  const cacheKey = `txns_${portal}_${status}_${service}`;
  const currentKeyRef = useRef(cacheKey);

  // Cross-page shared cache resolver:
  // When on default filter, immediately fallback to dashboard cache for instant 0ms transition
  const getEffectiveCache = () => {
    const cached = getClientCache<ApiTransaction[]>(cacheKey);
    if (cached && cached.length > 0) return cached;
    if (isDefaultFilter) {
      const dashCached = getClientCache<ApiTransaction[]>('dashboard_txns');
      if (dashCached && dashCached.length > 0) return dashCached;
    }
    return null;
  };

  useEffect(() => {
    const isFilterChanged = currentKeyRef.current !== cacheKey;
    currentKeyRef.current = cacheKey;

    // 0ms instant display from memory/session cache
    const cached = getEffectiveCache();
    if (cached && cached.length > 0) {
      setItems(cached);
      setLoading(false);
    } else if (isFilterChanged) {
      setItems([]);
      setLoading(true);
    }

    loadTransactions(false, isFilterChanged);

    // Continuous auto-fetch every 8 seconds to keep transaction list fresh
    const timer = setInterval(() => {
      loadTransactions(true, false);
    }, 8000);

    return () => clearInterval(timer);
  }, [status, service, portal]);

  async function loadTransactions(silent = false, isFilterChanged = false) {
    const cached = getEffectiveCache();
    if (!silent) {
      if (!cached || cached.length === 0) {
        setLoading(true);
      }
      setError(null);
    }
    try {
      const params = new URLSearchParams();
      if (portal !== 'all') params.set('source', portal);
      if (status !== 'all') params.set('status', status);
      if (service !== 'all') params.set('service', service);
      params.set('limit', '100');

      const res = await fetch(`/api/v1/transactions?${params.toString()}`);
      if (res.status === 304) {
        // Not modified — server data is identical.
        // If state was empty, restore immediately from effective cache so data never disappears
        setItems((prev) => {
          if (prev.length > 0) return prev;
          const restored = getEffectiveCache();
          return restored && restored.length > 0 ? restored : prev;
        });
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch transaction records');
      const data = await res.json();
      const newItems: ApiTransaction[] = data.items || [];

      setItems((prev) => {
        // If filter changed, take new items directly without mixing old filter items
        if (isFilterChanged) {
          const dedup = new Map<string, ApiTransaction>();
          for (const item of newItems) {
            dedup.set(getTxnCompositeKey(item), item);
          }
          return Array.from(dedup.values());
        }
        // If background silent poll returns empty, preserve previous transactions to prevent flash
        if (silent && newItems.length === 0 && prev.length > 0) {
          return prev;
        }
        if (newItems.length === 0) {
          return [];
        }
        // Non-destructive merge and deduplicate by natural key (source + txnId)
        const txnMap = new Map<string, ApiTransaction>();
        for (const p of prev) {
          txnMap.set(getTxnCompositeKey(p), p);
        }
        for (const item of newItems) {
          txnMap.set(getTxnCompositeKey(item), item);
        }
        return Array.from(txnMap.values()).sort(
          (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
        );
      });

      if (newItems.length > 0) {
        setClientCache(cacheKey, newItems);
        if (isDefaultFilter) {
          setClientCache('dashboard_txns', newItems);
        }
      } else if (!silent) {
        setClientCache(cacheKey, []);
        if (isDefaultFilter) {
          setClientCache('dashboard_txns', []);
        }
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

  // Filter in memory for search & date presets
  const filtered = items.filter((item) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchTxn = item.txnId.toLowerCase().includes(q);
      const matchLast4 = item.customerLast4.includes(q);
      if (!matchTxn && !matchLast4) return false;
    }

    if (datePreset === 'today') {
      const today = new Date().toISOString().slice(0, 10);
      return item.occurredAt.startsWith(today);
    }
    return true;
  });

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
        alert('Failed to reveal customer number');
      }
    } catch {
      alert('Error contacting reveal endpoint');
    }
  }

  function handleExportCsv() {
    if (filtered.length === 0) return;
    const headers = ['Txn ID', 'Service', 'Operator', 'Customer Last 4', 'Status', 'Amount (INR)', 'Discount (INR)', 'Occurred At'];
    const rows = filtered.map((r) => [
      r.txnId,
      r.service,
      r.serviceName,
      r.customerLast4,
      r.status,
      (r.amountPaise / 100).toFixed(2),
      (r.discountPaise / 100).toFixed(2),
      r.occurredAt,
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `WalletSync_Transactions_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <AppLayout>
      {/* Title & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-6 border-b border-zinc-200 dark:border-zinc-800 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.transactions.title}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {t.transactions.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            {t.transactions.exportCsv}
          </button>
          <button
            onClick={() => loadTransactions(false)}
            className="p-2 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title={t.common.refresh}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="py-4 flex flex-col md:flex-row items-stretch md:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder={t.transactions.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-hidden focus:border-blue-500 shadow-2xs"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
          <select
            value={portal}
            onChange={(e) => setPortal(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200 font-medium outline-hidden cursor-pointer"
          >
            <option value="all">{t.common.allPortals}</option>
            <option value="simplewallet">SimpleWallet (simplewallet.in)</option>
            <option value="egpayment">EG Payment (egpayment.com)</option>
          </select>

          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 outline-hidden cursor-pointer"
          >
            <option value="all">All Dates</option>
            <option value="today">Today</option>
          </select>

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 outline-hidden cursor-pointer"
          >
            <option value="all">{t.transactions.filterAllStatuses}</option>
            <option value="success">{t.common.statusSuccess}</option>
            <option value="pending">{t.common.statusPending}</option>
            <option value="failed">{t.common.statusFailed}</option>
            <option value="refunded">{t.common.statusRefunded}</option>
          </select>

          <select
            value={service}
            onChange={(e) => setService(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 outline-hidden cursor-pointer"
          >
            <option value="all">{t.transactions.filterAllServices}</option>
            <option value="PREPAID">PREPAID</option>
            <option value="DTH">DTH</option>
            <option value="POSTPAID">POSTPAID</option>
          </select>
        </div>
      </div>

      {/* STATE 1: LOADING SKELETON */}
      {loading && (
        <div className="space-y-2 py-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-16 w-full rounded-xl bg-zinc-200 dark:bg-zinc-800/60 animate-pulse"
            />
          ))}
        </div>
      )}

      {/* STATE 2: ERROR */}
      {error && !loading && (
        <div className="my-8 p-6 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 text-center">
          <AlertCircle className="w-8 h-8 mx-auto text-red-500 mb-2" />
          <h3 className="font-semibold text-red-900 dark:text-red-200">{t.common.error}</h3>
          <p className="text-xs text-red-600 dark:text-red-400 mt-1 mb-4">{error}</p>
          <button
            onClick={() => loadTransactions(false)}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
          >
            {t.common.retry}
          </button>
        </div>
      )}

      {/* STATE 3: EMPTY */}
      {!loading && !error && filtered.length === 0 && (
        <div className="my-8 p-12 text-center border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900">
          <FileSpreadsheet className="w-10 h-10 mx-auto text-zinc-400 mb-3" />
          <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
            {search.trim() || portal !== 'all' || status !== 'all' || service !== 'all' || datePreset !== 'all'
              ? t.transactions.noTxnsFound
              : (t.dashboard.noRecentTxns || t.transactions.noTxnsFound)}
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-sm mx-auto">
            {search.trim() || portal !== 'all' || status !== 'all' || service !== 'all' || datePreset !== 'all'
              ? t.transactions.noTxnsFoundDesc
              : t.dashboard.noRecentTxnsDesc}
          </p>
        </div>
      )}

      {/* STATE 4: POPULATED (Responsive Table + Mobile Cards) */}
      {!loading && !error && filtered.length > 0 && (
        <div>
          {/* Desktop & Tablet Table (>= 640px) */}
          <div className="hidden sm:block border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900 shadow-2xs">
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
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {filtered.map((item) => {
                    const isRevealed = Boolean(revealedNumbers[item.id]);
                    return (
                      <tr
                        key={getTxnCompositeKey(item)}
                        onClick={() => setSelectedTxn(item)}
                        className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
                      >
                        <td className="py-3.5 px-4 font-mono font-medium text-zinc-900 dark:text-zinc-100">
                          {item.txnId}
                        </td>
                        <td className="py-3.5 px-4">
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
                        <td className="py-3.5 px-4">
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">
                            {item.serviceName}
                          </span>
                          <span className="text-[10px] text-zinc-400 block">{item.service}</span>
                        </td>
                        <td className="py-3.5 px-4" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-zinc-600 dark:text-zinc-300">
                              {isRevealed ? revealedNumbers[item.id] : item.customerNoMasked}
                            </span>
                            <button
                              onClick={() => handleReveal(item.id)}
                              className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded cursor-pointer"
                              title={isRevealed ? t.common.hide : t.common.reveal}
                            >
                              {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
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
                            <span>{item.status.toUpperCase()}</span>
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right font-medium text-zinc-900 dark:text-zinc-100 tabular-nums">
                          {formatPaise(item.amountPaise)}
                        </td>
                        <td className="py-3.5 px-4 text-right text-zinc-500 tabular-nums">
                          {formatPaise(item.discountPaise)}
                        </td>
                        <td className="py-3.5 px-4 text-right text-zinc-400 whitespace-nowrap tabular-nums">
                          {formatKolkataDate(item.occurredAt)}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <ChevronRight className="w-4 h-4 text-zinc-400 inline" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Cards (< 640px) */}
          <div className="sm:hidden space-y-3">
            {filtered.slice(0, mobileLimit).map((item) => {
              const isRevealed = Boolean(revealedNumbers[item.id]);
              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedTxn(item)}
                  className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs space-y-2 cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        {item.txnId}
                      </span>
                      {item.source === 'egpayment' ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                          EG Payment
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                          SimpleWallet
                        </span>
                      )}
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        item.status === 'success'
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                      }`}
                    >
                      {item.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-600 dark:text-zinc-400">{item.serviceName} ({item.service})</span>
                    <span className="font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">
                      {formatPaise(item.amountPaise)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1 border-t border-zinc-100 dark:border-zinc-800">
                    <div className="flex items-center gap-1 font-mono text-zinc-500" onClick={(e) => e.stopPropagation()}>
                      <span>{isRevealed ? revealedNumbers[item.id] : item.customerNoMasked}</span>
                      <button
                        onClick={() => handleReveal(item.id)}
                        className="p-1 text-zinc-400 hover:text-zinc-700"
                      >
                        {isRevealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </button>
                    </div>
                    <span className="text-[11px] text-zinc-400 tabular-nums">
                      {formatKolkataDate(item.occurredAt)}
                    </span>
                  </div>
                </div>
              );
            })}

            {filtered.length > mobileLimit && (
              <button
                onClick={() => setMobileLimit((prev) => prev + 25)}
                className="w-full py-2.5 px-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-semibold text-blue-600 dark:text-blue-400 shadow-2xs hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
              >
                Load More ({filtered.length - mobileLimit} remaining)
              </button>
            )}
          </div>
        </div>
      )}

      {/* Transaction Details Drawer / Modal */}
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
    </AppLayout>
  );
}
