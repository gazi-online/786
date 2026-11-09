import { defineContentScript } from 'wxt/sandbox';

export default defineContentScript({
  matches: [
    'https://walletsync-seven.vercel.app/*',
    'http://localhost:3000/*',
  ],
  runAt: 'document_idle',
  main() {
    console.log('[WalletSync Web Bridge] Initialized on', window.location.href);

    // Announce extension presence to the web application
    window.postMessage(
      {
        type: 'WALLETSYNC_EXTENSION_READY',
        version: chrome.runtime.getManifest()?.version || '0.1.0',
      },
      '*',
    );

    // Listen for requests from the web app
    window.addEventListener('message', async (event) => {
      // Security: Only accept messages originating from the same window
      if (event.source !== window || !event.data || typeof event.data !== 'object') {
        return;
      }

      const data = event.data as {
        type?: string;
        mobile?: string;
        portal?: string;
        requestId?: string;
      };

      if (data.type === 'WALLETSYNC_QUERY_PORTAL_OPERATOR') {
        const { mobile, portal, requestId } = data;
        try {
          const response = await chrome.runtime.sendMessage({
            type: 'LOOKUP_OPERATOR_ON_PORTAL',
            mobile,
            portal: portal || 'egpayment',
          });

          window.postMessage(
            {
              type: 'WALLETSYNC_PORTAL_OPERATOR_RESULT',
              requestId,
              ...response,
            },
            '*',
          );
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : 'Extension bridge failed';
          window.postMessage(
            {
              type: 'WALLETSYNC_PORTAL_OPERATOR_RESULT',
              requestId,
              ok: false,
              error: errMsg,
            },
            '*',
          );
        }
      }
    });
  },
});
