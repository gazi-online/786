/**
 * Ultra-fast client-side Stale-While-Revalidate caching utility.
 * Uses in-memory Map + sessionStorage to achieve instant 0ms first render.
 *
 * Requirements (Amd-3):
 * - sessionStorage holds only masked data (customerNoMasked, customerLast4).
 * - Clear routine cleared on sign-out and on any 401 response from the API.
 */

const memoryCache = new Map<string, { data: unknown; timestamp: number }>();

export function getClientCache<T>(key: string, maxAgeMs = 60_000): T | null {
  // 1. Try in-memory first (0ms latency, works in both browser and test environments)
  const mem = memoryCache.get(key);
  if (mem && Date.now() - mem.timestamp < maxAgeMs) {
    return mem.data as T;
  }

  // 2. Try sessionStorage for tab persistence across reloads (if window/sessionStorage available)
  if (typeof window !== 'undefined' && typeof sessionStorage !== 'undefined') {
    try {
      const raw = sessionStorage.getItem(`ws_cache_${key}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Date.now() - parsed.timestamp < maxAgeMs) {
          memoryCache.set(key, parsed);
          return parsed.data as T;
        }
      }
    } catch {
      // sessionStorage quota or unavailable
    }
  }

  return null;
}

export function setClientCache<T>(key: string, data: T): void {
  const entry = { data, timestamp: Date.now() };
  memoryCache.set(key, entry);

  if (typeof window !== 'undefined' && typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(`ws_cache_${key}`, JSON.stringify(entry));
    } catch {
      // sessionStorage quota
    }
  }
}

/**
 * Clears all cached tenant and transaction data from both in-memory Map and sessionStorage.
 * Triggered on user sign-out or on encountering any 401 Unauthorized response from API.
 */
export function clearClientCache(): void {
  memoryCache.clear();

  if (typeof window !== 'undefined' && typeof sessionStorage !== 'undefined') {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith('ws_cache_')) {
          keysToRemove.push(k);
        }
      }
      for (const k of keysToRemove) {
        sessionStorage.removeItem(k);
      }
    } catch {
      // ignore storage access errors
    }
  }
}

/**
 * Global fetch wrapper or helper to intercept 401s and immediately clear cache
 */
export function handleApiUnauthorized(status: number): void {
  if (status === 401) {
    clearClientCache();
  }
}
