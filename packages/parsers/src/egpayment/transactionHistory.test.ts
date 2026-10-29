import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEgPayment, PARSER_VERSION, LOGGED_IN_SENTINEL } from './transactionHistory';

const FIXTURES_DIR = resolve(__dirname, '../../../../fixtures/egpayment');

function loadFixture(filename: string): string {
  return readFileSync(resolve(FIXTURES_DIR, filename), 'utf8');
}

describe('EG Payment Parser - transactionHistory', () => {
  it('parses live egpayment.com HTML fixture with all 50 transactions', () => {
    const html = loadFixture('normal-day.html');
    const result = parseEgPayment(html);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.source).toBe('egpayment');
    expect(result.parserVersion).toBe(PARSER_VERSION);
    expect(result.rows.length).toBe(50);
    expect(result.pageTotals.amountPaise).toBe(1364700); // ₹13,647.00

    // Test golden row 1: Order ID 26302230312056
    const row1 = result.rows[0]!;
    expect(row1.txnId).toBe('26302230312056');
    expect(row1.source).toBe('egpayment');
    expect(row1.serviceName).toBe('Vi');
    expect(row1.customerNo).toBe('8348828920');
    expect(row1.amountPaise).toBe(34900); // ₹349.00
    expect(row1.discountPaise).toBe(698); // ₹6.98
    expect(row1.discountPct).toBe(2);
    expect(row1.status).toBe('success');
    expect(row1.operatorRef).toBe('UER2610291400440066');
    expect(row1.occurredAt).toBe('2026-10-29T14:00:00+05:30');

    // Test multi-service classification
    const dthRow = result.rows.find((r) => r.serviceName === 'VIDEOCON DTH TV' || r.serviceName === 'TATA PLAY');
    expect(dthRow).toBeDefined();
    expect(dthRow?.service).toBe('DTH');

    const cardRow = result.rows.find((r) => r.serviceName === 'Google Card');
    expect(cardRow).toBeDefined();
    expect(cardRow?.service).toBe('Gift Card');
  });

  it('fails closed with logged_out when TRANSACTIONS HISTORY sentinel is missing', () => {
    const html = '<html><body><h1>Login to your account</h1></body></html>';
    const result = parseEgPayment(html);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('logged_out');
      expect(result.detail).toContain(LOGGED_IN_SENTINEL);
    }
  });

  it('fails closed with layout_changed when transaction cards are missing', () => {
    const html = '<html><body><h2>TRANSACTIONS HISTORY</h2><div class="empty">No data</div></body></html>';
    const result = parseEgPayment(html);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('layout_changed');
    }
  });
});
