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
    expect(result.pageTotals.amountPaise).toBe(1775000); // Synthetic page total

    // Test golden row 1: Order ID 55500000000001
    const row1 = result.rows[0]!;
    expect(row1.txnId).toBe('55500000000001');
    expect(row1.source).toBe('egpayment');
    expect(row1.serviceName).toBe('Vi');
    expect(row1.customerNo).toBe('5000000012');
    expect(row1.amountPaise).toBe(11000);
    expect(row1.discountPaise).toBe(220);
    expect(row1.discountPct).toBe(2);
    expect(row1.status).toBe('success');
    expect(row1.operatorRef).toBe('OPR0000000001');
    expect(row1.occurredAt).toBe('2025-01-01T10:01:00+05:30');

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

  describe('txnId canonical source pinning and fail-closed mismatch enforcement', () => {
    const buildCardHtml = (hrefId: string | null, textOrderId: string | null) => {
      const hrefAttr = hrefId ? `href="https://egpayment.com/users/transaction_receipt/${hrefId}"` : 'href="https://egpayment.com/users/other"';
      const orderIdEl = textOrderId ? `<h4 class="left">Order ID: ${textOrderId}</h4>` : '<h4 class="left">No Order ID</h4>';
      return `
        <html><body><h2>TRANSACTIONS HISTORY</h2>
        <div id="walletHistory">
          <a ${hrefAttr}>
            <div class="wallet-card-form"><div class="row">
              <div class="walletHistoryFooter">${orderIdEl}<h3 class="right">₹100</h3></div>
              <div class="walletHistoryData"><div class="left"><h3>Vi</h3><span>5000000001</span></div><p class="right"><button class="btn btn-success">SUCCESS</button></p></div>
              <div class="walletHistoryFooter"><h4 class="left">Operator Ref : OPR0000000001</h4><h4 class="right">01/01/2025, 10:00 AM</h4></div>
            </div></div>
          </a>
        </div>
        </body></html>
      `;
    };

    it('pins current source: extracts txnId when Order ID text is present', () => {
      const html = buildCardHtml('55500000000077', '55500000000077');
      const result = parseEgPayment(html);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows[0]?.txnId).toBe('55500000000077');
      }
    });

    it('pins fallback source: extracts txnId from receipt href when Order ID text is absent', () => {
      const html = buildCardHtml('55500000000088', null);
      const result = parseEgPayment(html);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.rows[0]?.txnId).toBe('55500000000088');
      }
    });

    it('fails closed when Order ID text and receipt link ID differ (no silent pick)', () => {
      const html = buildCardHtml('55500000000011', '55500000000022');
      const result = parseEgPayment(html);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('layout_changed');
        expect(result.detail).toContain('ID mismatch on card');
        expect(result.detail).toContain('55500000000022');
        expect(result.detail).toContain('55500000000011');
      }
    });
  });
});
