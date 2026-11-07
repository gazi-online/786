'use client';

import React, { useEffect, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { useI18n } from '@/lib/i18n-context';
import {
  Shield,
  Clock,
  Bell,
  CreditCard,
  Languages,
  Check,
  AlertCircle,
  RefreshCw,
  Zap,
  AlertTriangle,
} from 'lucide-react';

export default function SettingsPage() {
  const { locale, setLocale, t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Settings form state
  const [storeName, setStoreName] = useState('Demo Store & Cyber Cafe');
  const [retentionMonths, setRetentionMonths] = useState(24);
  const [maskNumbers, setMaskNumbers] = useState(true);
  const [offlineAlert, setOfflineAlert] = useState(true);

  // Recharge Automation Settings state (Milestone R1 & R5)
  const [rechargeEnabled, setRechargeEnabled] = useState(false);
  const [perOrderMaxRupees, setPerOrderMaxRupees] = useState(1000);
  const [dailyMaxRupees, setDailyMaxRupees] = useState(5000);
  const [maxOrdersPerMinute, setMaxOrdersPerMinute] = useState(5);
  const [isSavingRechargeSettings, setIsSavingRechargeSettings] = useState(false);
  const [rechargeSavedSuccess, setRechargeSavedSuccess] = useState(false);
  const [rechargeSettingsError, setRechargeSettingsError] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
    loadRechargeSettings();
  }, []);

  async function loadRechargeSettings() {
    try {
      const res = await fetch('/api/v1/recharge-settings');
      if (res.ok) {
        const json = await res.json();
        if (json.settings) {
          setRechargeEnabled(Boolean(json.settings.rechargeEnabled));
          setPerOrderMaxRupees(Math.round(json.settings.perOrderMaxPaise / 100));
          setDailyMaxRupees(Math.round(json.settings.dailyMaxPaise / 100));
          setMaxOrdersPerMinute(json.settings.maxOrdersPerMinute || 5);
        }
      }
    } catch {
      // offline fallback
    }
  }

  async function handleSaveRechargeSettings(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setIsSavingRechargeSettings(true);
    setRechargeSettingsError(null);
    try {
      const res = await fetch('/api/v1/recharge-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rechargeEnabled,
          perOrderMaxPaise: perOrderMaxRupees * 100,
          dailyMaxPaise: dailyMaxRupees * 100,
          maxOrdersPerMinute,
          cancelQueuedOnDisable: true,
        }),
      });
      if (res.ok) {
        setRechargeSavedSuccess(true);
        setTimeout(() => setRechargeSavedSuccess(false), 2500);
      } else {
        const data = await res.json();
        setRechargeSettingsError(data.error || 'Failed to save recharge settings');
      }
    } catch {
      setRechargeSettingsError('Network error saving recharge settings');
    } finally {
      setIsSavingRechargeSettings(false);
    }
  }

  async function loadSettings() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/settings');
      if (res.ok) {
        const json = await res.json();
        if (json.storeName) setStoreName(json.storeName);
        if (json.retentionMonths) setRetentionMonths(json.retentionMonths);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading settings');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch('/api/v1/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeName, retentionMonths }),
      });
      if (res.ok) {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 2500);
      }
    } catch {
      alert('Failed to save settings');
    }
  }

  return (
    <AppLayout>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-6 border-b border-zinc-200 dark:border-zinc-800 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.settings.title}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {t.settings.subtitle}
          </p>
        </div>

        <button
          onClick={loadSettings}
          className="p-2 self-start sm:self-auto text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title={t.common.refresh}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* STATE 1: LOADING SKELETON */}
      {loading && (
        <div className="space-y-6 pt-6 max-w-3xl">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 rounded-xl bg-zinc-200 dark:bg-zinc-800/60 animate-pulse" />
          ))}
        </div>
      )}

      {/* STATE 2: ERROR */}
      {error && !loading && (
        <div className="my-8 p-6 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 text-center max-w-3xl">
          <AlertCircle className="w-8 h-8 mx-auto text-red-500 mb-2" />
          <h3 className="font-semibold text-red-900 dark:text-red-200">{t.common.error}</h3>
          <p className="text-xs text-red-600 dark:text-red-400 mt-1 mb-4">{error}</p>
          <button
            onClick={loadSettings}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
          >
            {t.common.retry}
          </button>
        </div>
      )}

      {/* STATE 3 & 4: POPULATED SETTINGS FORM */}
      {!loading && !error && (
        <form onSubmit={handleSave} className="space-y-6 pt-6 max-w-3xl">
          {savedSuccess && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-xs font-medium text-emerald-800 dark:text-emerald-300 flex items-center gap-2"
            >
              <Check className="w-4 h-4 text-emerald-500" />
              Settings saved successfully
            </div>
          )}

          {/* Privacy & PII */}
          <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 flex items-center justify-center text-blue-600">
                <Shield className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  {t.settings.privacyTitle}
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t.settings.privacyDesc}
                </p>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between">
              <div>
                <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 block">
                  {t.settings.maskToggle}
                </span>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {t.settings.maskToggleDesc}
                </span>
              </div>
              <input
                type="checkbox"
                checked={maskNumbers}
                onChange={(e) => setMaskNumbers(e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 cursor-pointer"
              />
            </div>
          </div>

          {/* Recharge Automation & Kill Switch (Milestone R1 & R5) */}
          <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <Zap className="w-4 h-4 fill-current" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    Automated Portal Recharge
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-full border font-semibold ${
                        rechargeEnabled
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                          : 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20'
                      }`}
                    >
                      {rechargeEnabled ? 'Enabled' : 'Disabled (Kill Switch Active)'}
                    </span>
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Control automated mobile recharge dispatching via paired POS terminals
                  </p>
                </div>
              </div>

              {/* Master Kill Switch Toggle */}
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={rechargeEnabled}
                  onChange={(e) => setRechargeEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none rounded-full peer dark:bg-zinc-800 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-zinc-600 peer-checked:bg-indigo-600"></div>
              </label>
            </div>

            {!rechargeEnabled && (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>
                  Feature is currently disabled. All order creation and terminal claiming are blocked. Disabling will cancel any remaining queued orders.
                </span>
              </div>
            )}

            {/* Threshold & Safety Limit Settings */}
            <div className="pt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 block mb-1">
                  Per-Order Max (₹):
                </label>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={perOrderMaxRupees}
                  onChange={(e) => setPerOrderMaxRupees(parseInt(e.target.value, 10) || 0)}
                  className="w-full px-3 py-2 text-xs font-mono font-semibold rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 outline-hidden"
                />
                <span className="text-[10px] text-zinc-400 mt-0.5 block">Max amount per single order</span>
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 block mb-1">
                  Daily Volume Limit (₹):
                </label>
                <input
                  type="number"
                  min="1"
                  max="100000"
                  value={dailyMaxRupees}
                  onChange={(e) => setDailyMaxRupees(parseInt(e.target.value, 10) || 0)}
                  className="w-full px-3 py-2 text-xs font-mono font-semibold rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 outline-hidden"
                />
                <span className="text-[10px] text-zinc-400 mt-0.5 block">Max total non-failed orders/day</span>
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 block mb-1">
                  Rate Limit (Orders/Min):
                </label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={maxOrdersPerMinute}
                  onChange={(e) => setMaxOrdersPerMinute(parseInt(e.target.value, 10) || 1)}
                  className="w-full px-3 py-2 text-xs font-mono font-semibold rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 outline-hidden"
                />
                <span className="text-[10px] text-zinc-400 mt-0.5 block">Burst protection per minute</span>
              </div>
            </div>

            {rechargeSettingsError && (
              <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 text-xs">
                {rechargeSettingsError}
              </div>
            )}

            {rechargeSavedSuccess && (
              <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-1.5 font-medium">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                Recharge safety controls updated successfully
              </div>
            )}

            <div className="pt-1 flex justify-end">
              <button
                type="button"
                onClick={handleSaveRechargeSettings}
                disabled={isSavingRechargeSettings}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white shadow-xs transition-colors cursor-pointer"
              >
                {isSavingRechargeSettings ? 'Saving Safety Controls...' : 'Save Recharge Controls'}
              </button>
            </div>
          </div>

          {/* Data Retention */}
          <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-950/60 flex items-center justify-center text-purple-600">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  {t.settings.retentionTitle}
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t.settings.retentionDesc}
                </p>
              </div>
            </div>

            <div className="pt-2">
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 block mb-1">
                {t.settings.retentionMonths}
              </label>
              <select
                value={retentionMonths}
                onChange={(e) => setRetentionMonths(parseInt(e.target.value, 10))}
                className="w-full sm:w-64 px-3 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 outline-hidden"
              >
                <option value={6}>6 months</option>
                <option value={12}>12 months (1 year)</option>
                <option value={24}>24 months (2 years)</option>
                <option value={36}>36 months (3 years)</option>
              </select>
            </div>
          </div>

          {/* Notifications */}
          <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/60 flex items-center justify-center text-amber-600">
                <Bell className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  {t.settings.notificationsTitle}
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t.settings.notificationsDesc}
                </p>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between">
              <div>
                <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 block">
                  {t.settings.offlineAlert}
                </span>
                <span className="text-[11px] text-zinc-500">
                  Receive in-app alerts if Chrome extension is inactive
                </span>
              </div>
              <input
                type="checkbox"
                checked={offlineAlert}
                onChange={(e) => setOfflineAlert(e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 cursor-pointer"
              />
            </div>
          </div>

          {/* Language Selection */}
          <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-600">
                <Languages className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  {t.settings.languageTitle}
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t.settings.languageDesc}
                </p>
              </div>
            </div>

            <div className="pt-2 flex gap-3">
              {(['en', 'bn', 'hi'] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setLocale(lang)}
                  className={`px-4 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                    locale === lang
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                      : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50'
                  }`}
                >
                  {lang === 'en' ? 'English' : lang === 'bn' ? 'বাংলা' : 'हिन्दी'}
                </button>
              ))}
            </div>
          </div>

          {/* Billing & Subscription Stub */}
          <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-300">
                  <CreditCard className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    {t.settings.billingTitle}
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t.settings.currentPlan}
                  </p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                Active
              </span>
            </div>

            <div className="pt-2 flex items-center justify-between">
              <span className="text-xs text-zinc-500">
                ₹499 / month • Next billing cycle: Nov 29, 2026
              </span>
              <button
                type="button"
                onClick={() => alert('Razorpay customer portal integration will open here.')}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
              >
                {t.settings.manageSubscription}
              </button>
            </div>
          </div>

          <div className="pt-4 flex justify-end">
            <button
              type="submit"
              className="px-5 py-2.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer"
            >
              {t.common.save}
            </button>
          </div>
        </form>
      )}
    </AppLayout>
  );
}
