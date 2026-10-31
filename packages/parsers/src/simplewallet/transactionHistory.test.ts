/**
 * Parser tests for packages/parsers/src/simplewallet/transactionHistory.ts
 *
 * Vitest environment: happy-dom (provides DOMParser in Node — Amd-6).
 *
 * Acceptance tests from GUIDE.md §8 verified here against real simplewallet fixture:
 *   ✓ Golden row (TxnID 55000005)
 *   ✓ Totals mismatch
 *   ✓ Layout drift
 *   ✓ Empty table (no rows, no delete)
 *   ✓ Logged-out page
 *   ✓ Real balance from UserInfo header
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parse, PARSER_VERSION } from './transactionHistory.js';

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

function fixture(name: string): string {
  const root = join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'simplewallet');
  return readFileSync(join(root, name), 'utf-8');
}

// ---------------------------------------------------------------------------
// Acceptance test: Logged-out page
// ---------------------------------------------------------------------------
describe('logged-out fixture', () => {
  it('returns logged_out when MY TRANSACTION sentinel is absent', () => {
    const result = parse(fixture('logged-out.html'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('logged_out');
    }
  });
});

// ---------------------------------------------------------------------------
// Acceptance test: Layout drift
// ---------------------------------------------------------------------------
describe('layout-changed fixture', () => {
  it('returns layout_changed when column headers do not match', () => {
    const result = parse(fixture('layout-changed.html'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('layout_changed');
    }
  });
});

// ---------------------------------------------------------------------------
// Acceptance test: Totals mismatch
// ---------------------------------------------------------------------------
describe('totals-mismatch fixture', () => {
  it('returns totals_mismatch when row sum ≠ Grand Total', () => {
    const result = parse(fixture('totals-mismatch.html'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('totals_mismatch');
    }
  });
});

// ---------------------------------------------------------------------------
// Acceptance test: Empty table
// ---------------------------------------------------------------------------
describe('empty-table fixture', () => {
  it('returns ok: true with zero rows (does not return a failure)', () => {
    const result = parse(fixture('empty-table.html'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toHaveLength(0);
      expect(result.pageTotals.amountPaise).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Acceptance tests: Normal day fixture (real portal HTML)
// ---------------------------------------------------------------------------
describe('normal-day fixture (real simplewallet.in portal HTML)', () => {
  it('returns ok: true with the expected rows', () => {
    const result = parse(fixture('normal-day.html'));
    expect(result.ok).toBe(true);
  });

  it('includes parserVersion in the result', () => {
    const result = parse(fixture('normal-day.html'));
    if (result.ok) {
      expect(result.parserVersion).toBe(PARSER_VERSION);
    }
  });

  it('correctly parses the golden row (acceptance test from GUIDE.md §8)', () => {
    const result = parse(fixture('normal-day.html'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Find the golden row: TxnID 55000005
    const golden = result.rows.find((r) => r.txnId === '55000005');
    expect(golden).toBeDefined();
    if (!golden) return;

    // amountPaise: 399.00 → 39900
    expect(golden.amountPaise).toBe(39900);

    // discountPaise: 5.98 → 598
    expect(golden.discountPaise).toBe(598);

    // discountPct: 1.5
    expect(golden.discountPct).toBe(1.5);

    // occurredAt: "29/10/2026 12:28:38 PM" → "2026-10-29T12:28:38+05:30"
    expect(golden.occurredAt).toBe('2026-10-29T12:28:38+05:30');

    // status: "Success" → "success"
    expect(golden.status).toBe('success');

    // statusRaw: preserved as-is
    expect(golden.statusRaw).toBe('Success');

    // source
    expect(golden.source).toBe('simplewallet');

    // service and serviceName
    expect(golden.service).toBe('Prepaid');
    expect(golden.serviceName).toBe('AIRTEL');

    // customerNo: extracted as plaintext
    expect(golden.customerNo).toBe('5000000010');

    // operatorRef: extracted from Operator ID column
    expect(golden.operatorRef).toBe('OPR0000000005');
  });

  it('skips gridpagetotal and gridgrandtotal rows', () => {
    const result = parse(fixture('normal-day.html'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(5);
  });

  it('row-amount sum equals pageTotals.amountPaise', () => {
    const result = parse(fixture('normal-day.html'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rowSum = result.rows.reduce((acc, r) => acc + r.amountPaise, 0);
    expect(rowSum).toBe(144800);
    expect(result.pageTotals.amountPaise).toBe(144800);
  });

  it('reads wallet balance from the page UserInfo header', () => {
    const result = parse(fixture('normal-day.html'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Regular : 197.98 → 19798 paise
    expect(result.balancePaise).toBe(19798);
  });
});

// ---------------------------------------------------------------------------
// Unit tests: parseDateToISO via parse()
// ---------------------------------------------------------------------------
describe('date parsing', () => {
  it('parses a PM time correctly', () => {
    const result = parse(fixture('normal-day.html'));
    if (!result.ok) return;
    const row = result.rows.find((r) => r.txnId === '55000001');
    expect(row?.occurredAt).toBe('2026-10-29T19:13:30+05:30');
  });

  it('parses noon PM time correctly (12:28:38 PM)', () => {
    const result = parse(fixture('normal-day.html'));
    if (!result.ok) return;
    const golden = result.rows.find((r) => r.txnId === '55000005');
    expect(golden?.occurredAt).toBe('2026-10-29T12:28:38+05:30');
  });
});

// ---------------------------------------------------------------------------
// Unit tests: status normalisation
// ---------------------------------------------------------------------------
describe('status normalisation', () => {
  it('maps Success → success', () => {
    const result = parse(fixture('normal-day.html'));
    if (!result.ok) return;
    const row = result.rows.find((r) => r.txnId === '55000005');
    expect(row?.status).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// Unit tests: paise conversion
// ---------------------------------------------------------------------------
describe('paise conversion', () => {
  it('converts 399.00 to 39900 paise', () => {
    const result = parse(fixture('normal-day.html'));
    if (!result.ok) return;
    const row = result.rows.find((r) => r.txnId === '55000005');
    expect(row?.amountPaise).toBe(39900);
  });

  it('converts 5.98 to 598 paise', () => {
    const result = parse(fixture('normal-day.html'));
    if (!result.ok) return;
    const row = result.rows.find((r) => r.txnId === '55000005');
    expect(row?.discountPaise).toBe(598);
  });
});

// ---------------------------------------------------------------------------
// Edge case: inline HTML with no gvList table
// ---------------------------------------------------------------------------
describe('edge cases', () => {
  it('returns layout_changed when #gvList is absent', () => {
    const html = '<html><body><h2>MY TRANSACTION</h2><p>No table here.</p></body></html>';
    const result = parse(html);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('layout_changed');
  });

  it('returns logged_out for completely empty page', () => {
    const result = parse('<html><body></body></html>');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('logged_out');
  });
});
