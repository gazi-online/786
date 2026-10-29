# WalletSync

Multi-tenant SaaS + Chrome Extension (Manifest V3) for reading recharge-portal transaction history.

**Status: M0, M1, M2, M3 Complete**

- **M0**: Monorepo layout, CI pipeline, shared contract schemas (`packages/contract`).
- **M1**: Pure portal parser (`packages/parsers`), fixtures (sanitized/synthetic), 18/18 acceptance tests passing.
- **M2**: Database schema (Drizzle ORM), RLS isolation policies (`0001_rls.sql`), `/devices/pair`, `/ingest` routes, AES-256-GCM encryption, rate limiting, 38/38 tests passing.
- **M3**: Chrome Extension MVP (Manifest V3):
  - Service worker with `chrome.alarms` scheduler (default 2 min + ±15% jitter).
  - Offline buffer queue (last 50 payloads with exponential backoff).
  - Pure DOM parser content script with fail-closed safety.
  - React Popup (360px) supporting 4 states: *Unpaired*, *Pairing*, *Healthy/Synced*, *Error/Alert*.
  - Options page for URL and sync preferences.

---

## 🛠️ Testing the Extension in Chrome / Edge / Brave

1. Open your browser and go to `chrome://extensions/` (or `edge://extensions/`).
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the build directory:
   ```
   walletsync/apps/extension/.output/chrome-mv3
   ```
5. Click the WalletSync puzzle icon to view the popup!

---

## 💻 Running the Web App

```bash
cd apps/web
pnpm run dev
# Live at http://localhost:3000
```

---

## 🧪 Running Verification & Tests

```bash
# Typecheck
pnpm run typecheck

# Linting
pnpm run lint

# Test suite (38 tests)
pnpm run test

# Production build (All packages & extension)
pnpm run build
```
