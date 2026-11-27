# PROJECT STATUS & ARCHITECTURE CONTEXT FOR CLAUDE

> **Generated on:** 2026-10-30  
> **Project Name:** WalletSync  
> **Repository Root:** `walletsync/`  
> **Technology Stack:** Next.js 15 (App Router), React 19, Tailwind CSS, TypeScript, Turborepo / pnpm Workspaces, Drizzle ORM, PostgreSQL (Supabase RLS ready) with in-memory fallback, WXT (Chrome Extension Manifest V3), Vitest.

---

## 1. Executive Summary & Purpose

**WalletSync** is a multi-tenant SaaS application paired with a privacy-preserving Chrome Extension (Manifest V3). It automatically reads transaction history from Indian B2B telecom/utility recharge portals for retailers and POS shop owners without storing portal passwords, without executing recharges, and without modifying balances.

### Core Portals Supported:
1. **SimpleWallet** (`https://simplewallet.in/web/MyTrans.aspx...`) — Table-based layout (`#gvList`).
2. **EG Payment** (`https://egpayment.com/users/recharge_history`) — Card/List-based mobile responsive layout (`.walletHistory`).

---

## 2. Hard Architectural Rules & Compliance Commitments

1. **Strict Read-Only:** Zero recharge execution, no form submissions, no balance modification.
2. **Zero Credentials:** The extension never intercepts, stores, reads, or transmits login passwords, PINs, or session cookies.
3. **Fail-Closed Principle:** If layout changes, session logs out, or totals mismatch, capture halts immediately and transmits zero data.
4. **Data Privacy (DPDP Act 2023 Compliance):**
   - Customer phone numbers (`customerNo`) are encrypted at rest using AES-256-GCM.
   - Truncated `customerLast4` is preserved for quick UI search.
   - SHA-256 `customerNoHash` is used for duplicate detection without decrypting.
   - UI masks numbers as `••••••1234` by default with audit-logged unmasking.
5. **Monetary Precision:** All currency amounts are stored in **paise** (`amountPaise: integer`) to eliminate IEEE-754 floating point rounding errors.

---

## 3. Monorepo Structure

```text
walletsync/
├── apps/
│   ├── web/                     # Next.js 15 Web Application & REST APIs
│   │   ├── app/
│   │   │   ├── api/v1/
│   │   │   │   ├── ingest/      # POST /api/v1/ingest (Device token auth + data ingestion)
│   │   │   │   ├── transactions/# GET /api/v1/transactions (ETag 304 caching + filtering)
│   │   │   │   ├── devices/     # Device pairing, token issuing, and revocation
│   │   │   │   ├── stream/      # SSE live transaction stream
│   │   │   │   └── reports/     # Financial summary & analytics endpoints
│   │   │   ├── transactions/    # Full Transaction History table & drawer page
│   │   │   ├── devices/         # POS Device pairing & status management
│   │   │   ├── reports/         # Visual charts & commission breakdown
│   │   │   ├── settings/        # Preferences & security configurations
│   │   │   └── page.tsx         # Executive Dashboard (KPIs, Charts, Live Feed)
│   │   ├── lib/
│   │   │   ├── client-cache.ts  # 0ms Stale-While-Revalidate client cache (sessionStorage)
│   │   │   ├── memory-store.ts  # Fallback in-memory database for dev/demo mode
│   │   │   ├── crypto.ts        # AES-256-GCM encryption & SHA-256 hashing
│   │   │   ├── db.ts            # Drizzle ORM client with RLS tenant context
│   │   │   └── i18n.ts          # English, Bengali (বাংলা), and Hindi (हिंदी) translations
│   │   └── drizzle/             # Database migrations & PostgreSQL schema
│   │
│   └── extension/               # Chrome Extension (Manifest V3 built with WXT)
│       ├── entrypoints/
│       │   ├── background.ts    # Service worker with chrome.alarms scheduler & offline buffer
│       │   ├── content.ts       # Portal DOM observer & fail-closed extractor
│       │   ├── popup/           # Modern Glassmorphic UI (Overview, Live Feed, Terminal)
│       │   └── options/         # Sync frequency and endpoint settings
│       └── .output/             # Built extension zip and unpacked chrome-mv3 folder
│
├── packages/
│   ├── contract/                # Shared Zod schemas, TypeScript types, and DTOs
│   │   ├── src/transaction.ts   # IngestTransaction, ApiTransaction, SourceEnum
│   │   ├── src/device.ts        # DeviceStatus, Pairing contracts
│   │   └── src/ingest.ts        # Ingest payload and response schemas
│   │
│   └── parsers/                 # Isolated DOM parsers with unit test fixtures
│       ├── src/simplewallet/    # Parser for SimpleWallet table structure
│       ├── src/egpayment/       # Parser for EG Payment responsive cards
│       └── src/index.ts         # Unified entrypoint with automatic portal detection
│
├── fixtures/                    # Sanitized real HTML files for testing
│   ├── simplewallet/normal-day.html
│   └── egpayment/normal-day.html
│
└── scripts/
    └── seed.mjs                 # Ingests both demo fixtures into the running web server
```

---

## 4. Current Implementation Status

### ✅ Completed Milestones:
- **M0: Monorepo & Shared Contract:**
  - Complete workspace setup with pnpm and Turborepo.
  - `@walletsync/contract` enforces strict Zod validation across extension and backend.
- **M1: Pure Parsers & Tests:**
  - SimpleWallet parser verified (5 live rows, ₹1,448.00).
  - EG Payment parser verified (50 live rows, ₹13,647.00, ₹261.27 commission). Auto-categorizes Prepaid, DTH, and Gift Cards.
  - 20/20 Vitest parser tests passing. Total monorepo tests: 40/40 passing.
- **M2: Backend & Web App:**
  - Next.js 15 App Router with full responsive dark-mode UI.
  - In-memory store fallback when PostgreSQL is not connected, allowing instant dev without external DB setup.
  - Field-level AES-256-GCM encryption for phone numbers.
  - Multilingual support: English, Bengali, and Hindi.
- **M3: Chrome Extension (Manifest V3):**
  - Modern Raycast/Linear-inspired dark glassmorphism popup UI (`#090A0F`).
  - Dual-portal status cards showing live scanning beacons for SimpleWallet (`SW`) and EG Payment (`EG`).
  - 3-tab segmented navigation: Overview, Live Feed, and Dev Terminal.
  - Real-time Chrome tab URL detection (`Scanning Tab` vs `Tab Standby`).
- **Performance & Speed Optimization (Super-Fast 0ms Load):**
  - **Client-Side SWR Cache:** `client-cache.ts` delivers instant 0ms render from memory and `sessionStorage`.
  - **ETag & HTTP 304:** Next.js transactions API generates ETags and serves `304 Not Modified` (0 bytes payload when unchanged).
  - **HTTP Compression:** Enabled Gzip/Brotli in `next.config.ts`.
  - **Device-Adaptive Rendering:** Automatically renders card layout with pagination for mobile and high-density tables for desktop.
- **Portal Source Distinction:**
  - Added dedicated **"Portal / Website"** badges (🔷 SimpleWallet vs 🔶 EG Payment) across dashboard, transaction tables, mobile cards, and details drawer.
  - Added source filter dropdown to filter transactions by portal.

---

## 5. Development & Testing Commands

```bash
# 1. Install all dependencies
pnpm install

# 2. Run all unit & contract tests (Vitest)
pnpm test

# 3. Start local web application (dev mode)
cd apps/web
pnpm run dev
# Running on http://localhost:3000

# 4. Seed demo transactions into running dev server
# Ingests 5 SimpleWallet and 50 EG Payment transactions into memory
node scripts/seed.mjs

# 5. Build Chrome Extension
cd apps/extension
pnpm run build
# Unpacked extension output: apps/extension/.output/chrome-mv3
```

---

## 6. How Claude Should Continue or Assist

When working on this codebase:
1. **Never break fail-closed parsing:** Ensure parser methods always fail safely (`ok: false`) if sentinel values or structures are missing.
2. **Preserve dual-source schemas:** Whenever adding columns or fields, support both `simplewallet` and `egpayment` in `TransactionSourceSchema` and Drizzle's `txnSourceEnum`.
3. **Maintain in-memory fallback:** Ensure any new database query also updates `apps/web/lib/memory-store.ts` so developers can run without a live Postgres instance.
4. **Preserve PII encryption:** Never return plaintext customer phone numbers over public API responses (`/api/v1/transactions`). Always return masked (`••••••1234`) and hashed values.

