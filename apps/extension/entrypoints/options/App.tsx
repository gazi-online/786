import React, { useEffect, useState } from 'react';
import { getStorage, setStorage, type StorageData } from '../../lib/storage';
import { Check, Settings, ShieldCheck } from 'lucide-react';

export default function App() {
  const [storage, setStorageState] = useState<StorageData | null>(null);
  const [portalUrl, setPortalUrl] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [interval, setIntervalVal] = useState(2);
  const [keepAliveMode, setKeepAliveMode] = useState<'fetch' | 'reload'>('fetch');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getStorage().then((data) => {
      setStorageState(data);
      setPortalUrl(data.portalUrl || 'https://simplewallet.in');
      setApiUrl(data.apiUrl || 'http://localhost:3000');
      setIntervalVal(data.pollingIntervalMinutes || 2);
      setKeepAliveMode(data.keepAliveMode || 'fetch');
    });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    await setStorage({
      portalUrl,
      apiUrl,
      pollingIntervalMinutes: Math.max(1, Number(interval)),
      keepAliveMode,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (!storage) return <div className="p-8 text-center text-sm">Loading options...</div>;

  return (
    <div className="max-w-xl mx-auto p-8 font-sans text-zinc-900 dark:text-zinc-100">
      <div className="flex items-center gap-2.5 pb-4 border-b border-zinc-200 dark:border-zinc-800 mb-6">
        <Settings className="w-6 h-6 text-blue-600" />
        <h1 className="text-xl font-bold">WalletSync Extension Settings</h1>
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
              className="w-full px-3 py-2 border rounded-lg text-sm bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700"
            />
          </div>

          <div>
            <label className="block font-medium text-sm mb-1">
              Backend API URL
            </label>
            <p className="text-xs text-zinc-500 mb-2">
              The URL of your WalletSync web dashboard.
            </p>
            <input
              type="text"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700"
            />
          </div>
        </div>

        {/* Non-negotiable Read-Only Notice */}
        <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
            <strong>Strict Read-Only Guarantee:</strong> WalletSync never executes recharges, submits payments, or stores portal passwords or cookies.
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

