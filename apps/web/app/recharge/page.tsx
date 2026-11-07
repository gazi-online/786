'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/components/AppLayout';
import { useI18n } from '@/lib/i18n-context';
import { formatPaise, formatKolkataDate } from '@/lib/i18n';
import {
  Zap,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Smartphone,
  ArrowUpRight,
  Ban,
  Radio,
  Sliders,
} from 'lucide-react';

interface RechargeOrder {
  id: string;
  source: string;
  service: string;
  operator: string;
  customerNoMasked: string;
  customerLast4: string;
  amountPaise: number;
  status: string;
  failureCode?: string | null;
  failureDetail?: string | null;
  matchedTransactionId?: string | null;
  submittedAt?: string | null;
  reconciledAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function RechargePage() {
  const { t } = useI18n();

  // Form State
  const [portal, setPortal] = useState<'simplewallet' | 'egpayment'>('simplewallet');
  const [operator, setOperator] = useState('AIRTEL');
  const [customerNo, setCustomerNo] = useState('');
  const [amount, setAmount] = useState('');
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());

  // Orders Feed State
  const [orders, setOrders] = useState<RechargeOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);

  // Settings & Terminal Status State
  const [rechargeEnabled, setRechargeEnabled] = useState(true);
  const [terminalStatus, setTerminalStatus] = useState<'connected' | 'offline' | 'not_paired'>('offline');
  const [terminalLabel, setTerminalLabel] = useState<string>('POS Terminal');

  async function fetchOrders() {
    try {
      const res = await fetch('/api/v1/recharge-orders');
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
      }
    } catch {
      // offline fallback
    } finally {
      setLoadingOrders(false);
    }
  }

  async function fetchSettingsAndTerminal() {
    try {
      const [settingsRes, devRes] = await Promise.all([
        fetch('/api/v1/recharge-settings'),
        fetch('/api/v1/devices'),
      ]);

      if (settingsRes.ok) {
        const sData = await settingsRes.json();
        if (sData.settings) {
          setRechargeEnabled(Boolean(sData.settings.rechargeEnabled));
        }
      }

      if (devRes.ok) {
        const dData = await devRes.json();
        const devList: Array<{ revokedAt?: string | null; lastSeenAt?: string | null; label?: string | null }> = dData.devices || [];
        if (devList.length === 0) {
          setTerminalStatus('not_paired');
        } else {
          const activeDev = devList.find((d) => !d.revokedAt) || devList[0];
          const lastSeenMs = activeDev?.lastSeenAt ? new Date(activeDev.lastSeenAt).getTime() : 0;
          const isConnected = lastSeenMs > 0 && Date.now() - lastSeenMs <= 2 * 60 * 1000;
          setTerminalStatus(isConnected ? 'connected' : 'offline');
          setTerminalLabel(activeDev?.label || 'POS Terminal');
        }
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    fetchOrders();
    fetchSettingsAndTerminal();

    const interval = setInterval(() => {
      fetchOrders();
      fetchSettingsAndTerminal();
    }, 3500);

    return () => clearInterval(interval);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanNo = customerNo.replace(/\D/g, '');
    if (cleanNo.length !== 10) {
      setErrorMessage('Please enter a valid 10-digit mobile number.');
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setErrorMessage('Please enter a valid recharge amount in ₹.');
      return;
    }
    const amountPaise = Math.round(parsedAmount * 100);

    setIsSubmitting(true);

    try {
      const res = await fetch('/api/v1/recharge-orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey || crypto.randomUUID(),
        },
        body: JSON.stringify({
          source: portal,
          service: 'Prepaid',
          operator,
          customerNo: cleanNo,
          amountPaise,
          confirmDuplicate,
        }),
      });

      const data = await res.json();

      if (res.status === 409) {
        setDuplicateWarning(true);
        setErrorMessage(
          data.error || 'Duplicate recharge detected within 10 minutes. Check the confirmation box to proceed.',
        );
        return;
      }

      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to submit recharge order');
        return;
      }

      setSuccessMessage(`Recharge order queued successfully! ID: ${data.order?.id?.slice(0, 8)}...`);
      setCustomerNo('');
      setAmount('');
      setConfirmDuplicate(false);
      setDuplicateWarning(false);
      setIdempotencyKey(crypto.randomUUID());
      await fetchOrders();

      setTimeout(() => {
        setSuccessMessage(null);
      }, 4000);
    } catch {
      setErrorMessage('Network error communicating with recharge server');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancelOrder(orderId: string) {
    setCancellingOrderId(orderId);
    try {
      const res = await fetch(`/api/v1/recharge-orders/${orderId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        await fetchOrders();
      } else {
        const data = await res.json();
        alert(data.error || 'Could not cancel order');
      }
    } catch {
      alert('Network error cancelling order');
    } finally {
      setCancellingOrderId(null);
    }
  }

  const todayOrders = orders.filter((o) => {
    const oDate = new Date(o.createdAt);
    const today = new Date();
    return (
      oDate.getDate() === today.getDate() &&
      oDate.getMonth() === today.getMonth() &&
      oDate.getFullYear() === today.getFullYear()
    );
  });

  const successToday = todayOrders.filter((o) => o.status === 'success');
  const totalPaiseToday = successToday.reduce((sum, o) => sum + o.amountPaise, 0);

  return (
    <AppLayout>
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-6 border-b border-zinc-200 dark:border-zinc-800 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Recharge Automation Hub
            </h1>
            <span
              className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full border ${
                rechargeEnabled
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                  : 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20'
              }`}
            >
              {rechargeEnabled ? 'Service Active' : 'Kill Switch Active'}
            </span>
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Automate prepaid mobile recharges across distributor portals via connected browser terminals
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Safety Controls</span>
          </Link>

          <button
            onClick={() => {
              fetchOrders();
              fetchSettingsAndTerminal();
            }}
            className="p-2 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            title={t.common.refresh}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!rechargeEnabled && (
        <div className="my-4 p-4 rounded-xl border border-amber-300 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              <strong>Automated Recharge is disabled</strong> in tenant settings. Orders cannot be created or dispatched until enabled.
            </span>
          </div>
          <Link
            href="/settings"
            className="px-3 py-1 rounded-md bg-amber-600 text-white font-semibold hover:bg-amber-500 transition-colors"
          >
            Enable in Settings
          </Link>
        </div>
      )}

      {/* Main Grid: Left = Form, Right = Terminal & Balance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 my-6">
        {/* Left Column: Recharge Form (2 cols wide on desktop) */}
        <div className="lg:col-span-2 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/90 shadow-xs space-y-4">
          <div className="flex items-center gap-2.5 pb-2 border-b border-zinc-100 dark:border-zinc-800">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
              <Zap className="w-4 h-4 fill-current" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                New Instant Recharge
              </h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Fills and submits portal form automatically in background POS terminal
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Portal Selection */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                Target Distributor Portal:
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPortal('simplewallet')}
                  className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-all ${
                    portal === 'simplewallet'
                      ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 shadow-xs'
                      : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span>SimpleWallet (simplewallet.in)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPortal('egpayment')}
                  className={`p-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-all ${
                    portal === 'egpayment'
                      ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 shadow-xs'
                      : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span>EG Payment (egpayment.com)</span>
                </button>
              </div>
            </div>

            {/* Operator Selection */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                Mobile Operator:
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { id: 'AIRTEL', name: 'Airtel' },
                  { id: 'JIO', name: 'Jio' },
                  { id: 'VI', name: 'Vi' },
                  { id: 'BSNL', name: 'BSNL' },
                ].map((op) => (
                  <button
                    key={op.id}
                    type="button"
                    onClick={() => setOperator(op.id)}
                    className={`p-2 rounded-xl border text-xs font-semibold text-center cursor-pointer transition-all ${
                      operator === op.id
                        ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300'
                    }`}
                  >
                    {op.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Customer Number & Amount Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Mobile Number (10 Digits):
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-zinc-400">
                    +91
                  </span>
                  <input
                    type="tel"
                    maxLength={10}
                    value={customerNo}
                    onChange={(e) => setCustomerNo(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="10-digit mobile number"
                    className="w-full pl-12 pr-4 py-2.5 text-sm font-mono tracking-wider rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Amount (₹):
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-zinc-400">
                    ₹
                  </span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="299"
                    className="w-full pl-8 pr-4 py-2.5 text-sm font-semibold rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                </div>
                {/* Popular Plan Chips */}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <span className="text-[10px] text-zinc-400 mr-1">Popular:</span>
                  {['19', '199', '299', '666', '799'].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setAmount(amt)}
                      className="px-2 py-0.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[11px] font-mono text-zinc-700 dark:text-zinc-300 cursor-pointer transition-colors"
                    >
                      ₹{amt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Duplicate Order Confirmation Warning (409 Guard) */}
            {duplicateWarning && (
              <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-amber-800 dark:text-amber-300 text-xs space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Duplicate Recharge Warning</p>
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                      An identical recharge for this number and amount was created within the last 10 minutes. Please confirm to prevent duplicate charges.
                    </p>
                  </div>
                </div>
                <label className="flex items-center gap-2 pt-1 font-semibold cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={confirmDuplicate}
                    onChange={(e) => setConfirmDuplicate(e.target.checked)}
                    className="rounded border-amber-400 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                  />
                  <span>I confirm this is an intentional duplicate recharge</span>
                </label>
              </div>
            )}

            {/* Error Banner */}
            {errorMessage && !duplicateWarning && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
                <XCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Success Banner */}
            {successMessage && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{successMessage}</span>
              </div>
            )}

            {/* Submit Action */}
            <div className="flex items-center justify-end pt-2">
              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  !rechargeEnabled ||
                  customerNo.length !== 10 ||
                  !amount ||
                  (duplicateWarning && !confirmDuplicate)
                }
                className="px-6 py-2.5 text-xs font-bold rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white shadow-md shadow-indigo-600/20 transition-all flex items-center gap-2 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Submitting Order...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5 fill-current" />
                    <span>Dispatch Recharge</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Right Column: Terminal Health & Portal Hub Status */}
        <div className="space-y-4">
          <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <Smartphone className="w-4 h-4 text-zinc-500" />
                Terminal Status
              </span>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full border font-semibold ${
                  terminalStatus === 'connected'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                    : 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20'
                }`}
              >
                {terminalStatus === 'connected' ? 'Connected' : 'Offline / Waiting'}
              </span>
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Terminal: <strong className="text-zinc-800 dark:text-zinc-200">{terminalLabel}</strong>
            </p>

            <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 text-[11px] text-zinc-500 space-y-1">
              <p>• Polling for orders every 2s</p>
              <p>• Atomic lease with 60s timeout</p>
              <p>• AES-256-GCM encrypted PII</p>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs space-y-2">
            <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 block">
              Today's Automated Sales
            </span>
            <p className="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-50">
              {formatPaise(totalPaiseToday)}
            </p>
            <span className="text-xs text-zinc-500">
              {successToday.length} successful automated orders today
            </span>
          </div>

          {/* Portal Direct Launch Links */}
          <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs space-y-2">
            <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 block">
              Direct Portal Launch
            </span>
            <div className="space-y-1.5">
              <a
                href="https://simplewallet.in/web/MobileRecharge.aspx"
                target="_blank"
                rel="noreferrer"
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-semibold flex items-center justify-between text-zinc-700 dark:text-zinc-300 transition-colors"
              >
                <span>SimpleWallet Recharge</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-blue-500" />
              </a>
              <a
                href="https://egpayment.com/users/recharge"
                target="_blank"
                rel="noreferrer"
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-semibold flex items-center justify-between text-zinc-700 dark:text-zinc-300 transition-colors"
              >
                <span>EG Payment Recharge</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-amber-500" />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section: Active & Recent Recharge Orders Tracker */}
      <div className="p-5 my-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-indigo-500 animate-pulse" />
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              Recharge Orders Queue & Live Tracker
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-semibold">
              {orders.length} orders
            </span>
          </div>

          <button
            type="button"
            onClick={fetchOrders}
            className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Refresh Feed</span>
          </button>
        </div>

        {loadingOrders && orders.length === 0 ? (
          <div className="h-36 rounded-xl bg-zinc-100 dark:bg-zinc-800/60 animate-pulse" />
        ) : orders.length === 0 ? (
          <div className="p-8 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/20 text-center text-xs text-zinc-500 dark:text-zinc-400 space-y-1">
            <p className="font-semibold text-zinc-700 dark:text-zinc-300">No recharge orders created yet</p>
            <p>Use the form above to dispatch an automated prepaid recharge.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 dark:bg-zinc-900/60 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Target Number</th>
                  <th className="py-2.5 px-3">Operator / Portal</th>
                  <th className="py-2.5 px-3 text-right">Amount</th>
                  <th className="py-2.5 px-3">Created</th>
                  <th className="py-2.5 px-3 text-right">Action / Reconciliation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {orders.map((order) => {
                  const isQueued = order.status === 'queued';
                  const isClaimed = order.status === 'claimed';
                  const isSubmitting = order.status === 'submitting';
                  const isSubmitted = order.status === 'submitted';
                  const isSuccess = order.status === 'success';
                  const isFailed = order.status === 'failed';
                  const isCancelled = order.status === 'cancelled';
                  const isActionNeeded = order.status === 'needs_manual_action';

                  return (
                    <tr key={order.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 transition-colors">
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {isQueued && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20">
                            <Clock className="w-3 h-3 text-zinc-400 animate-spin" />
                            Queued
                          </span>
                        )}
                        {isClaimed && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                            Claimed by Terminal
                          </span>
                        )}
                        {isSubmitting && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                            <RefreshCw className="w-3 h-3 animate-spin text-purple-500" />
                            Submitting on Portal
                          </span>
                        )}
                        {isSubmitted && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                            Submitted (Awaiting Operator)
                          </span>
                        )}
                        {isSuccess && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                            Success
                          </span>
                        )}
                        {isFailed && (
                          <span
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                            title={order.failureDetail || order.failureCode || 'Failed'}
                          >
                            <XCircle className="w-3 h-3 text-rose-500" />
                            Failed
                          </span>
                        )}
                        {isCancelled && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-500/10 text-zinc-500 border border-zinc-500/20">
                            <Ban className="w-3 h-3 text-zinc-400" />
                            Cancelled
                          </span>
                        )}
                        {isActionNeeded && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20">
                            <AlertTriangle className="w-3 h-3 text-orange-500" />
                            Action Required
                          </span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 font-mono font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                        {order.customerNoMasked}
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="font-semibold text-zinc-800 dark:text-zinc-200">{order.operator}</span>
                        <span className="text-zinc-400 mx-1">•</span>
                        <span className="capitalize text-zinc-500">{order.source}</span>
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-bold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                        {formatPaise(order.amountPaise)}
                      </td>

                      <td className="py-2.5 px-3 text-zinc-400 whitespace-nowrap">
                        {formatKolkataDate(order.createdAt)}
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {isQueued && (
                          <button
                            type="button"
                            onClick={() => handleCancelOrder(order.id)}
                            disabled={cancellingOrderId === order.id}
                            className="px-2 py-1 rounded-md text-[11px] font-semibold bg-zinc-100 dark:bg-zinc-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-zinc-600 hover:text-rose-600 dark:text-zinc-400 dark:hover:text-rose-400 border border-zinc-200 dark:border-zinc-700 transition-colors cursor-pointer"
                          >
                            {cancellingOrderId === order.id ? 'Cancelling...' : 'Cancel'}
                          </button>
                        )}
                        {order.reconciledAt && (
                          <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full font-semibold border border-emerald-500/20">
                            Reconciled ✓
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

