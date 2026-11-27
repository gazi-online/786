import { describe, it, expect } from 'vitest';
import { scanContent } from '../../../scripts/scan-pii-secrets.mjs';
import {
  generateSyntheticPhone,
  generateSyntheticTxnId,
  generateSyntheticOrderId,
  generateSyntheticOperatorRef,
  generateSyntheticRetailerCode,
} from '@walletsync/contract';

interface ScannerViolation {
  file: string;
  line: number;
  rule: string;
}

describe('Step 2 Hardening: PII & Secrets Scanner Allowlist Test', () => {
  it('passes on valid generator outputs in fixture and application contexts', () => {
    const validPhone = generateSyntheticPhone(1); // 5000000001
    const validTxnId = generateSyntheticTxnId(1); // 55000001
    const validOrderId = generateSyntheticOrderId(1); // 55500000000001
    const validOpRef = generateSyntheticOperatorRef(1); // OPR0000000001
    const validRetailer = generateSyntheticRetailerCode(1); // SYNRET0001

    const fixtureContent = [
      `<b>${validRetailer}</b> | Demo Merchant 1`,
      `<td>${validTxnId}</td><td>${validPhone}</td>`,
      `Order ID: ${validOrderId}`,
      `/transaction_receipt/${validOrderId}`,
      `Operator Ref : ${validOpRef}`,
      `receivedBy=Demo%20Merchant%201`,
    ].join('\n');

    const violations = scanContent(fixtureContent, 'fixtures/simplewallet/test.html');
    expect(violations.length).toBe(0);
  });

  it('fails with violation when a fixture contains a non-generator 10-digit customer number', () => {
    // Deliberately non-generator 10-digit number (e.g. 4000000001 or 3000000001)
    const badSyntheticNumber = '4' + '0000' + '00001';
    const fixtureWithBadPhone = `<td>55000001</td><td>${badSyntheticNumber}</td>`;

    const violations: ScannerViolation[] = scanContent(fixtureWithBadPhone, 'fixtures/simplewallet/test.html');
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v: ScannerViolation) => v.rule.includes('Non-allowlisted 10-digit customer number'))).toBe(true);
  });

  it('fails with violation when a fixture contains a non-generator Order ID or Operator Ref', () => {
    const badOrderIdFixture = 'Order ID: 1234567890';
    const badOpRefFixture = 'Operator Ref : INVALID_REF_999';

    const orderViolations: ScannerViolation[] = scanContent(badOrderIdFixture, 'fixtures/egpayment/test.html');
    expect(orderViolations.length).toBeGreaterThan(0);
    expect(orderViolations.some((v: ScannerViolation) => v.rule.includes('Non-allowlisted EG Payment Order ID'))).toBe(true);

    const opViolations: ScannerViolation[] = scanContent(badOpRefFixture, 'fixtures/egpayment/test.html');
    expect(opViolations.length).toBeGreaterThan(0);
    expect(opViolations.some((v: ScannerViolation) => v.rule.includes('Non-allowlisted Operator Reference'))).toBe(true);
  });

  it('fails with violation when any file contains a real Indian mobile series number [6-9]xxxxxxxxx', () => {
    // Invented runtime test number starting with 9
    const testIndianNumber = '9' + '0000' + '00009';
    const content = `User submitted error on phone ${testIndianNumber}`;

    const violations: ScannerViolation[] = scanContent(content, 'apps/web/lib/test.ts');
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v: ScannerViolation) => v.rule.includes('Real Indian mobile number pattern'))).toBe(true);
  });
});

