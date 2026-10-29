# WalletSync — Threat Model & Security Architecture

This document provides a formal STRIDE-based threat modeling assessment and security mitigation analysis for WalletSync as required by **GUIDE.md Section 7**.

---

## 1. System Overview & Trust Boundaries

WalletSync consists of three primary trust zones:
1. **Host Recharge Portal Zone (Untrusted / External):** The retailer's active browser session on `simplewallet.in`. Contains dynamic HTML tables and user cookies that must **never** be accessed or persisted.
2. **Client Extension Zone (Isolated Sandbox):** The Manifest V3 Chrome Extension executing content scripts and a background service worker. Holds an in-memory / local-storage scoped device token.
3. **Multi-Tenant SaaS Zone (Secured Backend):** Next.js App Router API, Supabase / PostgreSQL database with Row-Level Security (RLS), and server-side encryption secrets.

```
+-------------------------------------------------------------+
| Browser Context (Retailer Machine)                          |
|                                                             |
|  [ simplewallet.in ]                                        |
|         │ (DOMParser text only)                             |
|         ▼                                                   |
|  [ WalletSync Content Script ]                              |
|         │ (chrome.runtime.sendMessage)                      |
|         ▼                                                   |
|  [ WalletSync Service Worker ] ──> Stores Device Token      |
+─────────│───────────────────────────────────────────────────+
          │ HTTPS (POST /api/v1/ingest)
          ▼
+-------------------------------------------------------------+
| Cloud Backend (WalletSync SaaS)                             |
|                                                             |
|  [ Next.js API Routes ]                                     |
|    - Rate limiter (Upstash Redis / DB fallback)             |
|    - Device token hash verification                         |
|    - AES-256-GCM Field-Level PII Encryption                 |
|    - SET LOCAL app.current_tenant_id                        |
|         │                                                   |
|         ▼                                                   |
|  [ Supabase / Postgres Database ]                           |
|    - RLS enabled on all tenant tables                       |
|    - NO BYPASSRLS on runtime application role               |
+-------------------------------------------------------------+
```

---

## 2. Mandatory Threat Scenarios & Mitigations

### Threat 1: Stolen Device Token
* **Scenario:** An attacker gains access to the retailer's local machine or extracts the device token from `chrome.storage.local`.
* **Impact:** The attacker could attempt to ingest forged transaction batches or flood the ingest endpoint.
* **Mitigations:**
  1. **Strictly Scoped Scope:** Device tokens only possess the `ingest:write` capability. They cannot query transactions, reveal customer phone numbers, read tenant settings, or access billing information.
  2. **Hash-Only Storage:** Raw device tokens are generated as 256-bit cryptographically secure random bytes (`crypto.randomBytes(32)`). Only the SHA-256 hash is stored in the database.
  3. **Immediate Revocation (5-second rule):** When a retailer revokes a device via the Devices UI, `revokedAt` is populated immediately. The ingest handler checks revocation on every request and returns `401 Unauthorized` within milliseconds.
  4. **Rate Limiting:** Rate limiters enforce sliding windows (e.g. 60 requests per minute per device) with Upstash Redis and database-backed fallbacks.

### Threat 2: Malicious or Cloned Extension
* **Scenario:** A rogue third party clones the extension package or attempts to modify code to execute automated actions (e.g., auto-recharge, balance transfer).
* **Impact:** Potential violation of the strictly read-only guarantee.
* **Mitigations:**
  1. **Hard Product Boundary:** Zero recharge, payment, transfer, or submit code exists in any package. Code linter and static verification guarantee no identifier starts with `recharge`, `pay`, or `submit`.
  2. **Zero Credential Permission:** The extension manifest does **not** request `cookies` permission. It cannot read session cookies (`.ASPXAUTH`, `ASP.NET_SessionId`) or passwords.
  3. **Origin Allow-Listing:** `host_permissions` in Manifest V3 are strictly limited to `https://*.simplewallet.in/*` and the configured API origin. No broad `<all_urls>` permission.

### Threat 3: Compromised Tenant Account
* **Scenario:** An attacker compromises the credentials of a tenant user (e.g. weak password or phishing).
* **Impact:** Unauthorized viewing of store transactions or customer phone numbers.
* **Mitigations:**
  1. **PII Masking by Default:** Mobile numbers are masked in all UI views (`••••••1234`).
  2. **Audited Field Decryption:** Unmasking a customer number requires an explicit POST call to `/api/v1/transactions/[id]/reveal`. Every unmask event is logged to `audit_log` with the actor ID, target ID, and timestamp.
  3. **HttpOnly Session Cookies:** Authentication uses Supabase Auth with secure, `httpOnly`, `SameSite=Lax` cookies, preventing script-based session extraction.

### Threat 4: Portal Layout Drift Causing Corrupted Data
* **Scenario:** `simplewallet.in` updates its table layout, reorders columns, or changes status string formats.
* **Impact:** Mismatched data or distorted financial records.
* **Mitigations:**
  1. **Strict 11-Header Exact Match:** The parser checks all 11 expected headers in exact order. Any divergence immediately yields `{ ok: false, reason: "layout_changed" }`.
  2. **Row Sum vs. Grand Total Invariant:** The parser parses integer amounts in paise and calculates the sum of all row amounts. If the sum differs from the page's Grand Total by even 1 paisa, it returns `{ ok: false, reason: "totals_mismatch" }`.
  3. **Fail-Closed Principle:** When a layout drift or totals mismatch occurs, the extension sends **nothing** to the server, halts polling, and presents an error banner to the user.

### Threat 5: Rogue Request Trying to Read Another Tenant's Rows (Cross-Tenant Leakage)
* **Scenario:** A malicious tenant tampers with API requests (e.g. supplying another tenant's `tenantId` or transaction ID).
* **Impact:** Data leakage across retailers.
* **Mitigations:**
  1. **PostgreSQL Row-Level Security (RLS):** Every tenant table (`transactions`, `devices`, `sync_events`, `audit_log`) has RLS enabled with `FORCE ROW LEVEL SECURITY`.
  2. **No BYPASSRLS:** The runtime database role is explicitly denied `BYPASSRLS`.
  3. **Tenant Context Enforcement:** For device-token routes, the API sets `SET LOCAL app.current_tenant_id = $tenantId` inside an isolated transaction. For user-session routes, RLS checks `auth.uid()` against `memberships`.
  4. **Automated Cross-Tenant Isolation Tests:** Integration test in `apps/web/test/isolation.test.ts` continuously verifies that Tenant A cannot read Tenant B's data through either the API or direct DB queries.

---

## 3. Privacy & Compliance (India DPDP Act 2023)

1. **Data Minimization:** Customer mobile numbers are collected solely to allow retailers to verify customer claims about recharge transactions.
2. **Field-Level Encryption:** The full customer number is encrypted at rest using AES-256-GCM (`lib/crypto.ts`) with an encryption key held in application environment variables, completely outside the database storage layer.
3. **HMAC Indexing:** Search is facilitated via plaintext last-4 digits (`customer_last4`) and HMAC-SHA256 (`customer_no_hash`). The full plaintext number is never indexed or logged in plaintext.
4. **Data Retention Policy:** Automated data retention policies allow retailers to set retention windows (6 to 36 months) with automatic purging.

