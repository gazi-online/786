import { defineBackground } from 'wxt/sandbox';
import {
  getStorage,
  setStorage,
  type StorageData,
} from '../lib/storage';
import {
  openDedicatedBackgroundTab,
  closeDedicatedTab,
} from '../lib/tab-manager';
import {
  SCHEMA_VERSION,
  type IngestRequest,
  type ParseResult,
  validateBackgroundMessage,
} from '@walletsync/contract';
import { parse } from '@walletsync/parsers';

const ALARM_NAME = 'walletsync_poll_alarm';
const HEARTBEAT_ALARM_NAME = 'walletsync_heartbeat_alarm';
const RECHARGE_POLL_ALARM_NAME = 'walletsync_recharge_poll';

export default defineBackground(() => {
  // 1. Initialize alarms on install / startup
  async function setupAlarms() {
    const data = await getStorage();
    const intervalMinutes = Math.max(1, data.pollingIntervalMinutes || 2);
    // Add ±15% jitter to avoid predictable load spikes
    const jitterFactor = 1 + (Math.random() * 0.3 - 0.15);
    const periodInMinutes = Math.max(1, intervalMinutes * jitterFactor);

    await chrome.alarms.clear(ALARM_NAME);
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: 1,
      periodInMinutes,
    });

    await chrome.alarms.clear(HEARTBEAT_ALARM_NAME);
    chrome.alarms.create(HEARTBEAT_ALARM_NAME, {
      delayInMinutes: 0.1,
      periodInMinutes: 1,
    });

    await chrome.alarms.clear(RECHARGE_POLL_ALARM_NAME);
    chrome.alarms.create(RECHARGE_POLL_ALARM_NAME, {
      delayInMinutes: 0.2,
      periodInMinutes: 1,
    });
  }

  setupAlarms();

  chrome.runtime.onInstalled.addListener(() => {
    setupAlarms();
  });

  if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
      setupAlarms();
    });
  }

  chrome.alarms.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
    if (alarm.name === ALARM_NAME) {
      triggerSyncCycle();
    } else if (alarm.name === HEARTBEAT_ALARM_NAME) {
      sendHeartbeat();
    } else if (alarm.name === RECHARGE_POLL_ALARM_NAME) {
      triggerRechargeDispatcherCycle();
    }
  });

  // 2. Perform synchronization cycle
  async function triggerSyncCycle() {
    const storage = await getStorage();

    // Skip if paused or not paired
    if (storage.isPaused || !storage.deviceToken || !storage.deviceId) {
      return;
    }

    // Flush any pending buffered payloads from offline queue
    if (storage.offlineQueue && storage.offlineQueue.length > 0) {
      const queueToFlush = [...storage.offlineQueue];
      for (const bufferedPayload of queueToFlush) {
        await sendIngest(bufferedPayload, storage);
      }
    }

    // Try finding open portal tabs first (simplewallet or egpayment)
    const portalTabs = await chrome.tabs.query({
      url: [
        '*://simplewallet.in/*',
        '*://*.simplewallet.in/*',
        '*://egpayment.com/*',
        '*://*.egpayment.com/*',
        '*://localhost/*',
      ],
    });

    // Sync all open portal tabs (simplewallet and egpayment)
    let parsedAnyTab = false;
    for (const tab of portalTabs) {
      if (tab.id) {
        try {
          const response = await chrome.tabs.sendMessage(tab.id, {
            type: 'TRIGGER_PARSE',
            refresh: storage.keepAliveMode === 'reload',
          });
          if (response && response.result) {
            await handleParseResult(response.result, storage);
            parsedAnyTab = true;
          }
        } catch {
          // Tab might not be loaded yet or inactive
        }
      }
    }

    if (parsedAnyTab) {
      triggerRechargeDispatcherCycle();
      return;
    }

    // Fallback: fetch directly if credentials allowed (not simplewallet which requires ASP.NET postback)
    if (storage.portalUrl && !storage.portalUrl.includes('simplewallet.in')) {
      try {
        const res = await fetch(storage.portalUrl, { credentials: 'same-origin' });
        if (res.ok) {
          const html = await res.text();
          const parseResult = parse(html);
          await handleParseResult(parseResult, storage);
        } else if (res.status === 401 || res.status === 403) {
          await handleLoggedOut(storage);
        }
      } catch {
        // Browser or portal offline
        await setStorage({ status: 'offline', errorMessage: 'Portal or internet unreachable' });
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
      }
    }

    triggerRechargeDispatcherCycle();
  }

  // 3. Handle parser results (Fail Closed: send nothing if not ok)
  async function handleParseResult(result: ParseResult, storage: StorageData) {
    if (!result.ok) {
      // Fail closed: update status and send nothing
      await setStorage({
        status: result.reason,
        errorMessage: result.detail || `Parser detected: ${result.reason}`,
      });

      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });

      if (result.reason === 'logged_out') {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: '/icon/128.png',
          title: 'WalletSync Logged Out',
          message: 'Your simplewallet portal session has expired. Please log back in.',
        });
      }
      return;
    }

    // If parser returned ok: prepare IngestRequest
    const ingestPayload: IngestRequest = {
      schemaVersion: SCHEMA_VERSION,
      deviceId: storage.deviceId!,
      parserVersion: result.parserVersion,
      capturedAt: result.capturedAt,
      balancePaise: result.balancePaise,
      pageTotals: result.pageTotals,
      rows: result.rows,
    };

    await sendIngest(ingestPayload, storage);
  }

  async function handleLoggedOut(_storage: StorageData) {
    await setStorage({ status: 'logged_out', errorMessage: 'Session expired' });
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '/icon/128.png',
      title: 'WalletSync Logged Out',
      message: 'Please log in to your portal to resume transaction sync.',
    });
  }

  // 4. Send payload to API with offline buffer handling
  async function sendIngest(payload: IngestRequest, storage: StorageData) {
    try {
      const res = await fetch(`${storage.apiUrl}/api/v1/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${storage.deviceToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.status === 200) {
        // Success: update stats & clear badge
        chrome.action.setBadgeText({ text: '' });

        // Calculate today stats
        const totalAmount = payload.rows.reduce((sum, r) => sum + r.amountPaise, 0);
        const source = payload.rows[0]?.source || 'simplewallet';
        const nowIso = new Date().toISOString();

        const recentRows = payload.rows.slice(0, 6).map((r) => {
          const rawDigits = r.customerNo.replace(/\D/g, '');
          const last4 = rawDigits.slice(-4) || '0000';
          const masked = rawDigits.length >= 6
            ? `${rawDigits.slice(0, 2)}••••${last4}`
            : `••••${last4}`;

          return {
            txnId: r.txnId,
            source: r.source,
            service: r.service,
            serviceName: r.serviceName,
            customerLast4: last4,
            customerMasked: masked,
            amountPaise: r.amountPaise,
            status: r.status,
            occurredAt: r.occurredAt,
          };
        });

        const existingTxns = storage.recentTransactions || [];
        const getKey = (item: { source?: string; txnId: string }) => `${item.source || 'simplewallet'}_${item.txnId}`;
        const txnMap = new Map(existingTxns.map((t) => [getKey(t), t]));
        for (const r of recentRows) {
          txnMap.set(getKey(r), r);
        }
        const mergedRecent = Array.from(txnMap.values()).sort((a, b) => {
          const tA = new Date(a.occurredAt).getTime();
          const tB = new Date(b.occurredAt).getTime();
          return (isNaN(tB) ? 0 : tB) - (isNaN(tA) ? 0 : tA);
        }).slice(0, 20);

        const swCount = source === 'simplewallet' ? payload.rows.length : storage.simplewalletCount || 0;
        const egCount = source === 'egpayment' ? payload.rows.length : storage.egpaymentCount || 0;

        const patch: Partial<StorageData> = {
          status: 'ok',
          errorMessage: null,
          lastSyncTime: nowIso,
          todayCount: swCount + egCount,
          todayAmountPaise: totalAmount,
          recentTransactions: mergedRecent,
          offlineQueue: [], // clear offline queue on successful ingest
        };

        if (source === 'simplewallet') {
          patch.simplewalletLastSync = nowIso;
          patch.simplewalletCount = payload.rows.length;
        } else if (source === 'egpayment') {
          patch.egpaymentLastSync = nowIso;
          patch.egpaymentCount = payload.rows.length;
        }

        await setStorage(patch);
      } else if (res.status === 401) {
        // Token revoked
        await setStorage({
          deviceId: null,
          deviceToken: null,
          status: 'logged_out',
          errorMessage: 'Device token revoked. Please reconnect.',
        });
        chrome.action.setBadgeText({ text: '!' });
      } else if (res.status === 409) {
        // Incompatible schema version
        chrome.notifications.create({
          type: 'basic',
          iconUrl: '/icon/128.png',
          title: 'WalletSync Update Needed',
          message: 'A newer version of the extension is required by the server.',
        });
      } else {
        // API error: buffer into offline queue
        enqueueOffline(payload, storage);
      }
    } catch {
      // Network failure: enqueue payload
      enqueueOffline(payload, storage);
    }
  }

  async function enqueueOffline(payload: IngestRequest, storage: StorageData) {
    const queue = [...storage.offlineQueue];
    // Keep max 50 payloads, de-duplicate
    if (queue.length >= 50) queue.shift();
    queue.push(payload);
    await setStorage({
      status: 'offline',
      errorMessage: 'API offline. Payload buffered.',
      offlineQueue: queue,
    });
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
  }

  // 5. Message listener from Popup, Options & Content scripts
  chrome.runtime.onMessage.addListener(
    (
      rawMessage: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (res?: unknown) => void,
    ) => {
      // Validate sender identity, tab origin, and payload schema before processing
      const validation = validateBackgroundMessage(rawMessage, sender, chrome.runtime.id);
      if (!validation.ok) {
        // Unknown or malformed messages are dropped without side effects and without logging payload contents
        return;
      }

      const message = validation.message;

      if (message.type === 'CONTENT_PARSED_PAGE') {
        getStorage().then(async (storage) => {
          if (!storage.isPaused && storage.deviceToken && storage.deviceId) {
            await handleParseResult(message.result, storage);
          }
        });
        return true;
      }

      if (message.type === 'CONTENT_PARSER_ERROR') {
        // Content script parser error acknowledged; dropped without logging sensitive payload
        return;
      }

      if (message.type === 'PAIR_DEVICE') {
        handlePairing(message.code, message.apiUrl).then(sendResponse);
        return true;
      }

      if (message.type === 'UNPAIR_DEVICE') {
        setStorage({
          deviceId: null,
          deviceToken: null,
          status: 'logged_out',
          errorMessage: null,
        }).then(() => {
          chrome.action.setBadgeText({ text: '!' });
          chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
          sendResponse({ success: true });
        });
        return true;
      }

      if (message.type === 'SYNC_NOW') {
        Promise.all([
          triggerSyncCycle(),
          triggerRechargeDispatcherCycle(),
        ]).then(() => sendResponse({ success: true }));
        return true;
      }

      if (message.type === 'PORTAL_RECHARGE_RESULT') {
        getStorage().then(async (storage) => {
          if (storage.deviceToken) {
            await sendRechargeStatusUpdate(storage, message.orderId, {
              status: message.status,
              failureCode: message.failureCode,
              failureDetail: message.failureDetail,
            });
          }
          if (sender.tab?.id) {
            await closeDedicatedTab(sender.tab.id);
          }
          // After completing one order, immediately check for consecutive queued orders
          setTimeout(() => {
            triggerRechargeDispatcherCycle();
          }, 1000);
        });
        return true;
      }

      if (message.type === 'TOGGLE_PAUSE') {
        getStorage().then(async (storage) => {
          const isPaused = !storage.isPaused;
          await setStorage({ isPaused, status: isPaused ? 'paused' : 'ok' });
          if (isPaused) {
            chrome.action.setBadgeText({ text: '❚❚' });
            chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
          } else {
            chrome.action.setBadgeText({ text: '' });
            triggerSyncCycle();
          }
          sendResponse({ success: true, isPaused });
        });
        return true;
      }
    },
  );

  // -------------------------------------------------------------------------
  // 6. Recharge Dispatcher Engine (Milestone R3)
  // -------------------------------------------------------------------------
  let isRechargeDispatcherBusy = false;

  async function sendMessageWithRetry(
    tabId: number,
    message: unknown,
    maxAttempts = 6,
    delayMs = 500,
  ): Promise<unknown> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await chrome.tabs.sendMessage(tabId, message);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    throw lastError;
  }

  async function triggerRechargeDispatcherCycle() {
    if (isRechargeDispatcherBusy) return;

    const storage = await getStorage();
    if (storage.isPaused || !storage.deviceToken || !storage.deviceId) {
      return;
    }

    isRechargeDispatcherBusy = true;
    try {
      const claimRes = await fetch(`${storage.apiUrl}/api/v1/recharge-orders/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${storage.deviceToken}`,
        },
      });

      if (!claimRes.ok) return;

      const data = await claimRes.json();
      if (!data.order) return; // No orders in queue

      const order = data.order;
      const targetUrl =
        order.source === 'egpayment'
          ? 'https://egpayment.com/users/recharge'
          : 'https://simplewallet.in/web/MobileRecharge.aspx';

      // 1. Open dedicated background tab (guaranteed active: false; never interrupts working tab)
      const { tabId } = await openDedicatedBackgroundTab(targetUrl);

      // 2. Lock order on server to 'submitting' (prevents re-leasing)
      await sendRechargeStatusUpdate(storage, order.id, { status: 'submitting' });

      // 3. Dispatch execution command to content script in dedicated background tab with retry backoff
      try {
        await sendMessageWithRetry(
          tabId,
          {
            type: 'EXECUTE_PORTAL_RECHARGE',
            order,
          },
          6,
          500,
        );
      } catch (err: unknown) {
        // Communication failed after all attempts; record failure and close tab
        const errDetail = err instanceof Error ? err.message : 'Timeout waiting for content script';
        await sendRechargeStatusUpdate(storage, order.id, {
          status: 'failed',
          failureCode: 'tab_dispatch_error',
          failureDetail: `Failed to communicate with recharge content script in background tab: ${errDetail.slice(0, 100)}`,
        });
        await closeDedicatedTab(tabId);
      }
    } catch {
      // Ignore background dispatch errors
    } finally {
      isRechargeDispatcherBusy = false;
    }
  }

  async function sendRechargeStatusUpdate(
    storage: StorageData,
    orderId: string,
    payload: {
      status: string;
      failureCode?: string;
      failureDetail?: string;
    },
  ) {
    try {
      await fetch(`${storage.apiUrl}/api/v1/recharge-orders/${orderId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${storage.deviceToken}`,
        },
        body: JSON.stringify(payload),
      });
    } catch {
      // Ignore network errors updating status
    }
  }

  async function sendHeartbeat() {
    try {
      const storage = await getStorage();
      if (!storage.deviceToken || !storage.deviceId) {
        return;
      }
      const apiUrl = (storage.apiUrl || '').trim().replace(/\/+$/, '');
      if (!apiUrl) return;

      let portal: 'simplewallet' | 'egpayment' | null = null;
      try {
        const swTabs = await chrome.tabs.query({
          url: ['*://simplewallet.in/*', '*://*.simplewallet.in/*'],
        });
        const egTabs = await chrome.tabs.query({
          url: ['*://egpayment.com/*', '*://*.egpayment.com/*'],
        });
        if (swTabs.length > 0) portal = 'simplewallet';
        else if (egTabs.length > 0) portal = 'egpayment';
        else if (storage.portalUrl?.includes('simplewallet')) portal = 'simplewallet';
        else if (storage.portalUrl?.includes('egpayment')) portal = 'egpayment';
      } catch {
        if (storage.portalUrl?.includes('egpayment')) portal = 'egpayment';
        else portal = 'simplewallet';
      }

      const portalLoggedIn = storage.status !== 'logged_out';
      const manifest = chrome.runtime.getManifest();

      const payload = {
        extensionVersion: manifest.version || '0.1.0',
        portal,
        portalLoggedIn,
        lastSyncAt: storage.lastSyncTime || null,
        errorCategory: storage.status !== 'ok' ? storage.status : null,
      };

      await fetch(`${apiUrl}/api/v1/devices/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${storage.deviceToken}`,
        },
        body: JSON.stringify(payload),
      });

      // Automatically dispatch pending recharge orders on every heartbeat tick
      triggerRechargeDispatcherCycle();
    } catch {
      // Handle failures silently without retry storms
    }
  }

  async function handlePairing(code: string, customApiUrl?: string) {
    const storage = await getStorage();
    const apiUrl = (customApiUrl || storage.apiUrl || '').trim().replace(/\/+$/, '');
    const cleanCode = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

    let res: Response;
    try {
      res = await fetch(`${apiUrl}/api/v1/devices/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: cleanCode }),
      });
    } catch {
      // (a) Network failure
      return {
        success: false,
        error: `Network error: cannot reach backend server at ${apiUrl || 'empty URL'}. Check host permissions and connectivity.`,
      };
    }

    let data: Record<string, any>;
    try {
      data = await res.json();
    } catch {
      // (b) Non-JSON response
      return {
        success: false,
        error: `Server replied ${res.status}: non-JSON response received.`,
      };
    }

    if (res.status === 201 && data.deviceToken && data.deviceId) {
      await setStorage({
        deviceId: data.deviceId,
        deviceToken: data.deviceToken,
        apiUrl,
        status: 'ok',
        errorMessage: null,
      });
      chrome.action.setBadgeText({ text: '' });
      // Immediately trigger first sync & heartbeat
      triggerSyncCycle();
      sendHeartbeat();
      return { success: true };
    }

    // (c) Server error with message
    const errorMsg = data?.error || data?.message || 'Failed to pair device';
    return {
      success: false,
      error: `Server replied ${res.status}: ${errorMsg}`,
    };
  }
});
