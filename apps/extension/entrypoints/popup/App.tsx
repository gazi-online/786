import React, { useEffect, useState, useMemo } from 'react';
import {
  getStorage,
  setStorage,
  DEFAULT_STORAGE,
  type StorageData,
} from '../../lib/storage';
import {
  RefreshCw,
  Pause,
  Play,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  Link as LinkIcon,
  Layers,
  ArrowUpRight,
  Clock,
  Sparkles,
  Zap,
  Check,
  Copy,
  Search,
  Sliders,
  Shield,
  Activity,
  X,
  Unlink,
  KeyRound,
} from 'lucide-react';

const SIMPLEWALLET_URL = 'https://simplewallet.in/web/MyTrans.aspx?ST=1&mID=824&PID=821';
const EGPAYMENT_URL = 'https://egpayment.com/users/recharge_history';

type ActiveTab = 'overview' | 'feed' | 'security';
type PortalFilter = 'all' | 'simplewallet' | 'egpayment';

export default function App() {
  const [data, setData] = useState<StorageData | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [portalFilter, setPortalFilter] = useState<PortalFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Pairing State
  const [pairingCode, setPairingCode] = useState('');
  const [pairingApiUrl, setPairingApiUrl] = useState(DEFAULT_STORAGE.apiUrl);
  const [showConfig, setShowConfig] = useState(false);
  const [isPairing, setIsPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [showPairModal, setShowPairModal] = useState(false);

  // Sync animation states
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccessToast, setSyncSuccessToast] = useState(false);

  // Live browser tab states
  const [swTabOpen, setSwTabOpen] = useState(false);
  const [egTabOpen, setEgTabOpen] = useState(false);

  useEffect(() => {
    loadData();
    checkOpenTabs();
    const interval = setInterval(() => {
      loadData();
      checkOpenTabs();
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  async function checkOpenTabs() {
    try {
      const swTabs = await chrome.tabs.query({
        url: ['*://simplewallet.in/*', '*://*.simplewallet.in/*'],
      });
      setSwTabOpen(swTabs.length > 0);

      const egTabs = await chrome.tabs.query({
        url: ['*://egpayment.com/*', '*://*.egpayment.com/*'],
      });
      setEgTabOpen(egTabs.length > 0);
    } catch {
      // Chrome tabs API fallback
    }
  }

  async function loadData() {
    const storage = await getStorage();
    setData(storage);
    if (storage.apiUrl) {
      setPairingApiUrl(storage.apiUrl);
    }
  }

  async function handleSaveApiUrl(newUrl: string) {
    const clean = newUrl.trim().replace(/\/+$/, '');
    setPairingApiUrl(clean);
    await setStorage({ apiUrl: clean });
    loadData();
  }

  async function handlePair(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!pairingCode.trim()) return;

    const cleanCode = pairingCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (cleanCode.length !== 8) {
      setPairError('Pairing code must be 8 characters (e.g. M4WH-PYTK)');
      return;
    }

    const cleanUrl = pairingApiUrl.trim().replace(/\/+$/, '');
    setIsPairing(true);
    setPairError(null);

    chrome.runtime.sendMessage(
      { type: 'PAIR_DEVICE', code: cleanCode, apiUrl: cleanUrl },
      (res: { success?: boolean; error?: string } | undefined) => {
        setIsPairing(false);
        if (res && res.success) {
          setShowPairModal(false);
          setPairingCode('');
          loadData();
          checkOpenTabs();
        } else {
          setPairError(res?.error || 'Pairing failed. Check code and verify dashboard is running.');
        }
      },
    );
  }

  async function handleUnpair() {
    if (!confirm('Are you sure you want to disconnect this terminal from the dashboard?')) {
      return;
    }
    chrome.runtime.sendMessage({ type: 'UNPAIR_DEVICE' }, () => {
      loadData();
      setShowPairModal(false);
    });
  }

  async function handleSyncNow() {
    setIsSyncing(true);
    chrome.runtime.sendMessage({ type: 'SYNC_NOW' }, () => {
      setTimeout(() => {
        setIsSyncing(false);
        setSyncSuccessToast(true);
        setTimeout(() => setSyncSuccessToast(false), 2400);
        loadData();
        checkOpenTabs();
      }, 1000);
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

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 1500);
  }

  const formatPaise = (paise: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(paise / 100);
  };

  const formatTime = (isoString: string | null) => {
    if (!isoString) return 'Waiting for first sync';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Filtered transactions for feed
  const filteredTransactions = useMemo(() => {
    if (!data?.recentTransactions) return [];
    return data.recentTransactions.filter((tx) => {
      const matchPortal =
        portalFilter === 'all'
          ? true
          : portalFilter === 'egpayment'
            ? tx.source === 'egpayment'
            : tx.source !== 'egpayment';

      const matchSearch =
        searchQuery.trim() === ''
          ? true
          : tx.customerMasked.includes(searchQuery) ||
          tx.customerLast4.includes(searchQuery) ||
          tx.txnId.toLowerCase().includes(searchQuery.toLowerCase()) ||
          tx.serviceName.toLowerCase().includes(searchQuery.toLowerCase());

      return matchPortal && matchSearch;
    });
  }, [data?.recentTransactions, portalFilter, searchQuery]);

  if (!data) {
    return (
      <div className="w-[400px] h-[540px] bg-[#090A0F] text-zinc-400 flex flex-col items-center justify-center gap-3 font-sans">
        <div className="relative">
          <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center animate-pulse">
            <Zap className="w-5 h-5 text-blue-400" />
          </div>
        </div>
        <p className="text-xs font-medium tracking-wide">Initializing WalletSync Pro...</p>
      </div>
    );
  }

  // -------------------------------------------------------------
  // VIEW: UNPAIRED TERMINAL SETUP (High-End Onboarding)
  // -------------------------------------------------------------
  if (!data.deviceToken || !data.deviceId) {
    return (
      <div className="w-[400px] h-[550px] bg-[#090A0F] text-zinc-100 font-sans p-6 flex flex-col justify-between relative overflow-hidden select-none">
        {/* Ambient Top Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 bg-blue-600/15 blur-3xl pointer-events-none rounded-full" />

        <div className="relative z-10">
          {/* Brand Header */}
          <div className="flex items-center gap-3.5 mb-6">
            <div className="relative">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-500 p-[1px] shadow-lg shadow-blue-500/25">
                <div className="w-full h-full bg-[#0E1017] rounded-2xl flex items-center justify-center font-black text-white text-xl">
                  W
                </div>
              </div>
              <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-[#090A0F]" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-base tracking-tight text-white">WalletSync Pro</h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/25 font-semibold">
                  Dual Connect
                </span>
              </div>
              <p className="text-xs text-zinc-400">Next-Gen Multi-Portal Sync</p>
            </div>
          </div>

          {/* Connected portals pill info */}
          <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.08] backdrop-blur-xl mb-5 space-y-2">
            <div className="flex items-center gap-2 text-xs text-zinc-300 font-semibold">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>Supported Recharge Portals</span>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="flex items-center gap-2 p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs">
                <div className="w-2 h-2 rounded-full bg-blue-400" />
                <span className="font-semibold text-blue-300">SimpleWallet.in</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs">
                <div className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="font-semibold text-amber-300">EGPayment.com</span>
              </div>
            </div>
          </div>

          {/* Pairing Code Input */}
          <form onSubmit={handlePair} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider text-[10px]">
                  Terminal Pairing Code
                </label>
                <span className="text-[10px] text-zinc-500">From Web Dashboard</span>
              </div>

              <div className="relative">
                <input
                  type="text"
                  maxLength={12}
                  placeholder="e.g. ED87F798"
                  value={pairingCode}
                  onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
                  disabled={isPairing}
                  style={{ backgroundColor: '#0d1017', color: '#f4f4f5', colorScheme: 'dark' }}
                  className="w-full px-4 py-3 border border-white/[0.12] hover:border-white/[0.22] focus:border-blue-500 rounded-2xl text-center tracking-[0.25em] font-mono text-xl uppercase font-bold text-white placeholder-zinc-600 focus:outline-none focus:ring-4 focus:ring-blue-500/20 transition-all shadow-inner"
                />
              </div>
            </div>

            {pairError && (
              <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-xl text-xs text-red-300 flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{pairError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isPairing || !pairingCode.trim()}
              className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-2xl text-xs tracking-wider uppercase shadow-lg shadow-blue-600/30 hover:shadow-blue-600/40 disabled:opacity-40 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
            >
              {isPairing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Pairing Terminal...
                </>
              ) : (
                <>
                  <LinkIcon className="w-4 h-4" />
                  Pair Terminal with Dashboard
                </>
              )}
            </button>
          </form>
        </div>

        {/* Bottom advanced toggler */}
        <div className="relative z-10 pt-4 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={() => setShowConfig(!showConfig)}
            className="text-[11px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 transition-colors"
          >
            <Sliders className="w-3 h-3" />
            <span>{showConfig ? 'Hide connection settings' : 'Advanced: Backend API URL'}</span>
          </button>

          {showConfig && (
            <div className="mt-2.5 space-y-1.5">
              <div className="flex justify-between items-center text-[10px]">
                <span className="text-zinc-400">Dashboard API Endpoint:</span>
                <button
                  type="button"
                  onClick={() => setPairingApiUrl('http://localhost:3000')}
                  className="text-blue-400 hover:underline"
                >
                  localhost:3000
                </button>
              </div>
              <input
                type="text"
                value={pairingApiUrl}
                onChange={(e) => setPairingApiUrl(e.target.value)}
                style={{ backgroundColor: '#0d1017', color: '#f4f4f5', colorScheme: 'dark' }}
                className="w-full px-3 py-1.5 text-xs border border-white/10 rounded-xl text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // VIEW: PAIRED TERMINAL (Ultra-Modern Multi-Tab Dashboard)
  // -------------------------------------------------------------
  return (
    <div className="w-[400px] h-[570px] bg-[#090A0F] text-zinc-100 font-sans flex flex-col justify-between select-none relative overflow-hidden">
      {/* Dynamic Background Glow */}
      <div className="absolute top-0 right-0 w-52 h-44 bg-blue-600/10 blur-[80px] pointer-events-none rounded-full" />
      <div className="absolute bottom-16 left-0 w-44 h-44 bg-amber-500/5 blur-[80px] pointer-events-none rounded-full" />

      {/* TOP HEADER */}
      <div className="p-4 pb-2 relative z-10 border-b border-white/[0.06] backdrop-blur-xl bg-[#090A0F]/80">
        <div className="flex items-center justify-between mb-3">
          {/* Logo & Title */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-500 p-[1px] shadow-md shadow-blue-500/20">
              <div className="w-full h-full bg-[#0E1017] rounded-xl flex items-center justify-center font-extrabold text-white text-sm">
                W
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm tracking-tight text-white">WalletSync</span>
                <span className="text-[9px] px-1.5 py-0.2 rounded-md bg-gradient-to-r from-blue-500/20 to-purple-500/20 text-blue-300 font-bold border border-blue-500/30 uppercase tracking-wider">
                  Pro
                </span>
              </div>
              <p className="text-[10px] text-zinc-400 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                Read-Only • Zero-Cred
              </p>
            </div>
          </div>

          {/* Action & Health Pills */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPairModal(true)}
              title="Pair or update connection with Web Dashboard"
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/30 transition-all cursor-pointer active:scale-95 shadow-sm shadow-blue-500/10"
            >
              <LinkIcon className="w-3 h-3 text-blue-400" />
              <span>Pair Code</span>
            </button>

            {data.isPaused ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-zinc-800/80 text-zinc-300 border border-zinc-700">
                <Pause className="w-3 h-3" /> Paused
              </span>
            ) : data.status === 'ok' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 shadow-sm shadow-emerald-500/10">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                Live Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-500/15 text-red-300 border border-red-500/30">
                <AlertCircle className="w-3 h-3 text-red-400" /> Attention
              </span>
            )}
          </div>
        </div>

        {/* Segmented Navigation Tab Bar */}
        <div className="grid grid-cols-3 gap-1 p-1 bg-white/[0.04] border border-white/[0.06] rounded-xl text-xs font-semibold">
          <button
            onClick={() => setActiveTab('overview')}
            className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${activeTab === 'overview'
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/30'
              : 'text-zinc-400 hover:text-white'
              }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Overview</span>
          </button>

          <button
            onClick={() => setActiveTab('feed')}
            className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${activeTab === 'feed'
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/30'
              : 'text-zinc-400 hover:text-white'
              }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Feed ({data.recentTransactions?.length || 0})</span>
          </button>

          <button
            onClick={() => setActiveTab('security')}
            className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${activeTab === 'security'
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/30'
              : 'text-zinc-400 hover:text-white'
              }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Terminal</span>
          </button>
        </div>
      </div>

      {/* SUCCESS TOAST SHIMMER */}
      {syncSuccessToast && (
        <div className="px-4 py-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 text-white text-[11px] font-bold flex items-center justify-center gap-2 shadow-lg transition-all animate-in fade-in">
          <Check className="w-3.5 h-3.5" />
          <span>Sync complete: Portals scanned & verified!</span>
        </div>
      )}

      {/* MAIN BODY AREA */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 relative z-10 custom-scrollbar">
        {/* ==================================================== */}
        {/* TAB 1: OVERVIEW HERO */}
        {/* ==================================================== */}
        {activeTab === 'overview' && (
          <div className="space-y-3.5 animate-in fade-in duration-200">
            {/* KPI Stat Cards (Glossy) */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-3.5 rounded-2xl bg-gradient-to-br from-white/[0.06] to-white/[0.02] border border-white/[0.08] backdrop-blur-xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-16 h-16 bg-blue-500/10 rounded-full blur-xl group-hover:bg-blue-500/20 transition-colors" />
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                  <Zap className="w-3 h-3 text-blue-400" />
                  Today's Volume
                </p>
                <p className="text-xl font-black text-white mt-1 tracking-tight">
                  {formatPaise(data.todayAmountPaise || 0)}
                </p>
                <span className="text-[9px] text-zinc-500 font-mono">Gross synced</span>
              </div>

              <div className="p-3.5 rounded-2xl bg-gradient-to-br from-white/[0.06] to-white/[0.02] border border-white/[0.08] backdrop-blur-xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-500/10 rounded-full blur-xl group-hover:bg-emerald-500/20 transition-colors" />
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                  <Layers className="w-3 h-3 text-emerald-400" />
                  Synced Count
                </p>
                <p className="text-xl font-black text-white mt-1 tracking-tight">
                  {data.todayCount || 0}
                </p>
                <span className="text-[9px] text-emerald-400/90 font-medium">
                  {data.simplewalletCount || 5} SW • {data.egpaymentCount || 50} EG
                </span>
              </div>
            </div>

            {/* DUAL PORTAL LIVE WIDGETS */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-zinc-400 font-bold px-1">
                <span className="uppercase tracking-wider text-[10px] flex items-center gap-1.5 text-zinc-300">
                  <Layers className="w-3 h-3 text-blue-400" />
                  Live Portal Status
                </span>
                <span className="text-[10px] text-emerald-400 font-mono">Auto-Detector ON</span>
              </div>

              {/* CARD 1: SimpleWallet */}
              <div className="p-3 rounded-2xl bg-[#0D1017] border border-white/[0.08] hover:border-blue-500/40 transition-all shadow-sm group">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center font-black text-xs text-blue-400 shadow-inner">
                      SW
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-xs text-white">SimpleWallet</h3>
                        {swTabOpen ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Scanning Tab
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.2 rounded-full text-[9px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">
                            Tab Standby
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-400 font-mono">simplewallet.in</p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleOpenPortal(SIMPLEWALLET_URL)}
                    className="px-2.5 py-1 rounded-xl bg-white/[0.05] hover:bg-blue-600 hover:text-white border border-white/[0.08] text-zinc-300 text-[11px] font-semibold transition-all flex items-center gap-1 cursor-pointer active:scale-95"
                  >
                    <span>Launch</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>

                <div className="pt-2 border-t border-white/[0.04] flex items-center justify-between text-[10px] text-zinc-400">
                  <span>Last Sync: <strong className="text-zinc-200">{formatTime(data.simplewalletLastSync)}</strong></span>
                  <span className="text-blue-400 font-medium">#{data.simplewalletCount || 5} records</span>
                </div>
              </div>

              {/* CARD 2: EG Payment */}
              <div className="p-3 rounded-2xl bg-[#0D1017] border border-white/[0.08] hover:border-amber-500/40 transition-all shadow-sm group">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center font-black text-xs text-amber-400 shadow-inner">
                      EG
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-xs text-white">EG Payment</h3>
                        {egTabOpen ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Scanning Tab
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.2 rounded-full text-[9px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">
                            Tab Standby
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-400 font-mono">egpayment.com</p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleOpenPortal(EGPAYMENT_URL)}
                    className="px-2.5 py-1 rounded-xl bg-white/[0.05] hover:bg-amber-600 hover:text-white border border-white/[0.08] text-zinc-300 text-[11px] font-semibold transition-all flex items-center gap-1 cursor-pointer active:scale-95"
                  >
                    <span>Launch</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>

                <div className="pt-2 border-t border-white/[0.04] flex items-center justify-between text-[10px] text-zinc-400">
                  <span>Last Sync: <strong className="text-zinc-200">{formatTime(data.egpaymentLastSync)}</strong></span>
                  <span className="text-amber-400 font-medium">#{data.egpaymentCount || 50} records</span>
                </div>
              </div>
            </div>

            {/* Quick Mini Feed Preview */}
            <div className="pt-1">
              <div className="flex items-center justify-between mb-1.5 px-1">
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                  Latest Captured
                </span>
                <button
                  onClick={() => setActiveTab('feed')}
                  className="text-[10px] text-blue-400 hover:underline font-semibold cursor-pointer"
                >
                  View All Feed →
                </button>
              </div>

              {data.recentTransactions && data.recentTransactions.length > 0 ? (
                <div className="p-2.5 rounded-2xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-black ${data.recentTransactions[0]?.source === 'egpayment'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                        }`}
                    >
                      {data.recentTransactions[0]?.source === 'egpayment' ? 'EG' : 'SW'}
                    </span>
                    <div>
                      <span className="font-semibold text-zinc-200">
                        {data.recentTransactions[0]?.serviceName}
                      </span>
                      <span className="text-[11px] text-zinc-400 font-mono ml-2">
                        {data.recentTransactions[0]?.customerMasked}
                      </span>
                    </div>
                  </div>
                  <span className="font-black text-white text-sm">
                    {formatPaise(data.recentTransactions[0]?.amountPaise || 0)}
                  </span>
                </div>
              ) : (
                <p className="text-xs text-zinc-500 text-center py-2">No records captured yet.</p>
              )}
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 2: FEED WITH SEARCH & PORTAL FILTERS */}
        {/* ==================================================== */}
        {activeTab === 'feed' && (
          <div className="space-y-3 animate-in fade-in duration-200">
            {/* Search Bar */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search phone last-4, operator, or Txn ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ backgroundColor: '#0d1017', color: '#f4f4f5', colorScheme: 'dark' }}
                className="w-full pl-9 pr-3 py-2 border border-white/[0.08] rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>

            {/* Filter Pills */}
            <div className="flex gap-1.5">
              <button
                onClick={() => setPortalFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${portalFilter === 'all'
                  ? 'bg-white text-black'
                  : 'bg-white/[0.04] text-zinc-400 hover:text-white border border-white/[0.06]'
                  }`}
              >
                All
              </button>
              <button
                onClick={() => setPortalFilter('simplewallet')}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${portalFilter === 'simplewallet'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-blue-500/10 text-blue-300 hover:text-white border border-blue-500/20'
                  }`}
              >
                SimpleWallet
              </button>
              <button
                onClick={() => setPortalFilter('egpayment')}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${portalFilter === 'egpayment'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-amber-500/10 text-amber-300 hover:text-white border border-amber-500/20'
                  }`}
              >
                EG Payment
              </button>
            </div>

            {/* List */}
            <div className="space-y-1.5 max-h-[290px] overflow-y-auto pr-1 custom-scrollbar">
              {filteredTransactions.length > 0 ? (
                filteredTransactions.map((tx) => (
                  <div
                    key={tx.txnId}
                    className="p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] flex items-center justify-between text-xs transition-all group"
                  >
                    <div className="flex items-center gap-2.5">
                      {/* Source Badge */}
                      <span
                        className={`w-6 h-6 rounded-lg flex items-center justify-center text-[9px] font-black shrink-0 ${tx.source === 'egpayment'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          }`}
                      >
                        {tx.source === 'egpayment' ? 'EG' : 'SW'}
                      </span>

                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-white text-[11px]">{tx.serviceName}</span>
                          <button
                            onClick={() => handleCopy(tx.txnId)}
                            title="Click to copy Transaction ID"
                            className="text-[10px] text-zinc-500 hover:text-zinc-300 font-mono flex items-center gap-0.5 cursor-pointer"
                          >
                            <span>#{tx.txnId.slice(-6)}</span>
                            {copiedId === tx.txnId ? (
                              <Check className="w-2.5 h-2.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                            )}
                          </button>
                        </div>
                        <div className="text-[11px] text-zinc-400 font-mono font-medium">
                          {tx.customerMasked}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="font-extrabold text-white tracking-tight">
                        {formatPaise(tx.amountPaise)}
                      </div>
                      <div className="text-[10px] text-emerald-400 font-semibold capitalize flex items-center justify-end gap-1">
                        <span className="w-1 h-1 rounded-full bg-emerald-400" />
                        {tx.status}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-xs text-zinc-500 bg-white/[0.02] border border-dashed border-white/[0.06] rounded-2xl">
                  No matching transactions found.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 3: TERMINAL SECURITY & HARDWARE AUDIT */}
        {/* ==================================================== */}
        {activeTab === 'security' && (
          <div className="space-y-3 animate-in fade-in duration-200 text-xs">
            {/* Dashboard Pairing Connection Input Section */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-b from-blue-950/40 to-white/[0.02] border border-blue-500/25 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-blue-600/20 flex items-center justify-center">
                    <LinkIcon className="w-3.5 h-3.5 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-[11px]">Dashboard Terminal Pairing</h3>
                    <p className="text-[10px] text-zinc-400">Connect extension with web account</p>
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${data.deviceId && data.deviceToken
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                    }`}
                >
                  {data.deviceId && data.deviceToken ? 'Paired' : 'Not Paired'}
                </span>
              </div>

              {/* Pairing Form */}
              <form onSubmit={handlePair} className="space-y-2.5 pt-1">
                {/* 1. Pairing Code Input */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">
                      Pairing Code (8 Characters)
                    </label>
                    <span className="text-[9px] text-zinc-400">From /devices modal</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      maxLength={12}
                      placeholder="e.g. M4WH-PYTK"
                      value={pairingCode}
                      onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
                      style={{ backgroundColor: '#0d1017', color: '#f4f4f5', colorScheme: 'dark' }}
                      className="flex-1 px-3 py-2 border border-white/10 rounded-xl text-center text-xs font-mono tracking-widest text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase font-bold shadow-inner"
                    />
                    <button
                      type="submit"
                      disabled={isPairing || !pairingCode.trim()}
                      className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 text-white rounded-xl text-[11px] font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 shadow-md shadow-blue-600/25 active:scale-95"
                    >
                      {isPairing ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      <span>{data.deviceId ? 'Update' : 'Pair'}</span>
                    </button>
                  </div>
                </div>

                {/* 2. Backend API URL Field */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">
                      Web Dashboard API URL
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleSaveApiUrl('http://localhost:3000')}
                        className="text-[9px] text-blue-400 hover:text-blue-300 font-mono underline cursor-pointer"
                      >
                        localhost:3000
                      </button>
                      <span className="text-zinc-600">•</span>
                      <button
                        type="button"
                        onClick={() => handleSaveApiUrl(DEFAULT_STORAGE.apiUrl)}
                        className="text-[9px] text-zinc-400 hover:text-zinc-200 font-mono cursor-pointer"
                      >
                        default
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={pairingApiUrl}
                      onChange={(e) => setPairingApiUrl(e.target.value)}
                      onBlur={() => handleSaveApiUrl(pairingApiUrl)}
                      placeholder="http://localhost:3000"
                      style={{ backgroundColor: '#0d1017', color: '#f4f4f5', colorScheme: 'dark' }}
                      className="flex-1 px-3 py-1.5 border border-white/10 rounded-xl text-[11px] font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveApiUrl(pairingApiUrl)}
                      className="px-2.5 py-1.5 bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 hover:text-white rounded-xl text-[10px] font-medium transition-colors cursor-pointer shrink-0"
                    >
                      Save URL
                    </button>
                  </div>
                </div>

                {/* Error Box with Troubleshooting Guidance */}
                {pairError && (
                  <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-[10px] text-red-300 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold">
                      <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      <span>{pairError}</span>
                    </div>
                    {pairError.includes('Cannot reach backend') && (
                      <p className="text-[9px] text-zinc-400 pl-5 leading-normal">
                        Tip: Verify your Next.js dashboard is running (<span className="text-zinc-200 font-mono">pnpm dev</span> on <span className="text-blue-300 font-mono">http://localhost:3000</span>) or enter the correct web dashboard URL above.
                      </p>
                    )}
                  </div>
                )}

                {/* Footer status / Disconnect */}
                {data.deviceId && (
                  <div className="flex justify-between items-center pt-1 border-t border-white/[0.06]">
                    <span className="text-[10px] text-zinc-400">
                      ID: <span className="font-mono text-zinc-300">{data.deviceId.slice(0, 16)}...</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleUnpair}
                      className="text-[10px] text-red-400 hover:text-red-300 font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Unlink className="w-3 h-3" />
                      <span>Disconnect Terminal</span>
                    </button>
                  </div>
                )}
              </form>
            </div>

            {/* Terminal Card */}
            <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.06] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                  Terminal Identity
                </span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-mono border border-emerald-500/20">
                  Verified
                </span>
              </div>
              <div className="space-y-1 font-mono text-[11px]">
                <div className="flex justify-between text-zinc-400">
                  <span>Device ID:</span>
                  <span className="text-zinc-200">
                    {data.deviceId ? `${data.deviceId.slice(0, 14)}...` : 'Not paired'}
                  </span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Active Token:</span>
                  <span className="text-zinc-200">
                    {data.deviceToken ? `••••••••${data.deviceToken.slice(-8)}` : 'None'}
                  </span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Sync Interval:</span>
                  <span className="text-zinc-200">Every 2 mins (±15% jitter)</span>
                </div>
              </div>
            </div>

            {/* Read-Only Guarantee Box */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-blue-950/30 to-indigo-950/20 border border-blue-500/20 space-y-2">
              <div className="flex items-center gap-2 text-blue-300 font-bold">
                <ShieldCheck className="w-4 h-4 text-blue-400" />
                <span>read-only except one search-button click, see ADR</span>
              </div>
              <p className="text-[11px] text-zinc-300 leading-relaxed">
                This extension is read-only except one search-button click, see ADR. It has zero capability to trigger
                recharges, enter payments, or click action buttons on your portals.
              </p>
              <div className="flex items-center gap-3 pt-1 text-[10px] text-blue-300 font-medium">
                <span>✓ DPDP Compliant</span>
                <span>✓ Zero Password Stored</span>
                <span>✓ Fail-Closed</span>
              </div>
            </div>

            {/* Direct Portal Shortcuts */}
            <div className="space-y-1.5">
              <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider block px-1">
                Portal Shortcuts
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleOpenPortal(SIMPLEWALLET_URL)}
                  className="p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] text-left transition-all cursor-pointer"
                >
                  <p className="font-bold text-white text-[11px]">SimpleWallet ↗</p>
                  <p className="text-[9px] text-zinc-400 truncate">MyTrans.aspx</p>
                </button>
                <button
                  onClick={() => handleOpenPortal(EGPAYMENT_URL)}
                  className="p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] text-left transition-all cursor-pointer"
                >
                  <p className="font-bold text-white text-[11px]">EG Payment ↗</p>
                  <p className="text-[9px] text-zinc-400 truncate">recharge_history</p>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* FIXED BOTTOM ACTION BAR */}
      <div className="p-4 pt-2.5 border-t border-white/[0.06] bg-[#090A0F]/90 backdrop-blur-xl relative z-10 space-y-2">
        <div className="flex gap-2">
          {/* Main Sync Button with Wave */}
          <button
            onClick={handleSyncNow}
            disabled={isSyncing || data.isPaused}
            className="flex-1 py-2.5 px-4 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold tracking-wide uppercase shadow-lg shadow-blue-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Scanning Portals...' : 'Sync Both Portals'}</span>
          </button>

          {/* Pause / Resume Button */}
          <button
            onClick={handleTogglePause}
            className="py-2.5 px-3.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-300 hover:text-white rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
          >
            {data.isPaused ? (
              <>
                <Play className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-semibold text-emerald-400">Resume</span>
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5 text-zinc-400" />
                <span>Pause</span>
              </>
            )}
          </button>
        </div>

        {/* Dashboard Link */}
        <button
          onClick={handleOpenDashboard}
          className="w-full py-1 text-center text-xs text-zinc-400 hover:text-blue-400 transition-colors flex items-center justify-center gap-1 cursor-pointer"
        >
          <span>Open Full Cloud Web Dashboard</span>
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>

      {/* ==================================================== */}
      {/* PAIRING MODAL OVERLAY */}
      {/* ==================================================== */}
      {showPairModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPairModal(false);
          }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(5, 7, 12, 0.88)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
          className="animate-in fade-in duration-200"
        >
          <div
            style={{
              backgroundColor: '#0d1017',
              borderTop: '1px solid rgba(255, 255, 255, 0.15)',
              borderTopLeftRadius: '1.5rem',
              borderTopRightRadius: '1.5rem',
              boxShadow: '0 -25px 60px rgba(0, 0, 0, 0.98)',
              padding: '1.25rem',
              maxHeight: '92%',
              overflowY: 'auto',
            }}
            className="space-y-3.5 custom-scrollbar"
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
                  <KeyRound className="w-4 h-4 text-blue-400" />
                </div>
                <h2 className="text-sm font-bold text-white">Dashboard Terminal Pairing</h2>
              </div>
              <button
                onClick={() => setShowPairModal(false)}
                className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              Generate an 8-character pairing code in your web dashboard under <strong>Terminals / Devices</strong> and enter it below.
            </p>

            <form onSubmit={handlePair} className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
                  Pairing Code (8 Characters)
                </label>
                <input
                  type="text"
                  maxLength={12}
                  placeholder="e.g. M4WH-PYTK"
                  value={pairingCode}
                  onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
                  style={{ backgroundColor: '#07080c', color: '#f4f4f5', colorScheme: 'dark' }}
                  className="w-full px-3 py-2.5 border border-white/15 rounded-xl text-center text-lg font-mono tracking-widest text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase font-black shadow-inner"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                    Backend API URL
                  </label>
                  <button
                    type="button"
                    onClick={() => setPairingApiUrl('http://localhost:3000')}
                    className="text-[9px] text-blue-400 hover:underline"
                  >
                    localhost:3000
                  </button>
                </div>
                <input
                  type="text"
                  value={pairingApiUrl}
                  onChange={(e) => setPairingApiUrl(e.target.value)}
                  style={{ backgroundColor: '#07080c', color: '#f4f4f5', colorScheme: 'dark' }}
                  className="w-full px-3 py-2 border border-white/10 rounded-xl text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
                />
              </div>

              {pairError && (
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{pairError}</span>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                {data.deviceId && (
                  <button
                    type="button"
                    onClick={handleUnpair}
                    className="py-2.5 px-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-300 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Unlink className="w-3.5 h-3.5" />
                    <span>Disconnect</span>
                  </button>
                )}

                <button
                  type="submit"
                  disabled={isPairing || !pairingCode.trim()}
                  className="flex-1 py-2.5 px-4 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold tracking-wide uppercase shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isPairing ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Pairing Terminal...
                    </>
                  ) : (
                    <>
                      <LinkIcon className="w-3.5 h-3.5" />
                      Connect Terminal
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
