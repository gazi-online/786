/**
 * Dedicated Tab Manager for Portal Recharge Operations
 *
 * Core Safety Rules:
 * 1. Never touch or interrupt the retailer's working tab.
 * 2. Background recharge tabs must ALWAYS be opened with { active: false }.
 * 3. Tab loading is monitored via chrome.tabs.onUpdated until 'complete' (with 20s timeout).
 * 4. Dedicated tabs are cleanly closed after operation completion or failure.
 */

export interface DedicatedTabResult {
  tabId: number;
}

/**
 * Creates a non-active background tab for portal automation and waits for DOM to complete loading.
 */
export async function openDedicatedBackgroundTab(
  url: string,
  timeoutMs = 20000,
): Promise<DedicatedTabResult> {
  const tab = await chrome.tabs.create({
    url,
    active: false,
  });

  if (!tab.id) {
    throw new Error('Failed to create background tab: tab.id is undefined');
  }

  const tabId = tab.id;

  // Wait for tab status === 'complete'
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const listener = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        cleanup();
        resolve();
      }
    };

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
    };

    timer = setTimeout(() => {
      cleanup();
      // Tab timed out; attempt closing it to prevent tab leakage
      chrome.tabs.remove(tabId).catch(() => {});
      reject(
        new Error(
          `Timeout waiting for background tab ${tabId} to complete loading after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(listener);
  });

  return { tabId };
}

/**
 * Safely removes a dedicated background tab, ignoring errors if already closed.
 */
export async function closeDedicatedTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // Already closed or detached
  }
}

