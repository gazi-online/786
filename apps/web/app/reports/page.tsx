'use client';

import React, { useEffect, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { useI18n } from '@/lib/i18n-context';
import { formatPaise } from '@/lib/i18n';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts';
import {
  BarChart3,
  TrendingUp,
  Percent,
  Clock,
  Layers,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

interface ReportData {
  summary: {
    totalVolumePaise: number;
    totalDiscountPaise: number;
    totalCount: number;
    successRate: string;
    avgTxnPaise: number;
    peakHour: string;
    vsPreviousPeriodPct: string;
  };
  salesByDay: Array<{ date: string; volumePaise: number; count: number; discountPaise: number }>;
  salesByService: Array<{ service: string; volumePaise: number; count: number }>;
  salesByOperator: Array<{ operator: string; volumePaise: number; count: number }>;
  salesByHour: Array<{ hour: string; volumePaise: number; count: number }>;
}

const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

export default function ReportsPage() {
  const { t } = useI18n();
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadReports();
  }, []);

  async function loadReports() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/reports');
      if (!res.ok) throw new Error('Failed to load reports');
      const json = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error fetching reports');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppLayout>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-6 border-b border-zinc-200 dark:border-zinc-800 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.reports.title}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {t.reports.subtitle}
          </p>
        </div>

        <button
          onClick={loadReports}
          className="p-2 self-start sm:self-auto text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title={t.common.refresh}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* STATE 1: LOADING SKELETON */}
      {loading && (
        <div className="space-y-6 pt-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 rounded-xl bg-zinc-200 dark:bg-zinc-800/60 animate-pulse" />
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="h-72 rounded-xl bg-zinc-200 dark:bg-zinc-800/60 animate-pulse" />
            <div className="h-72 rounded-xl bg-zinc-200 dark:bg-zinc-800/60 animate-pulse" />
          </div>
        </div>
      )}

      {/* STATE 2: ERROR */}
      {error && !loading && (
        <div className="my-8 p-6 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 text-center">
          <AlertCircle className="w-8 h-8 mx-auto text-red-500 mb-2" />
          <h3 className="font-semibold text-red-900 dark:text-red-200">{t.common.error}</h3>
          <p className="text-xs text-red-600 dark:text-red-400 mt-1 mb-4">{error}</p>
          <button
            onClick={loadReports}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
          >
            {t.common.retry}
          </button>
        </div>
      )}

      {/* STATE 3: EMPTY */}
      {!loading && !error && data && data.summary.totalCount === 0 && (
        <div className="my-8 p-12 text-center border border-zinc-200 dark:border-zinc-800 rounded-xl bg-white dark:bg-zinc-900">
          <BarChart3 className="w-10 h-10 mx-auto text-zinc-400 mb-3" />
          <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
            {t.reports.emptyState}
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-sm mx-auto">
            {t.reports.emptyStateDesc}
          </p>
        </div>
      )}

      {/* STATE 4: POPULATED */}
      {!loading && !error && data && data.summary.totalCount > 0 && (
        <div className="space-y-6 pt-6">
          {/* Summary Metric Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{t.reports.totalVolume}</span>
              <p className="text-xl sm:text-2xl font-bold tracking-tight mt-1 text-zinc-900 dark:text-zinc-100 tabular-nums">
                {formatPaise(data.summary.totalVolumePaise)}
              </p>
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 block">
                {data.summary.vsPreviousPeriodPct} {t.reports.vsPreviousPeriod}
              </span>
            </div>

            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{t.reports.discountEarned}</span>
              <p className="text-xl sm:text-2xl font-bold tracking-tight mt-1 text-zinc-900 dark:text-zinc-100 tabular-nums">
                {formatPaise(data.summary.totalDiscountPaise)}
              </p>
              <span className="text-[11px] text-zinc-500 mt-1 block">
                Average 1.5% margin
              </span>
            </div>

            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{t.reports.avgTxnValue}</span>
              <p className="text-xl sm:text-2xl font-bold tracking-tight mt-1 text-zinc-900 dark:text-zinc-100 tabular-nums">
                {formatPaise(data.summary.avgTxnPaise)}
              </p>
              <span className="text-[11px] text-zinc-500 mt-1 block">
                Across {data.summary.totalCount} transactions
              </span>
            </div>

            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{t.reports.peakHour}</span>
              <p className="text-xl sm:text-2xl font-bold tracking-tight mt-1 text-zinc-900 dark:text-zinc-100">
                {data.summary.peakHour}
              </p>
              <span className="text-[11px] text-zinc-500 mt-1 block">
                Highest customer traffic
              </span>
            </div>
          </div>

          {/* Charts Row 1: Daily Volume + Hourly Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Sales By Day */}
            <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs space-y-4">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                {t.reports.salesByDay}
              </h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.salesByDay}>
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#a1a1aa" />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="#a1a1aa"
                      tickFormatter={(val) => `₹${(val / 100).toFixed(0)}`}
                    />
                    <Tooltip
                      formatter={(val: unknown) => [`₹${(Number(val ?? 0) / 100).toFixed(2)}`, 'Volume']}
                    />
                    <Bar dataKey="volumePaise" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Sales By Hour */}
            <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs space-y-4">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-600" />
                {t.reports.salesByHour}
              </h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.salesByHour}>
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} stroke="#a1a1aa" interval={2} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="#a1a1aa"
                      tickFormatter={(val) => `₹${(val / 100).toFixed(0)}`}
                    />
                    <Tooltip
                      formatter={(val: unknown) => [`₹${(Number(val ?? 0) / 100).toFixed(2)}`, 'Volume']}
                    />
                    <Line
                      type="monotone"
                      dataKey="volumePaise"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Charts Row 2: Operator Breakdown & Service Share */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Sales By Operator */}
            <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs space-y-4">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-600" />
                {t.reports.salesByOperator}
              </h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.salesByOperator} layout="vertical">
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10 }}
                      stroke="#a1a1aa"
                      tickFormatter={(val) => `₹${(val / 100).toFixed(0)}`}
                    />
                    <YAxis dataKey="operator" type="category" tick={{ fontSize: 11 }} stroke="#a1a1aa" width={70} />
                    <Tooltip formatter={(val: unknown) => [`₹${(Number(val ?? 0) / 100).toFixed(2)}`, 'Volume']} />
                    <Bar dataKey="volumePaise" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Sales By Service */}
            <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs space-y-4">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Percent className="w-4 h-4 text-amber-600" />
                {t.reports.salesByService}
              </h3>
              <div className="h-64 w-full flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.salesByService}
                      dataKey="volumePaise"
                      nameKey="service"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={({ name, percent }: { name?: string; percent?: number }) =>
                        `${name || ''}: ${((percent || 0) * 100).toFixed(0)}%`
                      }
                    >
                      {data.salesByService.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length] || '#2563eb'} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(val: unknown) => [`₹${(Number(val ?? 0) / 100).toFixed(2)}`, 'Volume']} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
