'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-context';
import {
  Search,
  LayoutDashboard,
  ReceiptText,
  BarChart3,
  Cpu,
  Settings,
  Sparkles,
  ArrowRight,
  X,
} from 'lucide-react';

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const router = useRouter();
  const { t } = useI18n();

  // Listen for Ctrl+K or Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  const navItems = [
    { label: t.nav.dashboard, icon: LayoutDashboard, href: '/' },
    { label: t.nav.transactions, icon: ReceiptText, href: '/transactions' },
    { label: t.nav.reports, icon: BarChart3, href: '/reports' },
    { label: t.nav.devices, icon: Cpu, href: '/devices' },
    { label: t.nav.settings, icon: Settings, href: '/settings' },
    { label: t.nav.onboarding, icon: Sparkles, href: '/onboarding' },
  ];

  const filteredNav = navItems.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase()),
  );

  const handleSelect = (href: string) => {
    setIsOpen(false);
    setQuery('');
    router.push(href);
  };

  const handleSearchTxn = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      setIsOpen(false);
      router.push(`/transactions?search=${encodeURIComponent(query.trim())}`);
      setQuery('');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.nav.commandPalette}
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={() => setIsOpen(false)}
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSearchTxn} className="flex items-center px-4 border-b border-zinc-200 dark:border-zinc-800">
          <Search className="w-5 h-5 text-zinc-400 shrink-0 mr-3" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`${t.common.search} (Enter to search txns)...`}
            className="w-full py-4 text-sm bg-transparent outline-hidden text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
          />
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            aria-label={t.common.close}
          >
            <X className="w-4 h-4" />
          </button>
        </form>

        <div className="max-h-80 overflow-y-auto p-2">
          {filteredNav.length > 0 && (
            <div className="mb-2">
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Navigation
              </div>
              {filteredNav.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.href}
                    onClick={() => handleSelect(item.href)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 text-left transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="w-4 h-4 text-zinc-500" />
                      <span>{item.label}</span>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-zinc-400 opacity-60" />
                  </button>
                );
              })}
            </div>
          )}

          {query.trim().length > 0 && (
            <div className="border-t border-zinc-100 dark:border-zinc-800/60 pt-2">
              <button
                onClick={() => {
                  setIsOpen(false);
                  router.push(`/transactions?search=${encodeURIComponent(query.trim())}`);
                }}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 text-left transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4" />
                  <span>Search all transactions for &ldquo;{query}&rdquo;</span>
                </div>
                <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                  Enter
                </span>
              </button>
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 flex items-center justify-between text-xs text-zinc-400">
          <span>Navigate with arrows, select with Enter</span>
          <span>ESC to close</span>
        </div>
      </div>
    </div>
  );
}

