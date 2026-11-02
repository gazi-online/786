import { defineContentScript } from 'wxt/sandbox';
import {
  parse,
  attemptAutoClick,
  MIN_AUTO_CLICK_INTERVAL_SECONDS,
  EXACT_EXPECTED_PATH,
} from '@walletsync/parsers';
import type { ParseResult } from '@walletsync/contract';

export default defineContentScript({
  // Hardening Amd-6: Content scripts match ONLY the exact history paths of each portal
  matches: [
    'https://simplewallet.in/web/MyTrans.aspx*',
    'https://egpayment.com/users/recharge_history*',
  ],
  runAt: 'document_idle',
  main() {
    // 1. Function to parse current document HTML
    function parseCurrentPage(): ParseResult {
      const html = document.documentElement.outerHTML;
      return parse(html);
    }

    // Helper for non-intrusive floating toast notifications
    function showNotification(text: string, type: 'info' | 'success' = 'info') {
      try {
        let toast = document.getElementById('walletsync-portal-toast');
        if (!toast) {
          toast = document.createElement('div');
          toast.id = 'walletsync-portal-toast';
          toast.style.position = 'fixed';
          toast.style.bottom = '24px';
          toast.style.right = '24px';
          toast.style.padding = '10px 18px';
          toast.style.borderRadius = '10px';
          toast.style.fontSize = '12px';
          toast.style.fontWeight = '600';
          toast.style.fontFamily = 'system-ui, -apple-system, sans-serif';
          toast.style.zIndex = '999999';
          toast.style.boxShadow = '0 10px 25px rgba(0,0,0,0.2)';
          toast.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
          toast.style.display = 'flex';
          toast.style.alignItems = 'center';
          toast.style.gap = '8px';
          document.body.appendChild(toast);
        }

        if (type === 'success') {
          toast.style.backgroundColor = '#059669';
          toast.style.color = '#ffffff';
          toast.style.border = '1px solid #10b981';
        } else {
          toast.style.backgroundColor = '#1e40af';
          toast.style.color = '#ffffff';
          toast.style.border = '1px solid #3b82f6';
        }
        toast.textContent = text;
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';

        setTimeout(() => {
          if (toast) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
          }
        }, 3500);
      } catch {
        // Ignore DOM toast creation errors
      }
    }

    // 2. Safe Auto-Click on SimpleWallet search button (ADR 005)
    // Runs ONLY on exact history path, ONLY if enabled in settings, ONLY after fingerprint matches
    if (window.location.hostname.includes('simplewallet.in') && window.location.pathname === EXACT_EXPECTED_PATH) {
      const gvList = document.getElementById('gvList');

      chrome.storage.local.get(
        ['autoClickEnabled', 'autoClickIntervalSeconds'],
        (settings: { autoClickEnabled?: boolean; autoClickIntervalSeconds?: number }) => {
          const autoClickEnabled = Boolean(settings?.autoClickEnabled); // Safest default: false
          const intervalSeconds = Math.max(
            MIN_AUTO_CLICK_INTERVAL_SECONDS,
            settings?.autoClickIntervalSeconds || 120,
          );

          if (!gvList && autoClickEnabled) {
            const lastClickStr = sessionStorage.getItem('walletsync_show_clicked');
            const lastClick = lastClickStr ? parseInt(lastClickStr, 10) : undefined;
            const now = Date.now();

            if (!lastClick || now - lastClick > intervalSeconds * 1000) {
              showNotification('WalletSync: Auto-loading transactions in 2 seconds...', 'info');

              setTimeout(() => {
                const res = attemptAutoClick(
                  document,
                  window.location.pathname,
                  {
                    autoClickEnabled,
                    autoClickIntervalSeconds: intervalSeconds,
                    ...(lastClick !== undefined ? { lastClickTime: lastClick } : {}),
                  },
                  (detail) => {
                    chrome.runtime.sendMessage({
                      type: 'CONTENT_PARSER_ERROR',
                      error: { reason: 'layout_changed', detail },
                    }).catch(() => {});
                  },
                );

                if (res.clicked) {
                  sessionStorage.setItem('walletsync_show_clicked', Date.now().toString());
                }
              }, 2000);
            }
          } else if (gvList) {
            // Table loaded; clear initial load session flag
            sessionStorage.removeItem('walletsync_show_clicked');
          }
        },
      );
    }

    // 3. Listen for parse requests from background script
    chrome.runtime.onMessage.addListener(
      (
        message: { type?: string; refresh?: boolean },
        _sender: chrome.runtime.MessageSender,
        sendResponse: (res?: unknown) => void,
      ) => {
        if (message && message.type === 'TRIGGER_PARSE') {
          // If refresh requested and on SimpleWallet, attempt safe auto-click if enabled
          if (message.refresh && window.location.hostname.includes('simplewallet.in')) {
            chrome.storage.local.get(
              ['autoClickEnabled', 'autoClickIntervalSeconds'],
              (settings: { autoClickEnabled?: boolean; autoClickIntervalSeconds?: number }) => {
                if (settings?.autoClickEnabled) {
                  showNotification('WalletSync: Refreshing transactions in 2 seconds...', 'info');
                  setTimeout(() => {
                    attemptAutoClick(
                      document,
                      window.location.pathname,
                      {
                        autoClickEnabled: true,
                        autoClickIntervalSeconds: Math.max(
                          MIN_AUTO_CLICK_INTERVAL_SECONDS,
                          settings?.autoClickIntervalSeconds || 120,
                        ),
                      },
                    );
                  }, 2000);
                  sendResponse({ success: true, pending: true, message: 'Refreshing via Show button' });
                } else {
                  const result = parseCurrentPage();
                  sendResponse({ success: true, result });
                }
              },
            );
            return true;
          }

          const result = parseCurrentPage();
          sendResponse({ success: true, result });
          return true;
        }
      },
    );

    // 4. Automatic parse on page load (if table is present)
    try {
      const result = parseCurrentPage();
      if (result.ok) {
        chrome.runtime.sendMessage({
          type: 'CONTENT_PARSED_PAGE',
          result,
        }).catch(() => {});

        if (window.location.hostname.includes('simplewallet.in')) {
          showNotification(`WalletSync: ${result.rows.length} transactions synced ✓`, 'success');
        }
      }
    } catch {
      // Ignore background communication errors on initial load
    }

    // 5. Periodic auto-refresh while tab is kept open (if enabled in settings)
    if (window.location.hostname.includes('simplewallet.in') && window.location.pathname === EXACT_EXPECTED_PATH) {
      chrome.storage.local.get(
        ['autoClickEnabled', 'autoClickIntervalSeconds', 'isPaused'],
        (res: { autoClickEnabled?: boolean; autoClickIntervalSeconds?: number; isPaused?: boolean }) => {
          if (!res?.autoClickEnabled || res?.isPaused) return;

          const intervalSeconds = Math.max(
            MIN_AUTO_CLICK_INTERVAL_SECONDS,
            res?.autoClickIntervalSeconds || 120,
          );
          const intervalMs = intervalSeconds * 1000;

          setInterval(() => {
            chrome.storage.local.get(
              ['autoClickEnabled', 'isPaused'],
              (liveRes: { autoClickEnabled?: boolean; isPaused?: boolean }) => {
                if (!liveRes?.autoClickEnabled || liveRes?.isPaused) return;

                // Never interrupt if user is actively typing in an input
                const isUserTyping =
                  document.activeElement &&
                  (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT');

                if (!isUserTyping) {
                  showNotification('WalletSync: Auto-refreshing transactions in 2 seconds...', 'info');
                  setTimeout(() => {
                    attemptAutoClick(
                      document,
                      window.location.pathname,
                      {
                        autoClickEnabled: true,
                        autoClickIntervalSeconds: intervalSeconds,
                      },
                    );
                  }, 2000);
                }
              },
            );
          }, intervalMs);
        },
      );
    }
  },
});
