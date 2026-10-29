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
 * TODO(open-item: OQ-1): Pagination strategy unknown. See GUIDE.md §8.
 *   The parser currently processes only the HTML it receives (one page).
 *   Implement PaginationStrategy when the owner confirms pager link structure.
 *
 * TODO(open-item: OQ-2): Date range filter request format unknown. See GUIDE.md §8.
 *   DateRangeStrategy is not referenced here — that is the service worker's concern.
 *
 * SYNTHETIC COLUMN NAMES: The EXPECTED_HEADERS constant below reflects the SYNTHETIC fixtures.
 * When the owner supplies a real fixture (fixtures/simplewallet/normal-day.html), update this
 * constant to match the real column names. Tests will fail deliberately if they diverge.
 */

import type { IngestTransaction, ParseResult, TransactionStatus } from '@walletsync/contract';

/** Parser version — bumped independently of the extension version. */
export const PARSER_VERSION = '0.1.0';

/**
 * SYNTHETIC column names — update when real fixture is supplied by the owner.
 * The parser returns layout_changed if the actual headers do not match exactly.
 * Column index mapping (0-based):
 *   0  SNo         — serial number; numeric; first cell must be numeric to accept the row
 *   1  TxnID       → txnId
 *   2  Date        → occurredAt  (format: dd/MM/yyyy hh:mm:ss a, zone Asia/Kolkata)
 *   3  Service     → service
 *   4  Operator    → serviceName
 *   5  Customer No → customerNo  (PII — encrypted at rest by the API)
 *   6  Amount (Rs) → amountPaise (multiply by 100, round to integer)
 *   7  Disc (%)    → discountPct
 *   8  Disc (Rs)   → discountPaise (multiply by 100, round to integer)
 *   9  Status      → status + statusRaw
 *  10  Receipt     — ignored (query params mislabeled per GUIDE.md §3)
 *
 * Note: operatorRef is not present in the synthetic fixtures. It maps to an "Operator ID" column
 * when the real fixture is supplied. For now it is set to '' and marked TODO.
 * TODO(open-item): operatorRef column name unknown — update EXPECTED_HEADERS when real fixture supplied.
 */
const EXPECTED_HEADERS = [
  'SNo',
  'TxnID',
  'Date',
  'Service',
  'Operator',
  'Customer No',
  'Amount (Rs)',
  'Disc (%)',
  'Disc (Rs)',
  'Status',
  'Receipt',
] as const;

const EXPECTED_COLUMN_COUNT = EXPECTED_HEADERS.length; // 11

/** Text that must appear in the page to confirm the user is logged in. */
const LOGGED_IN_SENTINEL = 'MY TRANSACTION';

/** Row classes that must be skipped (page subtotals and grand total). */
const SKIP_ROW_CLASSES = new Set(['gridpagetotal', 'gridgrandtotal']);

// ---------------------------------------------------------------------------
// Column index constants (named for readability)
// ---------------------------------------------------------------------------
const COL_SNO = 0;
const COL_TXN_ID = 1;
const COL_DATE = 2;
const COL_SERVICE = 3;
const COL_OPERATOR = 4;
const COL_CUSTOMER_NO = 5;
const COL_AMOUNT = 6;
const COL_DISC_PCT = 7;
const COL_DISC_RS = 8;
const COL_STATUS = 9;
// COL_RECEIPT = 10 — intentionally not read (mislabeled query params per GUIDE.md §3)

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse the simplewallet.in transaction history page HTML.
 *
 * @param html - Full HTML string of the history page (fetched with credentials: 'same-origin').
 * @returns ParseResult — discriminated union: { ok: true, rows, ... } or { ok: false, reason }.
 */
export function parse(html: string): ParseResult {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // -------------------------------------------------------------------------
  // 1. Logged-out check: page must contain the sentinel text.
  // -------------------------------------------------------------------------
  if (!doc.body.textContent?.includes(LOGGED_IN_SENTINEL)) {
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
  const table = doc.getElementById('gvList');
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

    // First cell (SNo) must be numeric
    const snoText = cells[COL_SNO]?.textContent?.trim() ?? '';
    if (!/^\d+$/.test(snoText)) continue;

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
  const txnId = cells[COL_TXN_ID]?.textContent?.trim() ?? '';
  if (!txnId) return null;

  const dateText = cells[COL_DATE]?.textContent?.trim() ?? '';
  const occurredAt = parseDateToISO(dateText);
  if (occurredAt === null) return null;

  const service = cells[COL_SERVICE]?.textContent?.trim() ?? '';
  const serviceName = cells[COL_OPERATOR]?.textContent?.trim() ?? '';
  const customerNo = cells[COL_CUSTOMER_NO]?.textContent?.trim() ?? '';
  if (!customerNo) return null;

  const amountText = cells[COL_AMOUNT]?.textContent?.trim() ?? '';
  const amountPaise = parsePaise(amountText);
  if (amountPaise === null) return null;

  const discPctText = cells[COL_DISC_PCT]?.textContent?.trim() ?? '';
  const discountPct = parseFloat(discPctText);
  if (!isFinite(discountPct)) return null;

  const discRsText = cells[COL_DISC_RS]?.textContent?.trim() ?? '';
  const discountPaise = parsePaise(discRsText);
  if (discountPaise === null) return null;

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
    // TODO(open-item): operatorRef column name unknown — returns '' until real fixture supplied.
    operatorRef: '',
    amountPaise,
    discountPct,
    discountPaise,
  };
}

/**
 * Parse "dd/MM/yyyy hh:mm:ss a" → ISO 8601 with +05:30 offset.
 * Example: "29/10/2026 12:28:38 PM" → "2026-10-29T12:28:38+05:30"
 * Returns null if the string does not match the expected format.
 */
function parseDateToISO(text: string): string | null {
  // Pattern: dd/MM/yyyy hh:mm:ss AM|PM
  const match = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/i.exec(
    text.trim(),
  );
  if (!match) return null;

  const [, dd, mm, yyyy, hourStr, min, sec, meridiem] = match;
  let hour = parseInt(hourStr ?? '0', 10);

  if (meridiem?.toUpperCase() === 'PM' && hour !== 12) hour += 12;
  if (meridiem?.toUpperCase() === 'AM' && hour === 12) hour = 0;

  const pad = (n: number) => String(n).padStart(2, '0');
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
function normalizeStatus(raw: string): TransactionStatus {
  switch (raw.toLowerCase().trim()) {
    case 'success':
      return 'success';
    case 'pending':
      return 'pending';
    case 'failed':
    case 'failure':
      return 'failed';
    case 'refunded':
    case 'refund':
      return 'refunded';
    default:
      return 'unknown';
  }
}

/**
 * Read the Grand Total amount from the gridgrandtotal row.
 * Returns null if no grand total row is found (treat as no constraint).
 */
function readGrandTotalPaise(table: HTMLElement): number | null {
  const totalRow = table.querySelector('tr.gridgrandtotal');
  if (!totalRow) return null;

  // The Amount (Rs) column is at index 6 but colspan may shift cells.
  // We find the cell by its position after resolving colspan:
  // The grand total row in the synthetic fixtures has: [colspan=6 label | amount | ...].
  // Amount is the 2nd cell (index 1 in the actual <td> list of the tfoot row).
  const cells = Array.from(totalRow.querySelectorAll('td'));

  // Walk cells: the first cell with colspan covers 6 columns; the next cell is Amount.
  // General approach: accumulate column span and pick the cell that covers column index 6.
  let col = 0;
  for (const cell of cells) {
    const span = parseInt(cell.getAttribute('colspan') ?? '1', 10);
    if (col + span > COL_AMOUNT) {
      // This cell covers the Amount column
      return parsePaise(cell.textContent?.trim() ?? '');
    }
    col += span;
  }
  return null;
}

/**
 * Read the wallet balance from the page header element.
 * Returns null if not present.
 *
 * TODO(open-item: OQ-*): The exact selector for the wallet balance is SYNTHETIC.
 * Update when the owner supplies the real fixture.
 */
function readBalancePaise(doc: Document): number | null {
  const el = doc.getElementById('walletBalance');
  if (!el) return null;
  const text = el.textContent ?? '';
  // Pattern: "Wallet Balance: Rs. 1250.00"
  const match = /Rs\.\s*([\d,]+\.?\d*)/i.exec(text);
  if (!match) return null;
  return parsePaise(match[1] ?? '');
}
