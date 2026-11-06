/**
 * simplewallet.in transaction history parser.
 *
 * Runs inside the Chrome extension content script (NOT the service worker). See GUIDE.md §4.
 *
 * Hard rules (from GUIDE.md §1):
 * - Pure function: no side-effects, no network, no storage access.
 * - Uses DOMParser only — never innerHTML.
 * - Reads only the table with id="gvList".
 * - Fail closed: any structural mismatch returns a typed failure; nothing is sent.
 * - customerNo is PII — this parser only extracts it as a string; encryption is the API's job.
 *
 * Column names and layout verified directly from live simplewallet.in fixture:
 * Table ID: #gvList
 * Headers (11 columns):
 *   0  Trn No           → txnId (numeric)
 *   1  Service          → service (e.g. 'Prepaid')
 *   2  Service Name     → serviceName (e.g. 'JIO', 'AIRTEL')
 *   3  Customer No      → customerNo (PII)
 *   4  Transaction Date → occurredAt (format: dd/MM/yyyy h:mm:ss a, Asia/Kolkata)
 *   5  Status           → status + statusRaw
 *   6  Operator ID      → operatorRef
 *   7  Disc (%)         → discountPct
 *   8  Amount           → amountPaise (multiply by 100)
 *   9  Disc (Rs)        → discountPaise (multiply by 100)
 *  10  Receipt          → ignored
 */

import type { IngestTransaction, ParseResult, TransactionStatus } from '@walletsync/contract';

/** Parser version — bumped independently of the extension version. */
export const PARSER_VERSION = '1.0.0';

/**
 * Expected 11 column headers from live simplewallet.in portal.
 */
export const EXPECTED_HEADERS = [
  'Trn No',
  'Service',
  'Service Name',
  'Customer No',
  'Transaction Date',
  'Status',
  'Operator ID',
  'Disc (%)',
  'Amount',
  'Disc (Rs)',
  'Receipt',
] as const;

export const EXPECTED_COLUMN_COUNT = EXPECTED_HEADERS.length; // 11

/** Text that must appear in the page to confirm the user is logged in. */
const LOGGED_IN_SENTINEL = 'MY TRANSACTION';

/** Row classes that must be skipped (page subtotals and grand total). */
const SKIP_ROW_CLASSES = new Set(['gridpagetotal', 'gridgrandtotal']);

// ---------------------------------------------------------------------------
// Column index constants (verified against live portal HTML)
// ---------------------------------------------------------------------------
const COL_TRN_NO = 0;       // txnId
const COL_SERVICE = 1;      // service
const COL_SERVICE_NAME = 2; // operator / serviceName
const COL_CUSTOMER_NO = 3;  // customerNo (PII)
const COL_DATE = 4;         // occurredAt
const COL_STATUS = 5;       // status + statusRaw
const COL_OPERATOR_ID = 6;  // operatorRef
const COL_DISC_PCT = 7;     // discountPct
const COL_AMOUNT = 8;       // amountPaise
const COL_DISC_RS = 9;      // discountPaise
// COL_RECEIPT = 10;        // Receipt button

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse the simplewallet.in transaction history page HTML.
 *
 * @param html - Full HTML string of the history page.
 * @returns ParseResult — discriminated union: { ok: true, rows, ... } or { ok: false, reason }.
 */
export function parse(html: string): ParseResult {
  // Strip script and link tags before DOM parsing to avoid parser execution and fetch issues
  const cleanHtml = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<link\b[^>]*>/gi, '');
  const doc = new DOMParser().parseFromString(cleanHtml, 'text/html');

  // -------------------------------------------------------------------------
  // 1. Logged-out check: page must contain the sentinel text.
  // -------------------------------------------------------------------------
  const bodyText = doc.body?.textContent ?? doc.documentElement?.textContent ?? '';
  const bodyTextUpper = bodyText.toUpperCase();
  if (!bodyTextUpper.includes(LOGGED_IN_SENTINEL)) {
    return {
      ok: false,
      source: 'simplewallet',
      reason: 'logged_out',
      detail: `Sentinel text "${LOGGED_IN_SENTINEL}" not found in page body.`,
    };
  }

  // -------------------------------------------------------------------------
  // 2. Find the history table.
  // -------------------------------------------------------------------------
  const table = doc.getElementById('gvList') ?? (doc.querySelector('#gvList') as HTMLElement | null);
  if (!table) {
    return {
      ok: false,
      source: 'simplewallet',
      reason: 'layout_changed',
      detail: 'Element with id="gvList" not found.',
    };
  }

  const allRows = Array.from(table.querySelectorAll('tr'));
  if (allRows.length === 0) {
    return {
      ok: false,
      source: 'simplewallet',
      reason: 'layout_changed',
      detail: 'Table #gvList has no rows.',
    };
  }

  // -------------------------------------------------------------------------
  // 3. Validate column headers (first row).
  // -------------------------------------------------------------------------
  const headerRow = allRows[0];
  if (!headerRow) {
    return {
      ok: false,
      source: 'simplewallet',
      reason: 'layout_changed',
      detail: 'No header row found in #gvList.',
    };
  }
  const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
  if (headerCells.length !== EXPECTED_COLUMN_COUNT) {
    return {
      ok: false,
      source: 'simplewallet',
      reason: 'layout_changed',
      detail: `Header has ${headerCells.length} columns, expected ${EXPECTED_COLUMN_COUNT}.`,
    };
  }

  for (let i = 0; i < EXPECTED_COLUMN_COUNT; i++) {
    const actual = headerCells[i]?.textContent?.trim() ?? '';
    const expected = EXPECTED_HEADERS[i];
    if (actual !== expected) {
      return {
        ok: false,
        source: 'simplewallet',
        reason: 'layout_changed',
        detail: `Column ${i}: expected "${expected}", got "${actual}".`,
      };
    }
  }

  // -------------------------------------------------------------------------
  // 4. Parse data rows (skip header, skip gridpagetotal/gridgrandtotal).
  // -------------------------------------------------------------------------
  const grandTotalPaise = readGrandTotalPaise(table);
  const rows: IngestTransaction[] = [];

  for (const row of allRows.slice(1)) {
    // Skip subtotal / grand-total rows
    const classes = Array.from(row.classList);
    if (classes.some((c) => SKIP_ROW_CLASSES.has(c))) continue;

    const cells = Array.from(row.querySelectorAll('td'));

    // Must have exactly 11 cells
    if (cells.length !== EXPECTED_COLUMN_COUNT) continue;

    // First cell (Trn No) must be numeric
    const trnNoText = cells[COL_TRN_NO]?.textContent?.trim() ?? '';
    if (!/^\d+$/.test(trnNoText)) continue;

    const txn = parseRow(cells);
    if (txn !== null) {
      rows.push(txn);
    }
  }

  // -------------------------------------------------------------------------
  // 5. Verify totals: sum of row amounts must match Grand Total.
  // -------------------------------------------------------------------------
  const rowSumPaise = rows.reduce((acc, r) => acc + r.amountPaise, 0);
  if (grandTotalPaise !== null && rowSumPaise !== grandTotalPaise) {
    return {
      ok: false,
      source: 'simplewallet',
      reason: 'totals_mismatch',
      detail: `Row sum ${rowSumPaise} paise ≠ Grand Total ${grandTotalPaise} paise.`,
    };
  }

  // -------------------------------------------------------------------------
  // 6. Read wallet balance from page header when present.
  // -------------------------------------------------------------------------
  const balancePaise = readBalancePaise(doc);

  // -------------------------------------------------------------------------
  // 7. Return success.
  // -------------------------------------------------------------------------
  return {
    ok: true,
    source: 'simplewallet',
    parserVersion: PARSER_VERSION,
    capturedAt: new Date().toISOString(),
    balancePaise,
    pageTotals: { amountPaise: grandTotalPaise ?? rowSumPaise },
    rows,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a single data row's cells into an IngestTransaction.
 * Returns null if any required field cannot be parsed.
 */
function parseRow(cells: Element[]): IngestTransaction | null {
  const txnId = cells[COL_TRN_NO]?.textContent?.trim() ?? '';
  if (!txnId) return null;

  const dateText = cells[COL_DATE]?.textContent?.trim() ?? '';
  const occurredAt = parseDateToISO(dateText);
  if (occurredAt === null) return null;

  const service = cells[COL_SERVICE]?.textContent?.trim() ?? '';
  const serviceName = cells[COL_SERVICE_NAME]?.textContent?.trim() ?? '';
  const customerNo = cells[COL_CUSTOMER_NO]?.textContent?.trim() ?? '';
  if (!customerNo) return null;

  const operatorRef = cells[COL_OPERATOR_ID]?.textContent?.trim() ?? '';

  const amountText = cells[COL_AMOUNT]?.textContent?.trim() ?? '';
  const amountPaise = parsePaise(amountText);
  if (amountPaise === null) return null;

  const discPctText = cells[COL_DISC_PCT]?.textContent?.trim() ?? '0';
  const discountPct = parseFloat(discPctText) || 0;

  const discRsText = cells[COL_DISC_RS]?.textContent?.trim() ?? '0';
  const discountPaise = parsePaise(discRsText) ?? 0;

  const statusRaw = cells[COL_STATUS]?.textContent?.trim() ?? '';
  const status = normalizeStatus(statusRaw);

  return {
    txnId,
    source: 'simplewallet',
    service,
    serviceName,
    customerNo,
    occurredAt,
    status,
    statusRaw,
    operatorRef,
    amountPaise,
    discountPct,
    discountPaise,
  };
}

/**
 * Parse a date string like "29/10/2026 12:28:38 PM" or "29/10/2026 7:13:30 PM"
 * into an ISO 8601 string in Asia/Kolkata timezone: "2026-10-29T12:28:38+05:30".
 * Returns null if unparseable.
 */
function parseDateToISO(dateStr: string): string | null {
  const cleaned = dateStr.trim();
  // Match: dd/MM/yyyy h:mm:ss a or dd/MM/yyyy hh:mm:ss a
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i.exec(cleaned);
  if (!match) return null;

  const [, rawDay, rawMonth, rawYear, rawHour, min, sec, ampm] = match;
  if (!rawDay || !rawMonth || !rawYear || !rawHour || !min || !sec || !ampm) return null;

  const pad = (n: number | string) => String(n).padStart(2, '0');
  const dd = pad(rawDay);
  const mm = pad(rawMonth);
  const yyyy = rawYear;

  let hour = parseInt(rawHour, 10);
  const isPM = ampm.toUpperCase() === 'PM';
  const isAM = ampm.toUpperCase() === 'AM';

  if (isPM && hour < 12) hour += 12;
  if (isAM && hour === 12) hour = 0;

  // Asia/Kolkata is always +05:30 (no DST)
  return `${yyyy}-${mm}-${dd}T${pad(hour)}:${min}:${sec}+05:30`;
}

/**
 * Parse a currency string like "399.00" → integer paise (39900).
 * Returns null if unparseable.
 */
function parsePaise(text: string): number | null {
  const cleaned = text.replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-') return 0;
  const value = parseFloat(cleaned);
  if (!isFinite(value)) return null;
  return Math.round(value * 100);
}

/**
 * Normalise raw status text to the canonical enum value.
 */
export function normalizeStatus(raw: string): TransactionStatus {
  const clean = (raw || '').toLowerCase().trim();
  if (!clean) return 'unknown';

  if (
    clean.includes('success') ||
    clean === 'done' ||
    clean === 'completed' ||
    clean === 'ok'
  ) {
    return 'success';
  }

  if (
    clean.includes('fail') ||
    clean.includes('failure') ||
    clean.includes('declin') ||
    clean.includes('reject') ||
    clean.includes('cancel') ||
    clean.includes('error') ||
    clean.includes('invalid') ||
    clean.includes('dispute')
  ) {
    return 'failed';
  }

  if (
    clean.includes('refund') ||
    clean.includes('revers') ||
    clean.includes('credit back')
  ) {
    return 'refunded';
  }

  if (
    clean.includes('pend') ||
    clean.includes('process') ||
    clean.includes('queue') ||
    clean.includes('wait') ||
    clean.includes('submit') ||
    clean.includes('initiat') ||
    clean.includes('hold')
  ) {
    return 'pending';
  }

  return 'unknown';
}

/**
 * Read the Grand Total amount from the gridgrandtotal row.
 */
function readGrandTotalPaise(table: HTMLElement): number | null {
  // Check direct label id first
  const lblAmt = table.querySelector<HTMLElement>('#lblAmtGrandAmt');
  if (lblAmt && lblAmt.textContent) {
    return parsePaise(lblAmt.textContent);
  }

  const totalRow = table.querySelector('tr.gridgrandtotal');
  if (!totalRow) return null;

  const cells = Array.from(totalRow.querySelectorAll('td'));
  let col = 0;
  for (const cell of cells) {
    const span = parseInt(cell.getAttribute('colspan') ?? '1', 10);
    if (col + span > COL_AMOUNT) {
      return parsePaise(cell.textContent?.trim() ?? '');
    }
    col += span;
  }
  return null;
}

/**
 * Read the wallet balance from the page header element.
 */
function readBalancePaise(doc: Document): number | null {
  // Check UserInfo regular balance first
  const userInfo = doc.getElementById('UserInfo');
  if (userInfo) {
    const text = userInfo.textContent ?? '';
    const match = /Regular\s*:\s*([\d,]+\.?\d*)/i.exec(text);
    if (match) return parsePaise(match[1] ?? '');
  }

  // Fallback to legacy walletBalance id
  const el = doc.getElementById('walletBalance');
  if (!el) return null;
  const text = el.textContent ?? '';
  const match = /Rs\.\s*([\d,]+\.?\d*)/i.exec(text);
  if (!match) return null;
  return parsePaise(match[1] ?? '');
}
