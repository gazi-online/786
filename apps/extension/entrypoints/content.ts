import { defineContentScript } from 'wxt/sandbox';
import {
  parse,
  attemptAutoClick,
  MIN_AUTO_CLICK_INTERVAL_SECONDS,
} from '@walletsync/parsers';
import { type ParseResult, validateContentMessage } from '@walletsync/contract';

export default defineContentScript({
  // Hardening Amd-6: Content scripts match ONLY the exact history paths of each portal
  matches: [
    'https://simplewallet.in/web/MyTrans.aspx*',
    'https://egpayment.com/users/recharge_history*',
  ],
  runAt: 'document_idle',
  main() {
    // 0. Remove any legacy injected HUD / toast elements to keep portal UI 100% clean
    try {
      const oldToast = document.getElementById('walletsync-portal-toast');
      if (oldToast) oldToast.remove();
      const oldStyles = document.getElementById('walletsync-hud-styles');
      if (oldStyles) oldStyles.remove();
    } catch {
      // Ignore DOM cleanup errors
    }

    // 1. Function to parse current document HTML
    function parseCurrentPage(): ParseResult {
      const html = document.documentElement.outerHTML;
      return parse(html);
    }

    // 2. Safe Auto-Click on SimpleWallet search button (ADR 005)
    // Runs ONLY on exact history path, ONLY if enabled in settings, completely silent (zero UI intrusion)
    const isSimpleWalletHistoryPage =
      window.location.hostname.includes('simplewallet.in') &&
      window.location.pathname.toLowerCase().endsWith('/web/mytrans.aspx');

    if (isSimpleWalletHistoryPage) {
      chrome.storage.local.get(
        ['autoClickEnabled', 'autoClickIntervalSeconds'],
        (settings: { autoClickEnabled?: boolean; autoClickIntervalSeconds?: number }) => {
          const autoClickEnabled = settings?.autoClickEnabled !== false; // Default: true (Auto-Detector ON)
          const intervalSeconds = Math.max(
            MIN_AUTO_CLICK_INTERVAL_SECONDS,
            settings?.autoClickIntervalSeconds || 120,
          );

          if (!autoClickEnabled) return;

          function attemptInitialAutoClick(retryCount = 0) {
            const gvList = document.getElementById('gvList');
            // Table is only considered loaded if it exists and has data rows (> 1 row including header)
            if (gvList && gvList.querySelectorAll('tr').length > 1) {
              sessionStorage.removeItem('walletsync_show_clicked');
              return;
            }

            const button = (document.getElementById('cmdShow') ||
              document.querySelector(
                '#cmdShow, [id$="cmdShow"], input[name$="cmdShow"], input[type="submit"][value="Show"]',
              )) as HTMLElement | null;

            if (!button && retryCount < 15) {
              setTimeout(() => attemptInitialAutoClick(retryCount + 1), 400);
              return;
            }

            const res = attemptAutoClick(
              document,
              window.location.pathname,
              {
                autoClickEnabled: true,
                autoClickIntervalSeconds: intervalSeconds,
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
            } else if (!res.clicked && retryCount < 6) {
              setTimeout(() => attemptInitialAutoClick(retryCount + 1), 700);
            }
          }

          // Trigger after 400ms for DOM readiness
          setTimeout(() => attemptInitialAutoClick(), 400);
        },
      );
    }

    // 3. Listen for parse requests from background script
    chrome.runtime.onMessage.addListener(
      (
        rawMessage: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (res?: unknown) => void,
      ) => {
        // Validate sender and payload before executing action
        const validation = validateContentMessage(rawMessage, sender, chrome.runtime.id);
        if (!validation.ok) {
          // Unknown or unauthorized messages dropped without side effects
          return;
        }

        const message = validation.message;

        if (message.type === 'TRIGGER_PARSE' || message.type === 'TRIGGER_SHOW_CLICK') {
          const currentResult = parseCurrentPage();

          // If refresh requested or manual TRIGGER_SHOW_CLICK on SimpleWallet, attempt safe auto-click if enabled
          if ((message.refresh || message.type === 'TRIGGER_SHOW_CLICK') && isSimpleWalletHistoryPage) {
            chrome.storage.local.get(
              ['autoClickEnabled', 'autoClickIntervalSeconds'],
              (settings: { autoClickEnabled?: boolean; autoClickIntervalSeconds?: number }) => {
                const autoClickEnabled = settings?.autoClickEnabled !== false;
                if (autoClickEnabled) {
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
                  }, 150);
                }
              },
            );
          }

          sendResponse({ success: true, result: currentResult });
          return true;
        }
      },
    );

    // 4. Automatic parse on page load & continuous table observation
    // Deduplicated signature prevents spamming background script with identical data
    let lastParsedSignature = '';

    function tryParseAndNotify(): boolean {
      try {
        const result = parseCurrentPage();
        if (result.ok && result.rows.length > 0) {
          // Signature based on count and top 5 transaction IDs + statuses
          const signature = `${result.rows.length}:${result.rows
            .slice(0, 5)
            .map((r) => `${r.txnId}_${r.status}`)
            .join(',')}`;

          if (signature === lastParsedSignature) {
            return false;
          }
          lastParsedSignature = signature;

          chrome.runtime.sendMessage({
            type: 'CONTENT_PARSED_PAGE',
            result,
          }).catch(() => {});

          return true;
        }
      } catch {
        // Ignore background communication errors
      }
      return false;
    }

    // Initial parse on load
    tryParseAndNotify();

    // Continuous DOM mutation watcher for AJAX updates (e.g. after clicking Show or page update)
    let mutationDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const observerTarget =
      document.getElementById('gvList') ||
      document.querySelector('table[id*="gvList"]') ||
      document.body;

    const observer = new MutationObserver(() => {
      if (mutationDebounceTimer) clearTimeout(mutationDebounceTimer);
      mutationDebounceTimer = setTimeout(() => {
        tryParseAndNotify();
      }, 1200);
    });

    observer.observe(observerTarget, { childList: true, subtree: true });

    // 5. Periodic auto-refresh while tab is kept open (if enabled in settings)
    if (isSimpleWalletHistoryPage) {
      chrome.storage.local.get(
        ['autoClickEnabled', 'autoClickIntervalSeconds', 'isPaused'],
        (res: { autoClickEnabled?: boolean; autoClickIntervalSeconds?: number; isPaused?: boolean }) => {
          const autoClickEnabled = res?.autoClickEnabled !== false;
          if (!autoClickEnabled || res?.isPaused) return;

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
                  attemptAutoClick(
                    document,
                    window.location.pathname,
                    {
                      autoClickEnabled: true,
                      autoClickIntervalSeconds: intervalSeconds,
                    },
                  );
                }
              },
            );
          }, intervalMs);
        },
      );
    }
  },
});
