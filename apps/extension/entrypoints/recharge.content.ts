import { defineContentScript } from 'wxt/sandbox';
import {
  executeSimpleWalletRecharge,
  executeEgPaymentRecharge,
  findRechargeRowInTable,
  parseMobileRechargeRows,
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
    'https://egpayment.com/users/recharge*',
  ],
  runAt: 'document_idle',
  main() {
    // 0. Clean any legacy injected artifacts
    try {
      const oldToast = document.getElementById('walletsync-portal-toast');
      if (oldToast) oldToast.remove();
    } catch {
      // Ignore DOM cleanup errors
    }

    console.log('[WalletSync Recharge Content] Content script initialized on', window.location.href);

    // 1. Live Sync: If on MobileRecharge.aspx, parse any live transactions in the table below and ingest
    const curPath = window.location.pathname.toLowerCase();
    if (curPath.includes('mobilerecharge.aspx')) {
      try {
        const liveRows = parseMobileRechargeRows(document);
        if (liveRows.length > 0) {
          console.log(`[WalletSync Recharge Content] Ingesting ${liveRows.length} live transactions from MobileRecharge.aspx`);
          const parsedPayload: ContentParsedPageMessage = {
            type: 'CONTENT_PARSED_PAGE',
            result: {
              ok: true,
              source: 'simplewallet',
              parserVersion: '1.0.0',
              capturedAt: new Date().toISOString(),
              pageTotals: { amountPaise: liveRows.reduce((s, r) => s + r.amountPaise, 0) },
              rows: liveRows,
            },
          };
          chrome.runtime.sendMessage(parsedPayload).catch(() => {});
        }
      } catch (err) {
        console.warn('[WalletSync Recharge Content] Could not parse MobileRecharge table:', err);
      }

      // 2. Post-reload recovery: check if an active in-flight order finished during page reload
      try {
        chrome.storage.local.get(['activeRechargeOrder'], (res: { activeRechargeOrder?: { id: string; customerNo: string; amountPaise: number } }) => {
          const activeOrder = res?.activeRechargeOrder;
          if (!activeOrder) return;

          console.log('[WalletSync Recharge Content] Checking reload recovery for in-flight order:', activeOrder.id);
          const matchedRow = findRechargeRowInTable(document, activeOrder.customerNo, activeOrder.amountPaise);
          if (matchedRow) {
            console.log('[WalletSync Recharge Content] Found order result in table post-reload:', matchedRow);
            chrome.storage.local.remove('activeRechargeOrder');
            const recoveryPayload: PortalRechargeResultMessage = {
              type: 'PORTAL_RECHARGE_RESULT',
              orderId: activeOrder.id,
              status: matchedRow.status === 'failed' ? 'failed' : 'submitted',
              failureCode: matchedRow.status === 'failed' ? 'portal_rejected' : undefined,
              failureDetail:
                matchedRow.status === 'failed'
                  ? `Official portal rejected recharge: Trn No ${matchedRow.trnNo} marked as ${matchedRow.rawStatus}`
                  : undefined,
            };
            chrome.runtime.sendMessage(recoveryPayload).catch(() => {});
          }
        });
      } catch {
        // ignore
      }
    }

    // 3. Listen for secure execution instructions from the background service worker
    chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
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

        // Persist active order in case page reloads during postback
        chrome.storage.local.set({
          activeRechargeOrder: {
            id: order.id,
            customerNo: order.customerNo,
            amountPaise: order.amountPaise,
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
                    amountPaise: order.amountPaise,
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
                if (updatedRows.length > 0) {
                  chrome.runtime.sendMessage({
                    type: 'CONTENT_PARSED_PAGE',
                    result: {
                      ok: true,
                      source: 'simplewallet',
                      parserVersion: '1.0.0',
                      capturedAt: new Date().toISOString(),
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

