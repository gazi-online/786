'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-context';
import { CommandPalette } from '@/components/CommandPalette';
import { handleSignOut } from '@/lib/supabase-client';
import {
  ShieldCheck,
  LayoutDashboard,
  ReceiptText,
  BarChart3,
  Cpu,
  Settings,
  Search,
  Languages,
  LogOut,
  Zap,
} from 'lucide-react';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { locale, setLocale, t } = useI18n();

  const navLinks = [
    { label: t.nav.dashboard, href: '/', icon: LayoutDashboard },
    { label: t.nav.recharge, href: '/recharge', icon: Zap },
    { label: t.nav.transactions, href: '/transactions', icon: ReceiptText },
    { label: t.nav.reports, href: '/reports', icon: BarChart3 },
    { label: t.nav.devices, href: '/devices', icon: Cpu },
    { label: t.nav.settings, href: '/settings', icon: Settings },
  ];

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans pb-16 sm:pb-0">
      <CommandPalette />

      {/* Main Top Header */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xs border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-4">
            {/* Logo and Read-Only Badge */}
            <div className="flex items-center gap-3">
              <Link href="/" className="flex items-center gap-2 group">
                <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-xs group-hover:bg-blue-700 transition-colors">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <span className="font-bold text-lg tracking-tight text-zinc-900 dark:text-zinc-100">
                    WalletSync
                  </span>
                </div>
              </Link>

              <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {t.devices.readOnlyBadge}
              </span>
            </div>

            {/* Middle Search & Command Palette Bar */}
            <div className="hidden md:flex flex-1 max-w-md mx-4">
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }),
                  );
                }}
                className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-zinc-400 bg-zinc-100 dark:bg-zinc-800/80 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg border border-zinc-200/80 dark:border-zinc-700/60 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Search className="w-3.5 h-3.5 text-zinc-400" />
                  <span>{t.common.search}</span>
                </div>
                <kbd className="px-1.5 py-0.5 text-[10px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded shadow-2xs">
                  Ctrl K
                </kbd>
              </button>
            </div>

            {/* Right Controls: Recharge Quick Action & Language Selector */}
            <div className="flex items-center gap-2.5">
              <Link
                href="/recharge"
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-xs transition-all hover:shadow-indigo-500/20"
                title={t.nav.recharge}
              >
                <Zap className="w-3.5 h-3.5 fill-white" />
                <span>{t.nav.recharge}</span>
              </Link>

              <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800/80 p-1 rounded-lg border border-zinc-200/80 dark:border-zinc-700/60">
                <Languages className="w-3.5 h-3.5 text-zinc-400 ml-1.5" />
                <select
                  value={locale}
                  onChange={(e) => setLocale(e.target.value as 'en' | 'bn' | 'hi')}
                  className="bg-transparent text-xs font-medium text-zinc-700 dark:text-zinc-200 outline-hidden pr-2 py-0.5 cursor-pointer"
                  aria-label={t.settings.languageTitle}
                >
                  <option value="en" className="dark:bg-zinc-900">English</option>
                  <option value="bn" className="dark:bg-zinc-900">বাংলা</option>
                  <option value="hi" className="dark:bg-zinc-900">हिन्दी</option>
                </select>
              </div>

              {/* Live Status Badge */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>{t.common.live}</span>
              </div>

              {/* Sign Out Button (purges client cache & revokes session) */}
              <button
                onClick={() => handleSignOut(router)}
                title="Sign Out"
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                aria-label="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Desktop Sub Navigation Bar */}
          <nav className="hidden sm:flex items-center gap-1 -mb-px pt-1 overflow-x-auto">
            {navLinks.map((link) => {
              const active = isActive(link.href);
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    active
                      ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:border-zinc-300'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>

      {/* Mobile Bottom Navigation Bar (< 640px) */}
      <nav
        aria-label="Mobile Navigation"
        className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-around h-16 px-2 shadow-lg"
      >
        {navLinks.map((link) => {
          const active = isActive(link.href);
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex flex-col items-center justify-center min-w-[56px] min-h-[44px] py-1 text-[11px] font-medium transition-colors ${
                active
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200'
              }`}
            >
              <Icon className="w-5 h-5 mb-0.5" />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

