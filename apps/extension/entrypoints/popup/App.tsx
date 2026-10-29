import React, { useEffect, useState } from 'react';
import {
  getStorage,
  type StorageData,
} from '../../lib/storage';
import {
  RefreshCw,
  Pause,
  Play,
  ExternalLink,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  WifiOff,
  Link as LinkIcon,
} from 'lucide-react';

export default function App() {
  const [data, setData] = useState<StorageData | null>(null);
  const [pairingCode, setPairingCode] = useState('');
  const [pairingApiUrl, setPairingApiUrl] = useState('http://localhost:3000');
  const [showConfig, setShowConfig] = useState(false);
  const [isPairing, setIsPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 3000);
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    const storage = await getStorage();
    setData(storage);
    if (storage.apiUrl) {
      setPairingApiUrl(storage.apiUrl);
    }
  }

  async function handlePair(e: React.FormEvent) {
    e.preventDefault();
    if (!pairingCode.trim()) return;

    setIsPairing(true);
    setPairError(null);

    chrome.runtime.sendMessage(
      { type: 'PAIR_DEVICE', code: pairingCode, apiUrl: pairingApiUrl },
      (res: { success?: boolean; error?: string } | undefined) => {
        setIsPairing(false);
        if (res && res.success) {
          loadData();
        } else {
          setPairError(res?.error || 'Pairing failed. Check code and try again.');
        }
      },
    );
  }

  async function handleSyncNow() {
    setIsSyncing(true);
    chrome.runtime.sendMessage({ type: 'SYNC_NOW' }, () => {
      setTimeout(() => {
        setIsSyncing(false);
        loadData();
      }, 1200);
    });
  }

  async function handleTogglePause() {
    chrome.runtime.sendMessage({ type: 'TOGGLE_PAUSE' }, () => {
      loadData();
    });
  }

  function handleOpenDashboard() {
    if (data?.apiUrl) {
      chrome.tabs.create({ url: data.apiUrl });
    }
  }

  if (!data) {
    return (
      <div className="w-[360px] p-6 text-center text-sm text-gray-500">
        Loading WalletSync...
      </div>
    );
  }

  // -------------------------------------------------------------
  // STATE 1 & 2: UNPAIRED / PAIRING
  // -------------------------------------------------------------
  if (!data.deviceToken || !data.deviceId) {
    return (
      <div className="w-[360px] p-5 font-sans bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 min-h-[380px] flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-lg">
              W
            </div>
            <div>
              <h1 className="font-semibold text-base leading-tight">WalletSync</h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Read-Only History Sync</p>
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-xl p-3 mb-4">
            <p className="text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
              Open your WalletSync web dashboard, click <strong>"Connect Extension"</strong>, and enter the 8-character pairing code below.
            </p>
          </div>

          <form onSubmit={handlePair} className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1 text-zinc-600 dark:text-zinc-300">
                Pairing Code
              </label>
              <input
                type="text"
                maxLength={12}
                placeholder="e.g. A1B2-C3D4"
                value={pairingCode}
                onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
                disabled={isPairing}
                className="w-full px-3 py-2 border rounded-lg text-center tracking-widest font-mono text-base uppercase font-semibold bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {pairError && (
              <div className="p-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg text-xs text-red-600 dark:text-red-300 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{pairError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isPairing || !pairingCode.trim()}
              className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {isPairing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Pairing Device...
                </>
              ) : (
                <>
                  <LinkIcon className="w-4 h-4" />
                  Pair with Dashboard
                </>
              )}
            </button>
          </form>
        </div>

        <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setShowConfig(!showConfig)}
            className="text-[11px] text-zinc-500 hover:underline"
          >
            {showConfig ? 'Hide connection settings' : 'Advanced: Change API URL'}
          </button>

          {showConfig && (
            <div className="mt-2 space-y-1">
              <label className="text-[10px] text-zinc-400">Backend API URL</label>
              <input
                type="text"
                value={pairingApiUrl}
                onChange={(e) => setPairingApiUrl(e.target.value)}
                className="w-full px-2 py-1 text-xs border rounded bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700"
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // STATE 3 & 4: HEALTHY / ERROR (PAIRED)
  // -------------------------------------------------------------
  const formatPaise = (paise: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(paise / 100);
  };

  const getStatusBadge = () => {
    if (data.isPaused) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300">
          <Pause className="w-3 h-3" /> Paused
        </span>
      );
    }

    switch (data.status) {
      case 'ok':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            <CheckCircle2 className="w-3 h-3" /> Synced
          </span>
        );
      case 'logged_out':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
            <ShieldAlert className="w-3 h-3" /> Logged out
          </span>
        );
      case 'layout_changed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <AlertCircle className="w-3 h-3" /> Layout changed
          </span>
        );
      case 'totals_mismatch':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
            <AlertCircle className="w-3 h-3" /> Totals mismatch
          </span>
        );
      case 'offline':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300">
            <WifiOff className="w-3 h-3" /> Offline
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-[360px] p-4 font-sans bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 min-h-[460px] flex flex-col justify-between">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
              W
            </div>
            <div>
              <h1 className="font-semibold text-sm leading-none">WalletSync</h1>
              <p className="text-[10px] text-zinc-400 mt-0.5">simplewallet.in</p>
            </div>
          </div>
          {getStatusBadge()}
        </div>

        {/* Warning Banner if not ok */}
        {data.status !== 'ok' && !data.isPaused && (
          <div className="mt-3 p-2.5 rounded-lg text-xs flex items-start gap-2 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">
                {data.status === 'logged_out' && 'Session Logged Out'}
                {data.status === 'layout_changed' && 'Portal Layout Changed'}
                {data.status === 'totals_mismatch' && 'Row Totals Mismatch'}
                {data.status === 'offline' && 'Offline / Reconnecting'}
              </p>
              <p className="text-[11px] opacity-90 mt-0.5">
                {data.errorMessage || 'Synchronization paused for safety.'}
              </p>
            </div>
          </div>
        )}

        {/* Today's KPI Summary */}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3">
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">Today's Total</p>
            <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50 mt-0.5">
              {formatPaise(data.todayAmountPaise || 0)}
            </p>
          </div>
          <div className="bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3">
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">Transactions</p>
            <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50 mt-0.5">
              {data.todayCount || 0}
            </p>
          </div>
        </div>

        {/* Recent Transactions List */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
              Recent Syncs
            </h2>
            <span className="text-[10px] text-zinc-400">
              {data.lastSyncTime ? new Date(data.lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never'}
            </span>
          </div>

          {data.recentTransactions && data.recentTransactions.length > 0 ? (
            <div className="space-y-1.5 max-h-[175px] overflow-y-auto pr-1">
              {data.recentTransactions.map((tx) => (
                <div
                  key={tx.txnId}
                  className="p-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="flex items-center gap-1.5 font-medium">
                      <span>{tx.serviceName || tx.service}</span>
                      <span className="text-[10px] text-zinc-400">#{tx.txnId}</span>
                    </div>
                    <div className="text-[11px] text-zinc-500 font-mono">
                      {tx.customerMasked}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {formatPaise(tx.amountPaise)}
                    </div>
                    <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium capitalize">
                      {tx.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 text-center text-xs text-zinc-400">
              No transactions captured today yet.
            </div>
          )}
        </div>
      </div>

      {/* Action Controls */}
      <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
        <div className="flex gap-2">
          <button
            onClick={handleSyncNow}
            disabled={isSyncing || data.isPaused}
            className="flex-1 py-2 px-3 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Syncing...' : 'Sync Now'}
          </button>

          <button
            onClick={handleTogglePause}
            className="py-2 px-3 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors"
          >
            {data.isPaused ? (
              <>
                <Play className="w-3.5 h-3.5 text-emerald-600" />
                Resume
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5 text-zinc-600" />
                Pause
              </>
            )}
          </button>
        </div>

        <button
          onClick={handleOpenDashboard}
          className="w-full py-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center justify-center gap-1 font-medium"
        >
          <span>Open Web Dashboard</span>
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
