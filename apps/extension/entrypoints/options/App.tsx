import React, { useEffect, useState } from 'react';
import {
  getStorage,
  setStorage,
  DEFAULT_STORAGE,
  MIN_AUTO_CLICK_INTERVAL_SECONDS,
  type StorageData,
} from '../../lib/storage';
import { Check, Settings, ShieldCheck, Link as LinkIcon, Unlink, RefreshCw, AlertCircle, Zap, ExternalLink } from 'lucide-react';

export default function App() {
  const [storage, setStorageState] = useState<StorageData | null>(null);
  const [portalUrl, setPortalUrl] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [interval, setIntervalVal] = useState(2);
  const [keepAliveMode, setKeepAliveMode] = useState<'fetch' | 'reload'>('fetch');
  const [autoClickEnabled, setAutoClickEnabled] = useState(false);
  const [autoClickInterval, setAutoClickInterval] = useState(120);
  const [saved, setSaved] = useState(false);

  // Terminal Pairing State
  const [pairingCode, setPairingCode] = useState('');
  const [isPairing, setIsPairing] = useState(false);
  const [pairMessage, setPairMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    getStorage().then((data) => {
      setStorageState(data);
      setPortalUrl(data.portalUrl || DEFAULT_STORAGE.portalUrl);
      setApiUrl(data.apiUrl || DEFAULT_STORAGE.apiUrl);
      setIntervalVal(data.pollingIntervalMinutes || 2);
      setKeepAliveMode(data.keepAliveMode || 'fetch');
      setAutoClickEnabled(Boolean(data.autoClickEnabled));
      setAutoClickInterval(
        Math.max(MIN_AUTO_CLICK_INTERVAL_SECONDS, data.autoClickIntervalSeconds || 120),
      );
    });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const safeAutoClickInterval = Math.max(
      MIN_AUTO_CLICK_INTERVAL_SECONDS,
      Number(autoClickInterval),
    );
    await setStorage({
      portalUrl,
      apiUrl,
      pollingIntervalMinutes: Math.max(1, Number(interval)),
      keepAliveMode,
      autoClickEnabled,
      autoClickIntervalSeconds: safeAutoClickInterval,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function handlePair(e: React.FormEvent) {
    e.preventDefault();
    if (!pairingCode.trim()) return;
    setIsPairing(true);
    setPairMessage(null);

    chrome.runtime.sendMessage(
      { type: 'PAIR_DEVICE', code: pairingCode, apiUrl },
      (res: { success?: boolean; error?: string } | undefined) => {
        setIsPairing(false);
        if (res && res.success) {
          setPairMessage({ type: 'success', text: 'Terminal paired successfully with web dashboard!' });
          setPairingCode('');
          getStorage().then(setStorageState);
        } else {
          setPairMessage({ type: 'error', text: res?.error || 'Pairing failed. Check code and dashboard.' });
        }
      },
    );
  }

  async function handleUnpair() {
    if (!confirm('Are you sure you want to disconnect this terminal from the dashboard?')) {
      return;
    }
    chrome.runtime.sendMessage({ type: 'UNPAIR_DEVICE' }, () => {
      setPairMessage({ type: 'success', text: 'Terminal disconnected.' });
      getStorage().then(setStorageState);
    });
  }

  if (!storage) return <div className="p-8 text-center text-sm">Loading options...</div>;

  return (
    <div className="max-w-xl mx-auto p-8 font-sans text-zinc-900 dark:text-zinc-100">
      <div className="flex items-center gap-2.5 pb-4 border-b border-zinc-200 dark:border-zinc-800 mb-6">
        <Settings className="w-6 h-6 text-blue-600" />
        <h1 className="text-xl font-bold">WalletSync Extension Settings</h1>
      </div>

      {/* Terminal Device Pairing Card */}
      <div className="p-5 rounded-2xl border border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20 mb-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-600/20 dark:bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
              <LinkIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="font-bold text-base text-zinc-900 dark:text-zinc-100">
                Dashboard Terminal Pairing
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Connect extension with your web dashboard account
              </p>
            </div>
          </div>
          <span
            className={`px-3 py-1 rounded-full text-xs font-bold ${
              storage.deviceId && storage.deviceToken
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30'
            }`}
          >
            {storage.deviceId && storage.deviceToken ? 'Connected' : 'Not Paired'}
          </span>
        </div>

        <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
          Enter the 8-character pairing code generated in your WalletSync Web Dashboard (under <strong>Terminals / Devices</strong> or click <strong>Pair Terminal</strong>) to link this browser instance.
        </p>

        {storage.deviceId && (
          <div className="p-3 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs font-mono space-y-1.5 shadow-sm">
            <div className="flex justify-between text-zinc-500">
              <span>Device ID:</span>
              <span className="text-zinc-800 dark:text-zinc-200 font-bold">{storage.deviceId}</span>
            </div>
            <div className="flex justify-between text-zinc-500">
              <span>Token Status:</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Active (••••••••{storage.deviceToken?.slice(-6)})</span>
            </div>
          </div>
        )}

        <form onSubmit={handlePair} className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              maxLength={12}
              placeholder="ENTER 8-CHAR CODE (e.g. M4WH-PYTK)"
              value={pairingCode}
              onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
              style={{ backgroundColor: '#0d1017', color: '#f4f4f5', colorScheme: 'dark' }}
              className="flex-1 px-4 py-2.5 border border-zinc-700 rounded-xl text-sm font-mono tracking-widest text-center uppercase font-bold text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-inner"
            />
            <button
              type="submit"
              disabled={isPairing || !pairingCode.trim()}
              className="py-2.5 px-5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-md shadow-blue-600/25 shrink-0"
            >
              {isPairing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              <span>{storage.deviceId ? 'Update Pairing' : 'Pair Terminal'}</span>
            </button>
            {storage.deviceId && (
              <button
                type="button"
                onClick={handleUnpair}
                className="py-2.5 px-3.5 bg-red-100 hover:bg-red-200 dark:bg-red-950/40 dark:hover:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Unlink className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            )}
          </div>
        </form>

        {pairMessage && (
          <div
            className={`p-3 rounded-xl text-xs flex items-center gap-2.5 ${
              pairMessage.type === 'success'
                ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-700 dark:text-emerald-300'
                : 'bg-red-500/10 border border-red-500/25 text-red-700 dark:text-red-300'
            }`}
          >
            {pairMessage.type === 'success' ? (
              <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
            )}
            <span className="font-medium">{pairMessage.text}</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Sync Interval */}
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <label className="block font-medium text-sm mb-1">
            Sync Interval (minutes)
          </label>
          <p className="text-xs text-zinc-500 mb-3">
            Default 2 minutes, minimum 1 minute (with ±15% automatic jitter). Never set lower to avoid overloading the portal.
          </p>
          <input
            type="number"
            min={1}
            max={60}
            value={interval}
            onChange={(e) => setIntervalVal(Number(e.target.value))}
            className="w-32 px-3 py-1.5 border rounded-lg text-sm bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 font-semibold"
          />
        </div>

        {/* Keep-Alive Mode */}
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <label className="block font-medium text-sm mb-1">
            Keep-Alive Mode
          </label>
          <p className="text-xs text-zinc-500 mb-3">
            How the extension refreshes data from the active portal tab.
          </p>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="keepAliveMode"
                value="fetch"
                checked={keepAliveMode === 'fetch'}
                onChange={() => setKeepAliveMode('fetch')}
              />
              <span><strong>Background Fetch (Recommended)</strong> — Reads history using background request without reloading tab.</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="keepAliveMode"
                value="reload"
                checked={keepAliveMode === 'reload'}
                onChange={() => setKeepAliveMode('reload')}
              />
              <span><strong>Tab Reload</strong> — Reloads the active history tab periodically.</span>
            </label>
          </div>
        </div>

        {/* Auto-Click Search Button (Amd-Round 10: Single Exception to Read-Only) */}
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <label className="block font-medium text-sm">
                Auto-Click Search Button (SimpleWallet)
              </label>
              <p className="text-xs text-zinc-500">
                Single exception to read-only rule (see ADR 005). Capped frequency, minimum {MIN_AUTO_CLICK_INTERVAL_SECONDS}s.
              </p>
            </div>
            <input
              type="checkbox"
              checked={autoClickEnabled}
              onChange={(e) => setAutoClickEnabled(e.target.checked)}
              className="w-5 h-5 rounded text-blue-600 cursor-pointer"
            />
          </div>

          {autoClickEnabled && (
            <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <label className="block font-medium text-xs mb-1">
                Auto-Click Refresh Interval (seconds, minimum {MIN_AUTO_CLICK_INTERVAL_SECONDS}s)
              </label>
              <input
                type="number"
                min={MIN_AUTO_CLICK_INTERVAL_SECONDS}
                max={3600}
                value={autoClickInterval}
                onChange={(e) => setAutoClickInterval(Math.max(MIN_AUTO_CLICK_INTERVAL_SECONDS, Number(e.target.value)))}
                className="w-32 px-3 py-1.5 border rounded-lg text-sm bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 font-semibold"
              />
            </div>
          )}
        </div>

        {/* Automated Recharge Dispatcher (ADR 006) */}
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <Zap className="w-4 h-4 fill-current" />
              </div>
              <div>
                <label className="block font-medium text-sm">
                  Automated Recharge Dispatcher
                </label>
                <p className="text-xs text-zinc-500">
                  Terminal executes automated recharge jobs dispatched from the web dashboard.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                const targetUrl = apiUrl ? `${apiUrl.replace(/\/$/, '')}/recharge` : 'http://localhost:3000/recharge';
                if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
                  chrome.tabs.create({ url: targetUrl });
                } else {
                  window.open(targetUrl, '_blank');
                }
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>Open Recharge Hub</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Per-device URL configuration (Amd-8) */}
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-4">
          <div>
            <label className="block font-medium text-sm mb-1">
              Portal History URL
            </label>
            <p className="text-xs text-zinc-500 mb-2">
              The URL of your portal's transaction history page (per-device configuration).
            </p>
            <input
              type="text"
              value={portalUrl}
              onChange={(e) => setPortalUrl(e.target.value)}
              style={{ backgroundColor: '#0d1017', color: '#f4f4f5', colorScheme: 'dark' }}
              className="w-full px-3 py-2 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 font-mono"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block font-medium text-sm">
                Backend API URL
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setApiUrl('http://localhost:3000')}
                  className="text-xs text-blue-400 hover:underline"
                >
                  localhost:3000
                </button>
                <span className="text-zinc-600">•</span>
                <button
                  type="button"
                  onClick={() => setApiUrl(DEFAULT_STORAGE.apiUrl)}
                  className="text-xs text-zinc-400 hover:underline"
                >
                  reset
                </button>
              </div>
            </div>
            <p className="text-xs text-zinc-500 mb-2">
              The URL of your WalletSync web dashboard.
            </p>
            <input
              type="text"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              style={{ backgroundColor: '#0d1017', color: '#f4f4f5', colorScheme: 'dark' }}
              className="w-full px-3 py-2 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 font-mono"
            />
          </div>
        </div>

        {/* Non-negotiable Read-Only Notice */}
        <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
            <strong>read-only except one search-button click, see ADR:</strong> WalletSync never executes recharges, submits payments, or stores portal passwords or cookies.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="py-2.5 px-6 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
          >
            <Check className="w-4 h-4" />
            Save Preferences
          </button>
          {saved && (
            <span className="text-xs font-semibold text-emerald-600 animate-fade-in">
              Settings saved successfully!
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
