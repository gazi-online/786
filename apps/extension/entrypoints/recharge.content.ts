import { defineContentScript } from 'wxt/sandbox';
import {
  executeSimpleWalletRecharge,
  executeEgPaymentRecharge,
} from '@walletsync/parsers';
import {
  validateContentMessage,
  type PortalRechargeResultMessage,
} from '@walletsync/contract';

export default defineContentScript({
  // Dedicated content script strictly matching ONLY portal recharge forms
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

    // 1. Listen for secure execution instructions from the background service worker
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

        try {
          const result =
            order.source === 'egpayment'
              ? executeEgPaymentRecharge(document, {
                  customerNo: order.customerNo,
                  operator: order.operator,
                  amountPaise: order.amountPaise,
                })
              : executeSimpleWalletRecharge(document, {
                  customerNo: order.customerNo,
                  operator: order.operator,
                  amountPaise: order.amountPaise,
                });

          const responsePayload: PortalRechargeResultMessage = {
            type: 'PORTAL_RECHARGE_RESULT',
            orderId: order.id,
            status: result.status,
            failureCode: !result.ok ? result.failureCode : undefined,
            failureDetail: !result.ok ? result.failureDetail : undefined,
          };

          chrome.runtime.sendMessage(responsePayload).catch(() => {});
          sendResponse({ received: true });
        } catch (err: unknown) {
          const errDetail =
            err instanceof Error ? err.message.slice(0, 100) : 'Execution error';

          const failurePayload: PortalRechargeResultMessage = {
            type: 'PORTAL_RECHARGE_RESULT',
            orderId: order.id,
            status: 'failed',
            failureCode: 'execution_exception',
            failureDetail: errDetail,
          };

          chrome.runtime.sendMessage(failurePayload).catch(() => {});
          sendResponse({ received: false, error: errDetail });
        }
      }
    });
  },
});

