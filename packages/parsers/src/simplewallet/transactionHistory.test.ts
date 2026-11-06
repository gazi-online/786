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
import { parse, normalizeStatus, PARSER_VERSION } from './transactionHistory.js';

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

    // amountPaise: 500.00 → 50000
    expect(golden.amountPaise).toBe(50000);

    // discountPaise: 7.50 → 750
    expect(golden.discountPaise).toBe(750);

    // discountPct: 1.5
    expect(golden.discountPct).toBe(1.5);

    // occurredAt: "01/01/2025 12:00:00 PM" → "2025-01-01T12:00:00+05:30"
    expect(golden.occurredAt).toBe('2025-01-01T12:00:00+05:30');

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
    expect(rowSum).toBe(150000);
    expect(result.pageTotals.amountPaise).toBe(150000);
  });

  it('reads wallet balance from the page UserInfo header', () => {
    const result = parse(fixture('normal-day.html'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Regular : 500.00 → 50000 paise
    expect(result.balancePaise).toBe(50000);
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
    expect(row?.occurredAt).toBe('2025-01-01T19:15:00+05:30');
  });

  it('parses noon PM time correctly (12:00:00 PM)', () => {
    const result = parse(fixture('normal-day.html'));
    if (!result.ok) return;
    const golden = result.rows.find((r) => r.txnId === '55000005');
    expect(golden?.occurredAt).toBe('2025-01-01T12:00:00+05:30');
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

  it('maps Operator Failed and variants → failed', () => {
    expect(normalizeStatus('Operator Failed')).toBe('failed');
    expect(normalizeStatus('Failed')).toBe('failed');
    expect(normalizeStatus('Failure')).toBe('failed');
    expect(normalizeStatus('Operator Error')).toBe('failed');
    expect(normalizeStatus('Declined')).toBe('failed');
    expect(normalizeStatus('Cancelled')).toBe('failed');
    expect(normalizeStatus('Rejected')).toBe('failed');
  });

  it('maps Pending and variants → pending', () => {
    expect(normalizeStatus('Pending')).toBe('pending');
    expect(normalizeStatus('Processing')).toBe('pending');
    expect(normalizeStatus('In Process')).toBe('pending');
    expect(normalizeStatus('Queued')).toBe('pending');
  });

  it('maps Refunded and variants → refunded', () => {
    expect(normalizeStatus('Refunded')).toBe('refunded');
    expect(normalizeStatus('Refund')).toBe('refunded');
    expect(normalizeStatus('Reversed')).toBe('refunded');
  });
});

// ---------------------------------------------------------------------------
// Unit tests: paise conversion
// ---------------------------------------------------------------------------
describe('paise conversion', () => {
  it('converts 500.00 to 50000 paise', () => {
    const result = parse(fixture('normal-day.html'));
    if (!result.ok) return;
    const row = result.rows.find((r) => r.txnId === '55000005');
    expect(row?.amountPaise).toBe(50000);
  });

  it('converts 7.50 to 750 paise', () => {
    const result = parse(fixture('normal-day.html'));
    if (!result.ok) return;
    const row = result.rows.find((r) => r.txnId === '55000005');
    expect(row?.discountPaise).toBe(750);
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
