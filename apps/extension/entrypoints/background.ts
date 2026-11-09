import { defineBackground } from 'wxt/sandbox';
import {
  getStorage,
  setStorage,
  type StorageData,
} from '../lib/storage';
import {
  openDedicatedBackgroundTab,
  closeDedicatedTab,
  waitForTabComplete,
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

  // Active fast polling (every 1.2s) for instant background recharge order execution
  let fastPollInterval: ReturnType<typeof setInterval> | null = null;
  function startFastPolling() {
    if (fastPollInterval) clearInterval(fastPollInterval);
    fastPollInterval = setInterval(() => {
      triggerRechargeDispatcherCycle();
    }, 1200);
  }
  startFastPolling();

  chrome.tabs.onActivated.addListener(() => {
    triggerRechargeDispatcherCycle();
  });

  chrome.runtime.onInstalled.addListener(() => {
    setupAlarms();
    startFastPolling();
  });

  if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
      setupAlarms();
      startFastPolling();
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
    const portalTabs = (await chrome.tabs.query({
      url: [
        'https://simplewallet.in/*',
        'https://egpayment.com/*',
      ],
    }).catch(() => [])) as chrome.tabs.Tab[];

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
      commissionPaise: result.commissionPaise ?? null,
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

  // Dedicated tabs opened by background dispatcher (never closes user working tabs)
  const dedicatedTabIds = new Set<number>();

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

      if (message.type === 'DISPATCH_RECHARGE_NOW') {
        triggerRechargeDispatcherCycle().then(sendResponse);
        return true;
      }

      if (message.type === 'PORTAL_RECHARGE_RESULT') {
        getStorage().then(async (storage) => {
          if (storage.deviceToken) {
            await sendRechargeStatusUpdate(storage, message.orderId, {
              status: message.status,
              failureCode: message.failureCode,
              failureDetail: message.failureDetail,
              qrDataUrl: message.qrDataUrl,
              qrAmount: message.qrAmount,
              qrTimer: message.qrTimer,
            });
          }
          if (message.failureCode === 'logged_out') {
            try {
              chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon/128.png',
                title: 'WalletSync - SimpleWallet Login Required',
                message: 'SimpleWallet official portal is not logged in. Please log in to complete your recharge.',
              });
            } catch {
              // ignore
            }
            await setStorage({
              status: 'logged_out',
              errorMessage: 'Official portal session expired or not logged in',
            });
          }
          // After completing one order, immediately check for consecutive queued orders
          setTimeout(() => {
            triggerRechargeDispatcherCycle();
          }, 400);
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

      if (message.type === 'LOOKUP_OPERATOR_ON_PORTAL') {
        const portal = message.portal || 'egpayment';
        const targetUrl =
          portal === 'egpayment'
            ? 'https://egpayment.com/users/recharge'
            : 'https://simplewallet.in/web/MobileRecharge.aspx?mID=822&PID=821';
        const targetUrlPattern =
          portal === 'egpayment' ? 'https://egpayment.com/*' : 'https://simplewallet.in/*';

        (async () => {
          try {
            console.log(`[WalletSync Operator Lookup] Starting portal lookup for mobile: ${message.mobile} on ${portal}`);

            // 1. Locate existing portal tab or open in background
            const tabs = (await chrome.tabs.query({ url: targetUrlPattern }).catch(() => [])) as chrome.tabs.Tab[];
            let targetTabId: number;

            const existingRechargeTab = tabs.find((t) => (t.url || '').toLowerCase().includes('/users/recharge'));
            if (existingRechargeTab && existingRechargeTab.id) {
              targetTabId = existingRechargeTab.id;
              console.log(`[WalletSync Operator Lookup] Using existing portal tab ${targetTabId} (URL: ${existingRechargeTab.url})`);
            } else if (tabs.length > 0 && tabs[0]?.id) {
              targetTabId = tabs[0].id;
              const curUrl = (tabs[0].url || '').toLowerCase();
              if (portal === 'egpayment' && !curUrl.includes('/users/recharge')) {
                console.log(`[WalletSync Operator Lookup] Navigating existing EG Payment tab ${targetTabId} to ${targetUrl}`);
                await chrome.tabs.update(targetTabId, { url: targetUrl });
                await waitForTabComplete(targetTabId, 15000);
              } else {
                console.log(`[WalletSync Operator Lookup] Using existing portal tab ${targetTabId} (URL: ${curUrl})`);
              }
            } else {
              // Open new tab in background: active: false
              console.log(`[WalletSync Operator Lookup] Opening dedicated background portal tab: ${targetUrl}`);
              const newTab = await chrome.tabs.create({ url: targetUrl, active: false });
              if (!newTab.id) throw new Error('Failed to create background tab');
              targetTabId = newTab.id;
              await waitForTabComplete(targetTabId, 15000);
            }

            // Brief pause for page interactivity
            await new Promise((r) => setTimeout(r, 350));

            // 2. Direct script execution in tab for guaranteed, instant DOM interaction
            let result: { ok: boolean; operator?: string; circle?: string; error?: string } | null = null;
            if (chrome.scripting && chrome.scripting.executeScript) {
              try {
                const execResults = await chrome.scripting.executeScript({
                  target: { tabId: targetTabId },
                  args: [message.mobile],
                  func: async (mobileNo: string) => {
                    function findInput(): HTMLInputElement | null {
                      const byPh = document.querySelector<HTMLInputElement>(
                        'input[placeholder*="Enter Mobile" i], input[placeholder*="Mobile Number" i], input[placeholder*="Mobile" i]'
                      );
                      if (byPh) return byPh;

                      const byIdOrName = (document.getElementById('mobile') as HTMLInputElement | null) ||
                        document.querySelector<HTMLInputElement>('input[name="mobile"], input[name*="mobile" i], input[type="tel"]');
                      if (byIdOrName) return byIdOrName;

                      // Deep search inside ion-input or shadow roots
                      const customEls = Array.from(document.querySelectorAll('ion-input, ion-item, div'));
                      for (const el of customEls) {
                        if (el.shadowRoot) {
                          const shadow = el.shadowRoot.querySelector<HTMLInputElement>('input.native-input, input[placeholder*="Mobile" i], input');
                          if (shadow) return shadow;
                        }
                        const inner = el.querySelector<HTMLInputElement>('input.native-input, input[type="tel"], input[type="number"]');
                        if (inner && (inner.placeholder?.toLowerCase().includes('mobile') || inner.name?.toLowerCase().includes('mobile') || inner.id?.toLowerCase().includes('mobile'))) {
                          return inner;
                        }
                      }

                      return document.querySelector<HTMLInputElement>('input[type="tel"], input[type="number"]');
                    }

                    let input = findInput();
                    for (let i = 0; i < 30; i++) {
                      input = findInput();
                      if (input) break;
                      await new Promise((r) => setTimeout(r, 100));
                    }

                    if (!input) {
                      return { ok: false, error: 'Mobile input element not found' };
                    }

                    input.focus();
                    input.value = '';
                    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

                    try {
                      const nativeSetter = Object.getOwnPropertyDescriptor(
                        window.HTMLInputElement.prototype,
                        'value'
                      )?.set;
                      if (nativeSetter) {
                        nativeSetter.call(input, mobileNo);
                      } else {
                        input.value = mobileNo;
                      }
                    } catch {
                      input.value = mobileNo;
                    }

                    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                    for (const char of mobileNo) {
                      const code = `Digit${char}`;
                      const keyCode = 48 + parseInt(char, 10);
                      input.dispatchEvent(new KeyboardEvent('keydown', { key: char, code, keyCode, which: keyCode, bubbles: true, composed: true }));
                      input.dispatchEvent(new KeyboardEvent('keypress', { key: char, code, keyCode, which: keyCode, bubbles: true, composed: true }));
                      input.dispatchEvent(new KeyboardEvent('keyup', { key: char, code, keyCode, which: keyCode, bubbles: true, composed: true }));
                    }
                    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                    input.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));

                    // Trigger jQuery if present
                    try {
                      const $ = (window as any).$ || (window as any).jQuery;
                      if ($) {
                        $(input).val(mobileNo).trigger('input').trigger('change').trigger('keyup');
                      }
                    } catch {
                      // ignore
                    }

                    // Trigger Ionic if parent exists
                    try {
                      const ionParent = input.closest('ion-input') || (input.getRootNode && (input.getRootNode() as any).host);
                      if (ionParent) {
                        (ionParent as any).value = mobileNo;
                        ionParent.dispatchEvent(new CustomEvent('ionInput', { detail: { value: mobileNo }, bubbles: true, composed: true }));
                        ionParent.dispatchEvent(new CustomEvent('ionChange', { detail: { value: mobileNo }, bubbles: true, composed: true }));
                      }
                    } catch {
                      // ignore
                    }

                    function readDetails(): { operator?: string; circle?: string } {
                      let operator: string | undefined;
                      let circle: string | undefined;

                      const opSelect = document.querySelector<HTMLSelectElement>(
                        'select#operator, select[name="operator"], select[name*="operator" i], select#op, select[name="op"]'
                      );
                      if (opSelect) {
                        const opt = opSelect.options[opSelect.selectedIndex];
                        const txt = (opt?.text || '').trim();
                        const val = (opSelect.value || '').trim();
                        if (txt && !/select\s*operator/i.test(txt) && val !== '' && val !== '0') {
                          operator = txt;
                        }
                      }

                      if (!operator) {
                        const opInput = document.querySelector<HTMLInputElement>(
                          'input#operator, input[name="operator"], input[name*="operator" i], input#operator_name, input[name="operator_name"], input[placeholder*="Operator" i]'
                        );
                        if (opInput && opInput.value && !/select\s*operator/i.test(opInput.value)) {
                          operator = opInput.value.trim();
                        }
                      }

                      if (!operator) {
                        const all = Array.from(document.querySelectorAll('label, div, p, span, h5, h6, strong'));
                        for (const el of all) {
                          const txt = (el.textContent || '').trim().toLowerCase();
                          if (txt === 'operator' || txt.startsWith('operator')) {
                            const parent = el.closest('.form-group, .mb-3, .col-md-6, div') || el.parentElement;
                            const cand = parent?.querySelector(
                              '.select2-selection__rendered, .chosen-single, .dropdown-toggle, input, select, .form-control, p, span'
                            ) || el.nextElementSibling;
                            const val = ((cand as HTMLInputElement)?.value || cand?.textContent || '').trim();
                            if (val && !/select\s*operator/i.test(val) && val.length < 50) {
                              operator = val;
                              break;
                            }
                          }
                        }
                      }

                      const circSelect = document.querySelector<HTMLSelectElement>(
                        'select#circle, select[name="circle"], select[name*="circle" i]'
                      );
                      if (circSelect) {
                        const opt = circSelect.options[circSelect.selectedIndex];
                        const txt = (opt?.text || '').trim();
                        const val = (circSelect.value || '').trim();
                        if (txt && !/select\s*circle/i.test(txt) && val !== '' && val !== '0') {
                          circle = txt;
                        }
                      }

                      if (!circle) {
                        const circInput = document.querySelector<HTMLInputElement>(
                          'input#circle, input[name="circle"], input[name*="circle" i], input#circle_name, input[name="circle_name"], input[placeholder*="Circle" i]'
                        );
                        if (circInput && circInput.value && !/select\s*circle/i.test(circInput.value)) {
                          circle = circInput.value.trim();
                        }
                      }

                      if (!circle) {
                        const all = Array.from(document.querySelectorAll('label, div, p, span, h5, h6, strong'));
                        for (const el of all) {
                          const txt = (el.textContent || '').trim().toLowerCase();
                          if (txt === 'circle' || txt.startsWith('circle')) {
                            const parent = el.closest('.form-group, .mb-3, .col-md-6, div') || el.parentElement;
                            const cand = parent?.querySelector(
                              '.select2-selection__rendered, .chosen-single, .dropdown-toggle, input, select, .form-control, p, span'
                            ) || el.nextElementSibling;
                            const val = ((cand as HTMLInputElement)?.value || cand?.textContent || '').trim();
                            if (val && !/select\s*circle/i.test(val) && val.length < 50) {
                              circle = val;
                              break;
                            }
                          }
                        }
                      }

                      return { operator, circle };
                    }

                    const startTime = Date.now();
                    let d = readDetails();
                    while (Date.now() - startTime < 4500) {
                      d = readDetails();
                      if (d.operator && !/select\s*operator/i.test(d.operator)) {
                        break;
                      }
                      await new Promise((r) => setTimeout(r, 80));
                    }

                    return {
                      ok: Boolean(d.operator && !/select\s*operator/i.test(d.operator)),
                      operator: d.operator,
                      circle: d.circle,
                      source: 'portal_live',
                    };
                  },
                });

                if (execResults && execResults[0]?.result) {
                  result = execResults[0].result as any;
                  console.log('[WalletSync Operator Lookup] Direct executeScript result:', result);
                }
              } catch (execErr) {
                console.warn('[WalletSync Operator Lookup] executeScript failed, falling back to sendMessage:', execErr);
              }
            }

            // Fallback to tabs.sendMessage if executeScript did not return
            if (!result || !result.ok) {
              await ensureRechargeContentScriptInjected(targetTabId).catch(() => {});
              for (let attempt = 0; attempt < 3; attempt++) {
                try {
                  result = await chrome.tabs.sendMessage(targetTabId, {
                    type: 'QUERY_PORTAL_OPERATOR',
                    mobile: message.mobile,
                  });
                  if (result && result.ok) break;
                } catch {
                  // ignore
                }
                await new Promise((r) => setTimeout(r, 300));
              }
            }

            console.log('[WalletSync Operator Lookup] Final result:', result);
            sendResponse(result || { ok: false, error: 'Query timed out' });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Lookup failed';
            console.error('[WalletSync Operator Lookup] Exception:', msg);
            sendResponse({ ok: false, error: msg });
          }
        })();
        return true;
      }
    },
  );

  // -------------------------------------------------------------------------
  // 6. Recharge Dispatcher Engine (Milestone R3)
  // -------------------------------------------------------------------------
  let isRechargeDispatcherBusy = false;

  async function ensureRechargeContentScriptInjected(tabId: number): Promise<void> {
    try {
      if (chrome.scripting && chrome.scripting.executeScript) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content-scripts/recharge.js'],
        });
        console.log(`[WalletSync Recharge Dispatcher] Programmatically ensured recharge.js injected in tab ${tabId}`);
      }
    } catch (err) {
      console.warn(`[WalletSync Recharge Dispatcher] Could not programmatically inject recharge.js into tab ${tabId}:`, err);
    }
  }

  async function sendMessageWithRetry(
    tabId: number,
    message: unknown,
    maxAttempts = 10,
    delayMs = 600,
  ): Promise<unknown> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await chrome.tabs.sendMessage(tabId, message);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(
          `[WalletSync Recharge Dispatcher] sendMessage attempt ${attempt}/${maxAttempts} failed:`,
          lastError.message,
        );

        // If content script was disconnected (e.g. extension reload), inject script programmatically
        if (
          attempt === 1 ||
          lastError.message.includes('Receiving end does not exist') ||
          lastError.message.includes('Could not establish connection')
        ) {
          await ensureRechargeContentScriptInjected(tabId);
          await new Promise((resolve) => setTimeout(resolve, 300));
        }

        // On attempt 4, reload the tab to ensure a fresh, connected document context
        if (attempt === 4) {
          try {
            console.log(`[WalletSync Recharge Dispatcher] Reloading tab ${tabId} to refresh script environment...`);
            await chrome.tabs.reload(tabId);
            await waitForTabComplete(tabId);
            await new Promise((resolve) => setTimeout(resolve, 500));
          } catch {
            // ignore reload failure
          }
        }

        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    throw lastError;
  }

  async function triggerRechargeDispatcherCycle(): Promise<{
    success: boolean;
    message: string;
    orderId?: string;
  }> {
    if (isRechargeDispatcherBusy) {
      return { success: false, message: 'Recharge dispatcher is already busy processing an order' };
    }

    const storage = await getStorage();
    if (!storage.deviceToken || !storage.deviceId) {
      console.warn('[WalletSync Recharge Dispatcher] Device not paired with dashboard');
      return { success: false, message: 'Device not paired with dashboard' };
    }

    if (storage.isPaused) {
      console.warn('[WalletSync Recharge Dispatcher] Extension is paused');
      return { success: false, message: 'Extension is currently paused' };
    }

    const apiUrl = (storage.apiUrl || '').trim().replace(/\/+$/, '');
    if (!apiUrl) {
      console.error('[WalletSync Recharge Dispatcher] Missing apiUrl in storage');
      return { success: false, message: 'Missing API URL configuration' };
    }

    isRechargeDispatcherBusy = true;
    try {
      // Check lingering in-flight active order across MV3 service worker restarts
      try {
        const res = await chrome.storage.local.get(['activeRechargeOrder']);
        const active = res?.activeRechargeOrder as { id?: string; dispatchedAt?: number } | undefined;
        if (active && active.id && storage.deviceToken) {
          const elapsedMs = Date.now() - (active.dispatchedAt || 0);
          if (elapsedMs > 12000) {
            console.log(`[WalletSync Recharge Dispatcher] Lingering in-flight order ${active.id} (elapsed ${elapsedMs}ms): transitioning to submitted`);
            await chrome.storage.local.remove('activeRechargeOrder');
            await sendRechargeStatusUpdate(storage, active.id, { status: 'submitted' });
          }
        }
      } catch {
        // ignore
      }

      console.log(`[WalletSync Recharge Dispatcher] Calling ${apiUrl}/api/v1/recharge-orders/claim ...`);
      const claimRes = await fetch(`${apiUrl}/api/v1/recharge-orders/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${storage.deviceToken}`,
        },
      });

      if (!claimRes.ok) {
        const errText = await claimRes.text().catch(() => '');
        console.error(`[WalletSync Recharge Dispatcher] Claim failed HTTP ${claimRes.status}:`, errText);
        await setStorage({
          lastRechargeLog: {
            time: new Date().toISOString(),
            ok: false,
            message: `Claim failed: HTTP ${claimRes.status}`,
          },
        });
        return { success: false, message: `Server error HTTP ${claimRes.status}` };
      }

      const data = await claimRes.json();
      if (!data.order) {
        console.log('[WalletSync Recharge Dispatcher] No orders queued on server');
        await setStorage({
          lastRechargeLog: {
            time: new Date().toISOString(),
            ok: true,
            message: 'Queue empty — 0 pending orders',
          },
        });
        return { success: true, message: 'No orders queued in server' };
      }

      const order = data.order;
      console.log(`[WalletSync Recharge Dispatcher] Order claimed! ID: ${order.id}, portal: ${order.source}, operator: ${order.operator}, amount: ₹${order.amountPaise / 100}`);

      const targetUrl =
        order.source === 'egpayment'
          ? 'https://egpayment.com/users/recharge'
          : 'https://simplewallet.in/web/MobileRecharge.aspx?mID=822&PID=821';

      // 1. Locate or open portal tab (always in background: never steal user focus or switch tabs)
      let tabId: number;
      if (order.source === 'simplewallet') {
        const swTabs = (await chrome.tabs.query({ url: 'https://simplewallet.in/*' }).catch(() => [])) as chrome.tabs.Tab[];
        if (swTabs.length > 0 && swTabs[0]?.id) {
          tabId = swTabs[0].id;
          console.log(`[WalletSync Recharge Dispatcher] Using existing SimpleWallet tab ${tabId} in background (no tab switch)`);
          const curUrl = (swTabs[0].url || '').toLowerCase();
          if (!curUrl.includes('mobilerecharge.aspx')) {
            console.log(`[WalletSync Recharge Dispatcher] Navigating background tab ${tabId} to ${targetUrl}`);
            await chrome.tabs.update(tabId, { url: targetUrl });
            await waitForTabComplete(tabId);
          }
        } else {
          console.log(`[WalletSync Recharge Dispatcher] Opening SimpleWallet background tab: ${targetUrl}`);
          const newTab = await chrome.tabs.create({ url: targetUrl, active: false });
          if (!newTab.id) throw new Error('Failed to create tab');
          tabId = newTab.id;
          await waitForTabComplete(tabId);
        }
      } else {
        const egTabs = (await chrome.tabs.query({ url: 'https://egpayment.com/*' }).catch(() => [])) as chrome.tabs.Tab[];
        const rechargeTab = egTabs.find((t) => (t.url || '').toLowerCase().includes('/users/recharge'));
        if (rechargeTab && rechargeTab.id) {
          tabId = rechargeTab.id;
          console.log(`[WalletSync Recharge Dispatcher] Using existing EG Payment recharge tab ${tabId} (URL: ${rechargeTab.url})`);
        } else if (egTabs.length > 0 && egTabs[0]?.id) {
          tabId = egTabs[0].id;
          const curUrl = (egTabs[0].url || '').toLowerCase();
          if (!curUrl.includes('/users/recharge')) {
            console.log(`[WalletSync Recharge Dispatcher] Navigating background EG Payment tab ${tabId} to ${targetUrl}`);
            await chrome.tabs.update(tabId, { url: targetUrl });
            await waitForTabComplete(tabId);
          } else {
            console.log(`[WalletSync Recharge Dispatcher] Using existing EG Payment tab ${tabId} (URL: ${curUrl})`);
          }
        } else {
          console.log(`[WalletSync Recharge Dispatcher] Opening new EG Payment background tab: ${targetUrl}`);
          const newTab = await chrome.tabs.create({ url: targetUrl, active: false });
          if (!newTab.id) throw new Error('Failed to create EG tab');
          tabId = newTab.id;
          await waitForTabComplete(tabId);
        }
      }

      // Check if tab is on login page (portal logged out guard)
      try {
        const tabInfo = await chrome.tabs.get(tabId);
        const curUrl = (tabInfo.url || '').toLowerCase();
        if (
          curUrl.includes('/login') ||
          curUrl.includes('/users/login') ||
          curUrl.includes('/default.aspx') ||
          (curUrl.includes('/logout') && !curUrl.includes('/recharge'))
        ) {
          console.warn('[WalletSync Recharge Dispatcher] Portal redirected to login page:', curUrl);
          await sendRechargeStatusUpdate(storage, order.id, {
            status: 'failed',
            failureCode: 'logged_out',
            failureDetail: `Official portal not logged in: redirected to ${curUrl}`,
          });
          try {
            chrome.notifications.create({
              type: 'basic',
              iconUrl: 'icon/128.png',
              title: 'WalletSync - SimpleWallet Login Required',
              message: 'SimpleWallet official portal is not logged in. Please log into the portal to execute recharge orders.',
            });
          } catch {
            // ignore
          }
          await setStorage({
            status: 'logged_out',
            errorMessage: 'SimpleWallet portal is logged out',
            lastRechargeLog: {
              time: new Date().toISOString(),
              ok: false,
              message: 'Portal not logged in — please log in to SimpleWallet',
            },
          });
          return { success: false, message: 'Portal not logged in' };
        }
      } catch {
        // ignore tab check error
      }

      // 2. Lock order on server to 'submitting' (prevents re-leasing)
      await sendRechargeStatusUpdate(storage, order.id, { status: 'submitting' });

      // 3. Ensure content script is actively injected in tab before messaging
      await ensureRechargeContentScriptInjected(tabId);

      // 4. Dispatch execution command to content script in dedicated background tab with retry backoff
      try {
        await chrome.storage.local.set({
          activeRechargeOrder: {
            id: order.id,
            customerNo: order.customerNo,
            amountPaise: order.amountPaise,
            operator: order.operator,
            dispatchedAt: Date.now(),
          },
        });
        console.log(`[WalletSync Recharge Dispatcher] Dispatching EXECUTE_PORTAL_RECHARGE to tab ${tabId}...`);
        await sendMessageWithRetry(
          tabId,
          {
            type: 'EXECUTE_PORTAL_RECHARGE',
            order,
          },
          8,
          600,
        );

        await setStorage({
          lastRechargeLog: {
            time: new Date().toISOString(),
            ok: true,
            message: `Submitted order for ${order.operator} (₹${(order.amountPaise / 100).toFixed(0)}) to ${order.source}`,
          },
        });

        // In-flight safety timeout: if content script was unloaded by portal form postback
        // and did not report within 18s, transition order to 'submitted' so it awaits reconciliation
        setTimeout(async () => {
          try {
            const currentStorage = await getStorage();
            const res = await chrome.storage.local.get(['activeRechargeOrder']);
            const active = res?.activeRechargeOrder as { id?: string } | undefined;
            if (active && active.id === order.id && currentStorage.deviceToken) {
              console.log(`[WalletSync Recharge Dispatcher] Postback safety timer: transitioning in-flight order ${order.id} to submitted`);
              await chrome.storage.local.remove('activeRechargeOrder');
              await sendRechargeStatusUpdate(currentStorage, order.id, {
                status: 'submitted',
              });
            }
          } catch {
            // ignore
          }
        }, 18000);

        return {
          success: true,
          orderId: order.id,
          message: `Dispatched ${order.operator} ₹${(order.amountPaise / 100).toFixed(0)} to ${order.source}`,
        };
      } catch (err: unknown) {
        // Communication failed after all attempts; record failure and close tab
        const errDetail = err instanceof Error ? err.message : 'Timeout waiting for content script';
        console.error('[WalletSync Recharge Dispatcher] Failed to communicate with content script:', errDetail);
        await sendRechargeStatusUpdate(storage, order.id, {
          status: 'failed',
          failureCode: 'tab_dispatch_error',
          failureDetail: `Failed to communicate with recharge content script in background tab: ${errDetail.slice(0, 100)}`,
        });

        await setStorage({
          lastRechargeLog: {
            time: new Date().toISOString(),
            ok: false,
            message: `Dispatch failed: ${errDetail.slice(0, 50)}`,
          },
        });

        return { success: false, message: `Tab dispatch error: ${errDetail.slice(0, 60)}` };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network failure';
      console.error('[WalletSync Recharge Dispatcher] Unexpected dispatcher error:', err);
      await setStorage({
        lastRechargeLog: {
          time: new Date().toISOString(),
          ok: false,
          message: `Error: ${msg.slice(0, 50)}`,
        },
      });
      return { success: false, message: msg };
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
      qrDataUrl?: string;
      qrAmount?: string;
      qrTimer?: string;
    },
  ) {
    try {
      const apiUrl = (storage.apiUrl || '').trim().replace(/\/+$/, '');
      if (!apiUrl) return;

      console.log(`[WalletSync Recharge Dispatcher] Sending status update for ${orderId}:`, payload);
      const res = await fetch(`${apiUrl}/api/v1/recharge-orders/${orderId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${storage.deviceToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        console.error(`[WalletSync Recharge Dispatcher] Status update failed HTTP ${res.status}:`, txt);
      } else {
        console.log(`[WalletSync Recharge Dispatcher] Status update succeeded for ${orderId}`);
      }
    } catch (err) {
      console.error('[WalletSync Recharge Dispatcher] Network error sending status update:', err);
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
        const swTabs = (await chrome.tabs.query({
          url: 'https://simplewallet.in/*',
        }).catch(() => [])) as chrome.tabs.Tab[];
        const egTabs = (await chrome.tabs.query({
          url: 'https://egpayment.com/*',
        }).catch(() => [])) as chrome.tabs.Tab[];
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
