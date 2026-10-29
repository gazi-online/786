import { defineContentScript } from 'wxt/sandbox';
import { parse } from '@walletsync/parsers';
import type { ParseResult } from '@walletsync/contract';

export default defineContentScript({
  // Matches simplewallet and egpayment domains (Amd-8: multi-portal)
  matches: ['*://*.simplewallet.in/*', '*://*.egpayment.com/*', '*://localhost/*'],
  runAt: 'document_idle',
  main() {
    // 1. Function to parse current document HTML
    function parseCurrentPage(): ParseResult {
      const html = document.documentElement.outerHTML;
      return parse(html);
    }

    // 2. Listen for parse requests from background script
    chrome.runtime.onMessage.addListener(
      (
        message: { type?: string },
        _sender: chrome.runtime.MessageSender,
        sendResponse: (res?: unknown) => void,
      ) => {
        if (message && message.type === 'TRIGGER_PARSE') {
          const result = parseCurrentPage();
          sendResponse({ success: true, result });
          return true;
        }
      },
    );

    // 3. Optional automatic parse on initial page load if requested
    try {
      const result = parseCurrentPage();
      chrome.runtime.sendMessage({
        type: 'CONTENT_PARSED_PAGE',
        result,
      }).catch(() => {
        // Background script might be sleeping; silent ignore
      });
    } catch {
      // Ignore background communication errors on initial load
    }
  },
});
