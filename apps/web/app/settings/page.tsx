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
  MessageSquare,
  Send,
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

  // WhatsApp API state
  const [waEnabled, setWaEnabled] = useState(false);
  const [waApiUrl, setWaApiUrl] = useState('');
  const [waApiKey, setWaApiKey] = useState('');
  const [waNotifyNumber, setWaNotifyNumber] = useState('');
  const [waTesting, setWaTesting] = useState(false);
  const [waTestFeedback, setWaTestFeedback] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/settings');
      if (res.ok) {
        const json = await res.json();
        if (json.storeName) setStoreName(json.storeName);
        if (json.retentionMonths) setRetentionMonths(json.retentionMonths);
        if (json.whatsapp) {
          setWaEnabled(Boolean(json.whatsapp.enabled));
          setWaApiUrl(json.whatsapp.apiUrl || '');
          setWaNotifyNumber(json.whatsapp.notifyNumber || '');
        }
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
        body: JSON.stringify({
          storeName,
          retentionMonths,
          whatsapp: {
            enabled: waEnabled,
            apiUrl: waApiUrl,
            apiKey: waApiKey || undefined,
            notifyNumber: waNotifyNumber,
          },
        }),
      });
      if (res.ok) {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 2500);
      }
    } catch {
      alert('Failed to save settings');
    }
  }

  async function handleTestWhatsApp() {
    if (!waApiUrl) {
      setWaTestFeedback({ ok: false, message: 'Please enter a WhatsApp API / Webhook URL first.' });
      return;
    }
    setWaTesting(true);
    setWaTestFeedback(null);
    try {
      const res = await fetch('/api/v1/settings/whatsapp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          whatsapp: {
            enabled: true,
            apiUrl: waApiUrl,
            apiKey: waApiKey,
            notifyNumber: waNotifyNumber,
          },
        }),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        setWaTestFeedback({
          ok: true,
          message: 'Test alert sent successfully to your WhatsApp API!',
        });
      } else {
        setWaTestFeedback({
          ok: false,
          message: json.error || 'Failed to dispatch test WhatsApp alert.',
        });
      }
    } catch (err: unknown) {
      setWaTestFeedback({
        ok: false,
        message: err instanceof Error ? err.message : 'Network error testing WhatsApp API.',
      });
    } finally {
      setWaTesting(false);
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

          {/* WhatsApp / OpenWA API Notifications */}
          <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-600">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    OpenWA / WhatsApp Cloud Gateway
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 font-semibold">
                      API v1
                    </span>
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Receive automated WhatsApp alerts via OpenWA Developer Hub or custom webhook whenever transactions are synced
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={waEnabled}
                onChange={(e) => setWaEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-600 cursor-pointer"
              />
            </div>

            {waEnabled && (
              <div className="pt-2 space-y-3 border-t border-zinc-100 dark:border-zinc-800">
                <div>
                  <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 block mb-1">
                    OpenWA / WhatsApp Send Endpoint URL
                  </label>
                  <input
                    type="url"
                    value={waApiUrl}
                    onChange={(e) => setWaApiUrl(e.target.value)}
                    placeholder="https://openwa-integration-service.vercel.app/api/send"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 outline-hidden focus:ring-1 focus:ring-emerald-500"
                  />
                  <span className="text-[11px] text-zinc-500 mt-0.5 block">
                    Full endpoint URL from OpenWA Developer Hub: <code className="text-[10px] bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">https://openwa-integration-service.vercel.app/api/send</code>
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 block mb-1">
                      X-API-Key (OpenWA Secret Admin Key)
                    </label>
                    <input
                      type="password"
                      value={waApiKey}
                      onChange={(e) => setWaApiKey(e.target.value)}
                      placeholder="e.g. gazi_secret_wa_2026_xyz9733"
                      className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 outline-hidden focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 block mb-1">
                      Recipient WhatsApp Phone Number
                    </label>
                    <input
                      type="text"
                      value={waNotifyNumber}
                      onChange={(e) => setWaNotifyNumber(e.target.value)}
                      placeholder="e.g. 919733671894 (with country code)"
                      className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 outline-hidden focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                {waTestFeedback && (
                  <div
                    className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
                      waTestFeedback.ok
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                        : 'bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
                    }`}
                  >
                    {waTestFeedback.ok ? (
                      <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                    )}
                    <span>{waTestFeedback.message}</span>
                  </div>
                )}

                <div className="pt-1 flex items-center justify-between">
                  <span className="text-[11px] text-zinc-500">
                    Always preserves customer privacy: Mobile numbers are masked (••••••1234).
                  </span>
                  <button
                    type="button"
                    onClick={handleTestWhatsApp}
                    disabled={waTesting || !waApiUrl}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {waTesting ? 'Sending test...' : 'Send Test Alert'}
                  </button>
                </div>
              </div>
            )}
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
