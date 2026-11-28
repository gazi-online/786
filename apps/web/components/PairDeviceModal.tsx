'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, Copy } from 'lucide-react';
import { useI18n } from '@/lib/i18n-context';

interface PairDeviceModalProps {
  isOpen: boolean;
  pairingCode: string;
  onClose: () => void;
  onPaired?: () => void;
}

/**
 * Shared modal for pairing a Chrome Extension using a single-use pairing code.
 * Polls `/api/v1/devices?checkCode=...` while open and closes automatically
 * once the extension completes pairing.
 */
export function PairDeviceModal({
  isOpen,
  pairingCode,
  onClose,
  onPaired,
}: PairDeviceModalProps) {
  const { t } = useI18n();
  const [copiedCode, setCopiedCode] = useState(false);
  const [pairedSuccess, setPairedSuccess] = useState(false);

  const onCloseRef = useRef(onClose);
  const onPairedRef = useRef(onPaired);
  onCloseRef.current = onClose;
  onPairedRef.current = onPaired;

  useEffect(() => {
    if (!isOpen || !pairingCode) {
      setPairedSuccess(false);
      return;
    }

    let cancelled = false;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/v1/devices?checkCode=${encodeURIComponent(pairingCode)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.paired) {
          clearInterval(pollInterval);
          setPairedSuccess(true);
          onPairedRef.current?.();
          closeTimer = setTimeout(() => {
            if (!cancelled) {
              onCloseRef.current();
            }
          }, 900);
        }
      } catch {
        // Ignore transient polling errors
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(pollInterval);
      if (closeTimer) clearTimeout(closeTimer);
    };
  }, [isOpen, pairingCode]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-xl space-y-4">
        <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
          {t.devices.modalTitle}
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t.devices.modalDesc}
        </p>

        {pairedSuccess ? (
          <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center gap-3 text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="w-6 h-6 shrink-0" />
            <div className="text-xs font-semibold">
              Chrome Extension connected successfully!
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
            <span className="font-mono text-2xl font-bold tracking-widest text-blue-600 dark:text-blue-400">
              {pairingCode}
            </span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(pairingCode);
                setCopiedCode(true);
                setTimeout(() => setCopiedCode(false), 2000);
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 hover:bg-zinc-50 flex items-center gap-1.5 shadow-2xs cursor-pointer"
            >
              {copiedCode ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copiedCode ? t.common.copied : t.common.copy}</span>
            </button>
          </div>
        )}

        <p className="text-[11px] text-zinc-400">
          {t.devices.extensionInstruction}
        </p>

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-700 cursor-pointer"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </div>
  );
}
