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
  Layers,
  ArrowUpRight,
  Clock,
  Sparkles,
} from 'lucide-react';

const SIMPLEWALLET_URL = 'https://simplewallet.in/web/MyTrans.aspx?ST=1&mID=824&PID=821';
const EGPAYMENT_URL = 'https://egpayment.com/users/recharge_history';

export default function App() {
  const [data, setData] = useState<StorageData | null>(null);
  const [pairingCode, setPairingCode] = useState('');
  const [pairingApiUrl, setPairingApiUrl] = useState('http://localhost:3000');
  const [showConfig, setShowConfig] = useState(false);
  const [isPairing, setIsPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [swTabOpen, setSwTabOpen] = useState(false);
  const [egTabOpen, setEgTabOpen] = useState(false);

  useEffect(() => {
    loadData();
    checkOpenTabs();
    const interval = setInterval(() => {
      loadData();
      checkOpenTabs();
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  async function checkOpenTabs() {
    try {
      const swTabs = await chrome.tabs.query({ url: '*://*.simplewallet.in/*' });
      setSwTabOpen(swTabs.length > 0);

      const egTabs = await chrome.tabs.query({ url: '*://*.egpayment.com/*' });
      setEgTabOpen(egTabs.length > 0);
    } catch {
      // Chrome tabs API might not be available in standalone preview
    }
  }

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
          checkOpenTabs();
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
        checkOpenTabs();
      }, 1200);
    });
  }

  async function handleTogglePause() {
    chrome.runtime.sendMessage({ type: 'TOGGLE_PAUSE' }, () => {
      loadData();
    });
  }

  function handleOpenPortal(url: string) {
    chrome.tabs.create({ url });
  }

  function handleOpenDashboard() {
    if (data?.apiUrl) {
      chrome.tabs.create({ url: data.apiUrl });
    }
  }

  const formatPaise = (paise: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(paise / 100);
  };

  const formatTime = (isoString: string | null) => {
    if (!isoString) return 'Not yet synced';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!data) {
    return (
      <div className="w-[380px] p-8 text-center text-xs text-zinc-500 font-sans flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
        <span>Loading WalletSync...</span>
      </div>
    );
  }

  // -------------------------------------------------------------
  // STATE: UNPAIRED / PAIRING FORM
  // -------------------------------------------------------------
  if (!data.deviceToken || !data.deviceId) {
    return (
      <div className="w-[380px] p-5 font-sans bg-zinc-950 text-zinc-100 min-h-[420px] flex flex-col justify-between select-none">
        <div>
          {/* Header */}
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white font-extrabold text-xl shadow-lg shadow-blue-500/20">
              W
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-base tracking-tight">WalletSync</h1>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-mono border border-blue-500/20">
                  v0.1.0
                </span>
              </div>
              <p className="text-xs text-zinc-400">Multi-Portal History Sync</p>
            </div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4 mb-4 backdrop-blur-sm">
            <div className="flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-xs text-zinc-300 leading-relaxed">
                Connect this extension to your WalletSync dashboard to automatically sync history from{' '}
                <strong className="text-white">SimpleWallet</strong> and{' '}
                <strong className="text-white">EG Payment</strong>.
              </p>
            </div>
          </div>

          <form onSubmit={handlePair} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                8-Digit Pairing Code
              </label>
              <input
                type="text"
                maxLength={12}
                placeholder="e.g. ED87F798"
                value={pairingCode}
                onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
                disabled={isPairing}
                className="w-full px-4 py-2.5 bg-zinc-900 border border-zinc-700 hover:border-zinc-600 rounded-xl text-center tracking-widest font-mono text-lg uppercase font-bold text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-inner"
              />
            </div>

            {pairError && (
              <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-xl text-xs text-red-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{pairError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isPairing || !pairingCode.trim()}
              className="w-full py-2.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold tracking-wide uppercase shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {isPairing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Pairing Terminal...
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

        <div className="mt-4 pt-3 border-t border-zinc-800/80">
          <button
            type="button"
            onClick={() => setShowConfig(!showConfig)}
            className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            {showConfig ? '▲ Hide server settings' : '▼ Advanced: Backend API URL'}
          </button>

          {showConfig && (
            <div className="mt-2 space-y-1">
              <input
                type="text"
                value={pairingApiUrl}
                onChange={(e) => setPairingApiUrl(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // STATE: PAIRED / ACTIVE MODERN DASHBOARD POPUP
  // -------------------------------------------------------------
  return (
    <div className="w-[380px] p-4 font-sans bg-zinc-950 text-zinc-100 min-h-[510px] flex flex-col justify-between select-none">
      <div>
        {/* Header with Live Status Beacon */}
        <div className="flex items-center justify-between pb-3.5 border-b border-zinc-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white font-extrabold text-sm shadow-md shadow-blue-500/20">
              W
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="font-bold text-sm tracking-tight text-white">WalletSync</h1>
                <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-blue-500/10 text-blue-400 font-medium border border-blue-500/20">
                  Live
                </span>
              </div>
              <p className="text-[10px] text-zinc-400">POS Terminal • Read-Only</p>
            </div>
          </div>

          {/* Overall Health Pill */}
          <div>
            {data.isPaused ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700">
                <Pause className="w-3 h-3 text-zinc-400" /> Paused
              </span>
            ) : data.status === 'ok' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 shadow-sm shadow-emerald-950">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-red-950/80 text-red-300 border border-red-800/60">
                <ShieldAlert className="w-3 h-3 text-red-400" /> Alert
              </span>
            )}
          </div>
        </div>

        {/* Warning Banner if error state */}
        {data.status !== 'ok' && !data.isPaused && (
          <div className="mt-3 p-3 rounded-xl text-xs flex items-start gap-2.5 bg-red-950/50 border border-red-800/60 text-red-200">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
            <div>
              <p className="font-bold">
                {data.status === 'logged_out' && 'Portal Session Expired'}
                {data.status === 'layout_changed' && 'Portal Layout Changed'}
                {data.status === 'totals_mismatch' && 'Totals Check Failed'}
                {data.status === 'offline' && 'Reconnecting to API...'}
              </p>
              <p className="text-[11px] opacity-80 mt-0.5">
                {data.errorMessage || 'Please log back in to resume synchronization.'}
              </p>
            </div>
          </div>
        )}

        {/* DUAL PORTAL STATUS CARDS */}
        <div className="mt-3.5 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-zinc-400 font-semibold px-0.5">
            <span className="flex items-center gap-1 uppercase tracking-wider text-[10px]">
              <Layers className="w-3 h-3 text-blue-400" />
              Connected Portals (2)
            </span>
            <span className="text-[10px] text-zinc-500">Auto-Detect</span>
          </div>

          {/* PORTAL 1: SimpleWallet */}
          <div className="p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-800/90 hover:border-zinc-700/80 transition-all flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center font-bold text-xs">
                SW
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-xs text-white">SimpleWallet</span>
                  {swTabOpen ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-medium bg-emerald-950 text-emerald-300 border border-emerald-800/60">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Tab Open
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.2 rounded-full text-[9px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">
                      Tab Closed
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-zinc-400 mt-0.5">
                  simplewallet.in •{' '}
                  <span className="text-zinc-300">
                    {data.simplewalletLastSync ? formatTime(data.simplewalletLastSync) : 'Ready'}
                  </span>
                </p>
              </div>
            </div>

            <button
              onClick={() => handleOpenPortal(SIMPLEWALLET_URL)}
              title="Open SimpleWallet History Tab"
              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors flex items-center gap-1 text-[11px] font-medium cursor-pointer"
            >
              <span>Open</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>

          {/* PORTAL 2: EG Payment */}
          <div className="p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-800/90 hover:border-zinc-700/80 transition-all flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center font-bold text-xs">
                EG
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-xs text-white">EG Payment</span>
                  {egTabOpen ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-medium bg-emerald-950 text-emerald-300 border border-emerald-800/60">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Tab Open
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.2 rounded-full text-[9px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">
                      Tab Closed
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-zinc-400 mt-0.5">
                  egpayment.com •{' '}
                  <span className="text-zinc-300">
                    {data.egpaymentLastSync ? formatTime(data.egpaymentLastSync) : 'Ready'}
                  </span>
                </p>
              </div>
            </div>

            <button
              onClick={() => handleOpenPortal(EGPAYMENT_URL)}
              title="Open EG Payment History Tab"
              className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors flex items-center gap-1 text-[11px] font-medium cursor-pointer"
            >
              <span>Open</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* TODAY'S KPI SUMMARY */}
        <div className="grid grid-cols-2 gap-2 mt-3.5">
          <div className="bg-gradient-to-br from-zinc-900 to-zinc-900/60 border border-zinc-800/90 rounded-2xl p-3 shadow-sm">
            <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
              Today's Volume
            </p>
            <p className="text-lg font-extrabold text-white mt-0.5 tracking-tight">
              {formatPaise(data.todayAmountPaise || 0)}
            </p>
          </div>
          <div className="bg-gradient-to-br from-zinc-900 to-zinc-900/60 border border-zinc-800/90 rounded-2xl p-3 shadow-sm">
            <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
              Total Synced
            </p>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-lg font-extrabold text-white tracking-tight">
                {data.todayCount || 0}
              </span>
              <span className="text-[10px] text-zinc-500 font-medium">txns</span>
            </div>
          </div>
        </div>

        {/* RECENT CAPTURED FEED */}
        <div className="mt-3.5">
          <div className="flex items-center justify-between mb-1.5 px-0.5">
            <h2 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
              <Clock className="w-3 h-3 text-zinc-500" />
              Recent Captured Feed
            </h2>
            <span className="text-[10px] text-zinc-500 font-mono">
              Last: {formatTime(data.lastSyncTime)}
            </span>
          </div>

          {data.recentTransactions && data.recentTransactions.length > 0 ? (
            <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
              {data.recentTransactions.map((tx) => (
                <div
                  key={tx.txnId}
                  className="p-2 rounded-xl bg-zinc-900/70 hover:bg-zinc-900 border border-zinc-850 hover:border-zinc-750 flex items-center justify-between text-xs transition-all"
                >
                  <div className="flex items-center gap-2">
                    {/* Source Pill */}
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold font-mono ${
                        tx.source === 'egpayment'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      }`}
                    >
                      {tx.source === 'egpayment' ? 'EG' : 'SW'}
                    </span>
                    <div>
                      <div className="flex items-center gap-1 font-semibold text-zinc-200">
                        <span>{tx.serviceName || tx.service}</span>
                        <span className="text-[10px] text-zinc-500 font-normal">#{tx.txnId.slice(-6)}</span>
                      </div>
                      <div className="text-[11px] text-zinc-400 font-mono">
                        {tx.customerMasked}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-bold text-white tracking-tight">
                      {formatPaise(tx.amountPaise)}
                    </div>
                    <div className="text-[10px] text-emerald-400 font-semibold capitalize">
                      {tx.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-3.5 rounded-xl border border-dashed border-zinc-800 text-center text-xs text-zinc-500 bg-zinc-900/30">
              No transactions captured in this session yet.
            </div>
          )}
        </div>
      </div>

      {/* FOOTER ACTION CONTROLS */}
      <div className="mt-3.5 pt-3 border-t border-zinc-800/80 space-y-2">
        <div className="flex gap-2">
          <button
            onClick={handleSyncNow}
            disabled={isSyncing || data.isPaused}
            className="flex-1 py-2 px-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md shadow-blue-600/20 transition-all cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Syncing...' : 'Sync Both Portals'}</span>
          </button>

          <button
            onClick={handleTogglePause}
            className="py-2 px-3 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-300 hover:text-white rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {data.isPaused ? (
              <>
                <Play className="w-3.5 h-3.5 text-emerald-400" />
                <span>Resume</span>
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5 text-zinc-400" />
                <span>Pause</span>
              </>
            )}
          </button>
        </div>

        <button
          onClick={handleOpenDashboard}
          className="w-full py-1.5 text-xs text-zinc-400 hover:text-blue-400 hover:underline flex items-center justify-center gap-1 font-medium transition-colors cursor-pointer"
        >
          <span>Open Cloud Web Dashboard</span>
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
