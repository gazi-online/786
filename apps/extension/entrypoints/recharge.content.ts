import { defineContentScript } from 'wxt/sandbox';
import {
  executeSimpleWalletRecharge,
  executeEgPaymentRecharge,
  extractPortalOperatorAndCircle,
  findEgPaymentMobileInput,
  findRechargeRowInTable,
  parseMobileRechargeRows,
  parseSimpleWalletHeaderStats,
  selectOperatorCard,
} from '@walletsync/parsers';
import {
  validateContentMessage,
  type PortalRechargeResultMessage,
  type ContentParsedPageMessage,
} from '@walletsync/contract';

export default defineContentScript({
  // Dedicated content script matching portals for instant, reliable command reception
  matches: [
    'https://simplewallet.in/web/MobileRecharge.aspx*',
    'https://egpayment.com/users/recharge',
    'https://egpayment.com/users/recharge/*',
  ],
  runAt: 'document_idle',
  main() {
    // 0. Safety Guard: Never execute recharge runner in history tab to avoid tab collisions
    const curHref = window.location.href.toLowerCase();
    if (curHref.includes('recharge_history') || curHref.includes('_history')) {
      console.log('[WalletSync Recharge Content] Skipping history tab to avoid tab collision:', window.location.href);
      return;
    }

    // Clean any legacy injected artifacts
    try {
      const oldToast = document.getElementById('walletsync-portal-toast');
      if (oldToast) oldToast.remove();
    } catch {
      // Ignore DOM cleanup errors
    }

    console.log('[WalletSync Recharge Content] Content script initialized on', window.location.href);

    // 1. Live Sync & Recovery Helper
    function syncLiveTable() {
      try {
        const liveRows = parseMobileRechargeRows(document);
        const headerStats = parseSimpleWalletHeaderStats(document);

        if (liveRows.length > 0 || headerStats.regularBalancePaise !== null || headerStats.commissionPaise !== null) {
          console.log(`[WalletSync Recharge Content] Syncing: ${liveRows.length} rows, balance: ${headerStats.regularBalancePaise}, commission: ${headerStats.commissionPaise}`);
          const parsedPayload: ContentParsedPageMessage = {
            type: 'CONTENT_PARSED_PAGE',
            result: {
              ok: true,
              source: 'simplewallet',
              parserVersion: '1.0.0',
              capturedAt: new Date().toISOString(),
              balancePaise: headerStats.regularBalancePaise ?? null,
              commissionPaise: headerStats.commissionPaise ?? null,
              pageTotals: { amountPaise: liveRows.reduce((s, r) => s + r.amountPaise, 0) },
              rows: liveRows,
            },
          };
          chrome.runtime.sendMessage(parsedPayload).catch(() => {});
        }
      } catch (err) {
        console.warn('[WalletSync Recharge Content] Could not parse MobileRecharge table/header:', err);
      }

      // Check reload recovery for in-flight active order
      try {
        chrome.storage.local.get(['activeRechargeOrder'], (res: { activeRechargeOrder?: { id: string; customerNo: string; amountPaise: number; operator?: string } }) => {
          const activeOrder = res?.activeRechargeOrder;
          if (!activeOrder) return;

          console.log('[WalletSync Recharge Content] Checking reload recovery for in-flight order:', activeOrder.id);
          let matchedRow = findRechargeRowInTable(document, activeOrder.customerNo, activeOrder.amountPaise);

          // If table is not present after postback, operator card might need clicking to mount the table
          if (!matchedRow && activeOrder.operator) {
            try {
              selectOperatorCard(document, activeOrder.operator);
            } catch {
              // ignore
            }
          }

          setTimeout(() => {
            const finalRow = findRechargeRowInTable(document, activeOrder.customerNo, activeOrder.amountPaise);
            if (finalRow) {
              console.log('[WalletSync Recharge Content] Found order result in table post-reload:', finalRow);
              chrome.storage.local.remove('activeRechargeOrder');
              const recoveryPayload: PortalRechargeResultMessage = {
                type: 'PORTAL_RECHARGE_RESULT',
                orderId: activeOrder.id,
                status: finalRow.status === 'failed' ? 'failed' : 'submitted',
                failureCode: finalRow.status === 'failed' ? 'portal_rejected' : undefined,
                failureDetail:
                  finalRow.status === 'failed'
                    ? `Official portal rejected recharge: Trn No ${finalRow.trnNo} marked as ${finalRow.rawStatus}`
                    : undefined,
              };
              chrome.runtime.sendMessage(recoveryPayload).catch(() => {});
            }
          }, 350);
        });
      } catch {
        // ignore
      }
    }

    const curPath = window.location.pathname.toLowerCase();
    if (curPath.includes('mobilerecharge.aspx')) {
      syncLiveTable();
      setTimeout(syncLiveTable, 1200);
      setTimeout(syncLiveTable, 3500);

      try {
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        const observer = new MutationObserver(() => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            syncLiveTable();
          }, 400);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 60000); // active for 60s
      } catch {
        // ignore
      }
    }

    // 2. Listen for messages from background script
    chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
      // Handle TRIGGER_PARSE sync request
      if (rawMessage && typeof rawMessage === 'object' && (rawMessage as { type?: string }).type === 'TRIGGER_PARSE') {
        try {
          const liveRows = parseMobileRechargeRows(document);
          const headerStats = parseSimpleWalletHeaderStats(document);
          sendResponse({
            result: {
              ok: true,
              source: 'simplewallet',
              parserVersion: '1.0.0',
              capturedAt: new Date().toISOString(),
              balancePaise: headerStats.regularBalancePaise ?? null,
              commissionPaise: headerStats.commissionPaise ?? null,
              pageTotals: { amountPaise: liveRows.reduce((s, r) => s + r.amountPaise, 0) },
              rows: liveRows,
            },
          });
        } catch {
          sendResponse({ result: null });
        }
        return true;
      }

      // Handle live operator lookup query for EG Payment portal
      if (rawMessage && typeof rawMessage === 'object' && (rawMessage as { type?: string }).type === 'QUERY_PORTAL_OPERATOR') {
        const queryMsg = rawMessage as { type: string; mobile: string };
        const mobile = queryMsg.mobile;
        console.log('[WalletSync Recharge Content] Received live operator query for mobile:', mobile);

        (async () => {
          try {
            // 1. Wait for mobile input element to be mounted in case page is loading
            let mobileInput: HTMLInputElement | null = null;
            for (let i = 0; i < 30; i++) {
              mobileInput = findEgPaymentMobileInput(document);
              if (mobileInput) break;
              await new Promise((r) => setTimeout(r, 100));
            }

            if (!mobileInput) {
              console.warn('[WalletSync Recharge Content] Mobile input element not found for query');
              sendResponse({ ok: false, error: 'Mobile input element not found on page' });
              return;
            }

            // 2. Clear old value first to ensure change detection triggers
            mobileInput.focus();
            mobileInput.value = '';
            mobileInput.dispatchEvent(new Event('input', { bubbles: true }));

            // 3. Set new mobile number and trigger all possible events for AJAX auto-fetch
            try {
              const nativeSetter = Object.getOwnPropertyDescriptor(
                document.defaultView?.HTMLInputElement?.prototype || Object.getPrototypeOf(mobileInput),
                'value',
              )?.set;
              if (nativeSetter) {
                nativeSetter.call(mobileInput, mobile);
              } else {
                mobileInput.value = mobile;
              }
            } catch {
              mobileInput.value = mobile;
            }

            mobileInput.dispatchEvent(new Event('input', { bubbles: true }));
            for (const char of mobile) {
              mobileInput.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: `Digit${char}`, bubbles: true }));
              mobileInput.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: `Digit${char}`, bubbles: true }));
              mobileInput.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: `Digit${char}`, bubbles: true }));
            }
            mobileInput.dispatchEvent(new Event('change', { bubbles: true }));
            mobileInput.dispatchEvent(new Event('blur', { bubbles: true }));

            // 4. Poll for portal DOM update of Operator and Circle (up to 4000ms)
            const startTime = Date.now();
            let details = extractPortalOperatorAndCircle(document);

            while (Date.now() - startTime < 4000) {
              details = extractPortalOperatorAndCircle(document);
              if (details.operator && !/select\s*operator/i.test(details.operator)) {
                break;
              }
              await new Promise((r) => setTimeout(r, 80));
            }

            console.log('[WalletSync Recharge Content] Live operator query final result:', details);
            sendResponse({
              ok: Boolean(details.operator && !/select\s*operator/i.test(details.operator)),
              operator: details.operator,
              circle: details.circle,
              source: 'portal_live',
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Error querying portal';
            console.error('[WalletSync Recharge Content] Exception querying operator:', msg);
            sendResponse({ ok: false, error: msg });
          }
        })();

        return true; // Keep message channel open for async sendResponse
      }

      const validation = validateContentMessage(
        rawMessage,
        sender,
        chrome.runtime.id,
      );

      if (!validation.ok) {
        // Silently drop unauthorized or malformed messages
        return;
      }

      const msg = validation.message;

      if (msg.type === 'EXECUTE_PORTAL_RECHARGE') {
        const order = msg.order;
        console.log(`[WalletSync Recharge Content] Received order for ${order.operator} ₹${order.amountPaise / 100} to ${order.source}`);

        // Persist active order with operator in case page reloads during postback
        chrome.storage.local.set({
          activeRechargeOrder: {
            id: order.id,
            customerNo: order.customerNo,
            amountPaise: order.amountPaise,
            operator: order.operator,
          },
        }).catch(() => {});

        // Immediately acknowledge receipt so background script does not timeout or close channel
        try {
          sendResponse({ received: true });
        } catch {
          // ignore
        }

        (async () => {
          try {
            console.log('[WalletSync Recharge Content] Executing portal recharge sequence...');
            const result =
              order.source === 'egpayment'
                ? await executeEgPaymentRecharge(document, {
                    customerNo: order.customerNo,
                    operator: order.operator,
                    circle: order.circle,
                    amountPaise: order.amountPaise,
                    mPin: order.mPin,
                    onQrCodeDetected: (qrData) => {
                      chrome.runtime.sendMessage({
                        type: 'PORTAL_RECHARGE_RESULT',
                        orderId: order.id,
                        status: 'needs_manual_action',
                        failureCode: 'qr_payment_required',
                        failureDetail: `Dynamic UPI QR code generated (${qrData.amountText || 'UPI'}). Scan from web portal to complete.`,
                        qrDataUrl: qrData.qrDataUrl,
                        qrAmount: qrData.amountText,
                        qrTimer: qrData.timerText,
                      }).catch(() => {});
                    },
                  })
                : await executeSimpleWalletRecharge(document, {
                    customerNo: order.customerNo,
                    operator: order.operator,
                    amountPaise: order.amountPaise,
                  });

            console.log('[WalletSync Recharge Content] Sequence finished with result:', result);
            await chrome.storage.local.remove('activeRechargeOrder');

            const responsePayload: PortalRechargeResultMessage = {
              type: 'PORTAL_RECHARGE_RESULT',
              orderId: order.id,
              status: result.status,
              failureCode: !result.ok ? result.failureCode : undefined,
              failureDetail: !result.ok ? result.failureDetail : undefined,
            };

            chrome.runtime.sendMessage(responsePayload).catch(() => {});

            // Also ingest any updated transaction rows into WalletSync
            if (order.source === 'simplewallet') {
              try {
                const updatedRows = parseMobileRechargeRows(document);
                const headerStats = parseSimpleWalletHeaderStats(document);
                if (updatedRows.length > 0 || headerStats.regularBalancePaise !== null) {
                  chrome.runtime.sendMessage({
                    type: 'CONTENT_PARSED_PAGE',
                    result: {
                      ok: true,
                      source: 'simplewallet',
                      parserVersion: '1.0.0',
                      capturedAt: new Date().toISOString(),
                      balancePaise: headerStats.regularBalancePaise ?? null,
                      commissionPaise: headerStats.commissionPaise ?? null,
                      pageTotals: { amountPaise: updatedRows.reduce((s, r) => s + r.amountPaise, 0) },
                      rows: updatedRows,
                    },
                  }).catch(() => {});
                }
              } catch {
                // ignore
              }
            }
          } catch (err: unknown) {
            const errDetail =
              err instanceof Error ? err.message.slice(0, 100) : 'Execution error';
            console.error('[WalletSync Recharge Content] Exception executing recharge:', err);
            await chrome.storage.local.remove('activeRechargeOrder');

            const failurePayload: PortalRechargeResultMessage = {
              type: 'PORTAL_RECHARGE_RESULT',
              orderId: order.id,
              status: 'failed',
              failureCode: 'execution_exception',
              failureDetail: errDetail,
            };

            chrome.runtime.sendMessage(failurePayload).catch(() => {});
          }
        })();

        // Return false since we already sent the synchronous acknowledgement
        return false;
      }
    });
  },
});
