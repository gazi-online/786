# ADR 005: Auto-Click SimpleWallet Search Button as the Single Exception to the Read-Only Rule

**Status:** Accepted  
**Date:** 2026-11-02  
**Context:** Retailer Transaction Extraction & ASP.NET WebForms Architectural Constraint  

---

## 1. Context & Problem Statement

WalletSync was architected around a non-negotiable read-only design boundary: browser extensions extract and aggregate transaction records without modifying portal balances or executing fund transactions.

However, **SimpleWallet** (`https://simplewallet.in/web/MyTrans.aspx`) is built on legacy ASP.NET WebForms. When a user navigates to the transaction history URL, the initial HTTP GET request renders an empty search filter form containing date pickers and buttons (`Show`, `Cancel`, `Export`). The transaction data grid (`#gvList`) is **not rendered at all** on initial page load; it is generated exclusively via an ASP.NET postback triggered by clicking the `Show` button (`#cmdShow`).

Without clicking this button, transactions cannot be read, defeating the automated synchronization purpose for merchants who leave their POS counter displays open.

---

## 2. Decision: A Strictly Constrained Single Exception

We authorize **exactly one exception** to the read-only rule: the content script is permitted to programmatically trigger a `click` event on the search submission button (`#cmdShow`) on SimpleWallet's history page, subject to strict architectural invariants.

### Invariants & Non-Negotiable Boundaries:

1. **Exact Element Identification:**
   - The script may click **ONLY** the element with the exact HTML ID `cmdShow`.
   - It will never target generic submit buttons, classes, or wildcard selectors.

2. **Exact History Path Isolation:**
   - The auto-click logic executes **ONLY** when `window.location.pathname === '/web/MyTrans.aspx'`.
   - Any other URL immediately aborts execution.

3. **Page Fingerprint Verification (Fail-Closed):**
   - Before interacting with the DOM, the content script verifies:
     - Page text contains the sentinel title `MY TRANSACTION`.
     - Form container matches `id="Form1"` with an `action` attribute containing `MyTrans.aspx`.
     - The target button has an explicit value of `"Show"`.
   - If any aspect of this fingerprint diverges (indicating portal redesign, layout drift, or phishing), the script halts immediately, clicks nothing, and reports `layout_changed`.

4. **Zero-Interaction with Financial Controls:**
   - The extension will **NEVER** click any control on any recharge page (e.g. `MobileRecharge.aspx`, `DTHRecharge.aspx`, `BillPayment.aspx`).
   - The extension will **NEVER** click any control on payment gateway or balance transfer pages.
   - On `MyTrans.aspx`, other buttons (`cmdCancel`, `cmdPrint` / Export, `cmdRecPrint` / Receipt Print) are explicitly forbidden from receiving click events.

5. **Opt-In Setting (Safest Default):**
   - The auto-click feature is a user-configurable preference in the extension options (`autoClickEnabled`).
   - It **defaults to `false` (disabled)** as the safest default. Merchants must explicitly opt in.

6. **Frequency Capping & Throttling:**
   - The execution interval is strictly capped: the code enforces `MIN_AUTO_CLICK_INTERVAL_SECONDS = 60`.
   - Requests below this minimum interval are rejected to prevent portal denial-of-service.

7. **Documentation & UI Language Alignment:**
   - All references to "Strict Read-Only Guarantee" in documentation, UI, and marketing materials are replaced with:
     > `"read-only except one search-button click, see ADR"`

---

## 3. Verification & Compliance

Automated test suite `packages/parsers/src/simplewallet/autoClick.test.ts` asserts:
- Only `#cmdShow` receives click events; `cmdCancel`, `cmdPrint`, and `cmdRecPrint` are verified to never be clicked.
- Altered layouts return `valid: false` and emit `layout_changed`.
- Recharge, transfer, and payment URLs immediately abort with `forbidden_recharge_path`.
- When `autoClickEnabled: false`, no DOM interaction occurs.
- Intervals below 60 seconds are throttled.

