'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/components/AppLayout';
import { useI18n } from '@/lib/i18n-context';
import {
  Store,
  Download,
  Smartphone,
  ArrowRight,
  Copy,
  Check,
  Sparkles,
  RefreshCw,
} from 'lucide-react';

export default function OnboardingPage() {
  const { t } = useI18n();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [storeName, setStoreName] = useState('Demo Store');
  const [pairingCode, setPairingCode] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [firstSyncDetected, setFirstSyncDetected] = useState(false);

  // Generate pairing code when entering step 3
  useEffect(() => {
    if (step === 3 && !pairingCode) {
      fetch('/api/v1/devices', { method: 'POST' })
        .then((r) => r.json())
        .then((data) => {
          if (data.code) setPairingCode(data.code);
        })
        .catch(() => setPairingCode('SYNC-8899'));
    }
  }, [step, pairingCode]);

  // Listen for first sync via SSE or simulated pulse in step 3
  useEffect(() => {
    if (step !== 3 || firstSyncDetected) return;

    const eventSource = new EventSource('/api/v1/stream');
    eventSource.addEventListener('transaction.updated', () => {
      setFirstSyncDetected(true);
    });

    return () => {
      eventSource.close();
    };
  }, [step, firstSyncDetected]);

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto py-8">
        {/* Progress Tracker */}
        <div className="flex items-center justify-between mb-8">
          {[
            { num: 1, title: t.onboarding.step1Title },
            { num: 2, title: t.onboarding.step2Title },
            { num: 3, title: t.onboarding.step3Title },
          ].map((s, idx) => (
            <div key={s.num} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  step === s.num
                    ? 'bg-blue-600 text-white ring-4 ring-blue-100 dark:ring-blue-950'
                    : step > s.num
                    ? 'bg-emerald-600 text-white'
                    : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500'
                }`}
              >
                {step > s.num ? <Check className="w-4 h-4" /> : s.num}
              </div>
              <span className="text-xs font-medium hidden sm:inline text-zinc-700 dark:text-zinc-300">
                {s.title}
              </span>
              {idx < 2 && <div className="w-12 h-0.5 bg-zinc-200 dark:bg-zinc-800 mx-2" />}
            </div>
          ))}
        </div>

        {/* STEP 1: Store Setup */}
        {step === 1 && (
          <div className="p-8 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 flex items-center justify-center text-blue-600">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  {t.onboarding.step1Title}
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t.onboarding.step1Desc}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                {t.onboarding.storeName}
              </label>
              <input
                type="text"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder={t.onboarding.storeNamePlaceholder}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/80 text-zinc-900 dark:text-zinc-100 outline-hidden focus:border-blue-500"
              />
            </div>

            <div className="pt-4 flex justify-end">
              <button
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer"
              >
                <span>{t.common.next}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Install Extension */}
        {step === 2 && (
          <div className="p-8 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/60 flex items-center justify-center text-purple-600">
                <Download className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  {t.onboarding.step2Title}
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t.onboarding.step2Desc}
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/60 space-y-3">
              <p className="text-xs text-zinc-600 dark:text-zinc-300">
                {t.onboarding.downloadExtDesc}
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => alert('Download initiated for walletsync-extension-mv3.zip')}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 transition-opacity cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  {t.onboarding.downloadExtBtn}
                </button>
                <span className="text-[11px] text-zinc-400">Version 1.0.0 (MV3)</span>
              </div>
            </div>

            <div className="pt-4 flex justify-between">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
              >
                {t.common.back}
              </button>
              <button
                onClick={() => setStep(3)}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer"
              >
                <span>{t.common.next}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Pair & First Sync */}
        {step === 3 && (
          <div className="p-8 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm space-y-6">
            {!firstSyncDetected ? (
              <>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-600">
                    <Smartphone className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                      {t.onboarding.step3Title}
                    </h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {t.onboarding.step3Desc}
                    </p>
                  </div>
                </div>

                <div className="p-5 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] text-zinc-400 block mb-1">
                      One-time 8-character pairing code
                    </span>
                    <span className="font-mono text-2xl font-bold tracking-widest text-blue-600 dark:text-blue-400">
                      {pairingCode || 'GENERATING...'}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(pairingCode);
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 2000);
                    }}
                    className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 hover:bg-zinc-50 flex items-center gap-1.5 shadow-2xs cursor-pointer"
                  >
                    {copiedCode ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedCode ? t.common.copied : t.common.copy}</span>
                  </button>
                </div>

                <div className="p-4 rounded-xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 flex items-center gap-3">
                  <RefreshCw className="w-5 h-5 text-blue-600 animate-spin shrink-0" />
                  <div className="text-xs text-blue-900 dark:text-blue-200">
                    <p className="font-medium">{t.onboarding.waitingForSync}</p>
                    <p className="text-[11px] opacity-80 mt-0.5">
                      Open your simplewallet.in portal in Chrome. The first sync will automatically trigger.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => setFirstSyncDetected(true)}
                    className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 underline"
                  >
                    Simulate first sync arrival
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setStep(2)}
                      className="px-4 py-2 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
                    >
                      {t.common.back}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              /* First Sync Success Moment */
              <div className="py-6 text-center space-y-4 animate-in fade-in zoom-in-95 duration-200">
                <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 mx-auto flex items-center justify-center">
                  <Sparkles className="w-8 h-8" />
                </div>
                <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                  {t.onboarding.syncSuccessTitle}
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
                  {t.onboarding.syncSuccessDesc}
                </p>

                <div className="pt-4">
                  <Link
                    href="/"
                    className="inline-flex items-center gap-2 px-6 py-3 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-md transition-all cursor-pointer"
                  >
                    <span>{t.onboarding.goToDashboard}</span>
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
