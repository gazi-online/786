/**
 * Reserved Synthetic Identifier Generator
 *
 * Synthetic numbers start with 5 so they do not match the [6-9]\d{9} pattern this repository's scanner forbids.
 */

// Phone: 10 digits starting with 5 (5000000001 - 5000009999)
export function generateSyntheticPhone(index: number): string {
  const padded = String(index).padStart(9, '0');
  return `5${padded}`;
}
export const SYNTHETIC_PHONE_REGEX = /^5\d{9}$/;
export function isSyntheticPhone(phone: string): boolean {
  return SYNTHETIC_PHONE_REGEX.test(phone.trim());
}

// Transaction ID (e.g. SimpleWallet Trn No): 8 digits starting with 55 (55000001 - 55999999)
export function generateSyntheticTxnId(index: number): string {
  const padded = String(index).padStart(6, '0');
  return `55${padded}`;
}
export const SYNTHETIC_TXN_ID_REGEX = /^55\d{6}$/;
export function isSyntheticTxnId(id: string): boolean {
  return SYNTHETIC_TXN_ID_REGEX.test(id.trim());
}

// Order ID / Receipt ID (e.g. EG Payment Order ID): 14 digits starting with 555 (55500000000001 - 55500000009999)
export function generateSyntheticOrderId(index: number): string {
  const padded = String(index).padStart(11, '0');
  return `555${padded}`;
}
export const SYNTHETIC_ORDER_ID_REGEX = /^555\d{11}$/;
export function isSyntheticOrderId(id: string): boolean {
  return SYNTHETIC_ORDER_ID_REGEX.test(id.trim());
}

// Operator Reference: OPR followed by 10 digits (OPR0000000001 - OPR0000009999)
export function generateSyntheticOperatorRef(index: number): string {
  const padded = String(index).padStart(10, '0');
  return `OPR${padded}`;
}
export const SYNTHETIC_OPERATOR_REF_REGEX = /^OPR\d{10}$/;
export function isSyntheticOperatorRef(ref: string): boolean {
  return SYNTHETIC_OPERATOR_REF_REGEX.test(ref.trim());
}

// Retailer Code: SYNRET followed by 4 digits (SYNRET0001 - SYNRET9999)
export function generateSyntheticRetailerCode(index: number): string {
  const padded = String(index).padStart(4, '0');
  return `SYNRET${padded}`;
}
export const SYNTHETIC_RETAILER_CODE_REGEX = /^SYNRET\d{4}$/;
export function isSyntheticRetailerCode(code: string): boolean {
  return SYNTHETIC_RETAILER_CODE_REGEX.test(code.trim());
}

// Merchant / User Name: Demo Merchant followed by index
export function generateSyntheticName(index: number): string {
  return `Demo Merchant ${index}`;
}
export const SYNTHETIC_NAME_REGEX = /^Demo Merchant \d+$/;
export function isSyntheticName(name: string): boolean {
  return SYNTHETIC_NAME_REGEX.test(name.trim());
}

// ---------------------------------------------------------------------------
// Synthetic Dates & Timestamps
// Reserved synthetic date: 2025-01-01 (formatted 01/01/2025 in portal fixtures)
// ---------------------------------------------------------------------------
export const SYNTHETIC_DATE_STR = '01/01/2025';
export const SYNTHETIC_ISO_DATE_PREFIX = '2025-01-01';
export const SYNTHETIC_DATE_REGEX = /^01\/01\/2025$/;
export const SYNTHETIC_ISO_DATE_REGEX = /^2025-01-01T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|\+05:30)$/;

export function generateSyntheticSimpleWalletDate(index: number): string {
  if (index === 1) return '01/01/2025 07:15:00 PM';
  if (index === 5) return '01/01/2025 12:00:00 PM';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `01/01/2025 01:${pad(index * 10)}:00 PM`;
}

export function generateSyntheticEgPaymentDate(index: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const minute = pad(index);
  return `01/01/2025, 10:${minute} AM`;
}

export function generateSyntheticIsoDate(index: number, source: 'simplewallet' | 'egpayment' = 'simplewallet'): string {
  if (source === 'simplewallet') {
    if (index === 1) return '2025-01-01T19:15:00+05:30';
    if (index === 5) return '2025-01-01T12:00:00+05:30';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `2025-01-01T13:${pad(index * 10)}:00+05:30`;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `2025-01-01T10:${pad(index)}:00+05:30`;
}

export function isSyntheticTimestamp(dateStr: string): boolean {
  const trimmed = dateStr.trim();
  return (
    trimmed.startsWith('01/01/2025') ||
    trimmed.startsWith('2025-01-01')
  );
}

// ---------------------------------------------------------------------------
// Synthetic Amounts & Totals
// Documented generator formulas for amounts, discounts, balances, and totals
// ---------------------------------------------------------------------------
export interface SyntheticAmountRow {
  amountRupees: string;
  amountPaise: number;
  discountPct: number;
  discountRupees: string;
  discountPaise: number;
}

export function generateSyntheticSimpleWalletRow(index: number): SyntheticAmountRow {
  const amountRupeesNum = index * 100; // 100, 200, 300, 400, 500
  const discountPct = 1.5;
  const discountRupeesNum = (amountRupeesNum * discountPct) / 100; // 1.50, 3.00, 4.50, 6.00, 7.50
  return {
    amountRupees: amountRupeesNum.toFixed(2),
    amountPaise: Math.round(amountRupeesNum * 100),
    discountPct,
    discountRupees: discountRupeesNum.toFixed(2),
    discountPaise: Math.round(discountRupeesNum * 100),
  };
}

export function generateSyntheticEgPaymentRow(index: number): SyntheticAmountRow {
  const amountRupeesNum = 100 + index * 10; // 110, 120, ..., 600
  const discountPct = 2.0;
  const discountRupeesNum = (amountRupeesNum * discountPct) / 100; // 2.20, 2.40, ..., 12.00
  return {
    amountRupees: amountRupeesNum.toFixed(2),
    amountPaise: Math.round(amountRupeesNum * 100),
    discountPct,
    discountRupees: discountRupeesNum.toFixed(2),
    discountPaise: Math.round(discountRupeesNum * 100),
  };
}

export const SYNTHETIC_BALANCES = {
  walletRupees: '500.00',
  walletPaise: 50000,
};

export const SYNTHETIC_SIMPLEWALLET_TOTALS = {
  amountRupees: '1500.00',
  amountPaise: 150000,
  discountRupees: '22.50',
  discountPaise: 2250,
};

export const SYNTHETIC_EGPAYMENT_TOTALS = {
  amountRupees: '17750.00',
  amountPaise: 1775000,
  discountRupees: '355.00',
  discountPaise: 35500,
};

// All synthetic amount numbers allowed in fixtures
export const ALLOWED_SYNTHETIC_AMOUNTS = new Set<string>([
  '0.00', '0',
  '50.00', '50', // mismatch test total
  '100.00', '100', // card test amount
  '1500.00', // SW grand total
  '22.50', // SW grand discount
  '500.00', // SW balance
  '17750.00', '17,750.00', // EG page total
  '355.00', // EG page comm total
]);

// Populate generator rows
for (let i = 1; i <= 5; i++) {
  const sw = generateSyntheticSimpleWalletRow(i);
  ALLOWED_SYNTHETIC_AMOUNTS.add(sw.amountRupees);
  ALLOWED_SYNTHETIC_AMOUNTS.add(sw.discountRupees);
}
for (let i = 1; i <= 50; i++) {
  const eg = generateSyntheticEgPaymentRow(i);
  ALLOWED_SYNTHETIC_AMOUNTS.add(eg.amountRupees);
  ALLOWED_SYNTHETIC_AMOUNTS.add(eg.discountRupees);
}

export function isSyntheticAmount(amount: string | number): boolean {
  const clean = String(amount).replace(/[₹,\s]/g, '');
  return ALLOWED_SYNTHETIC_AMOUNTS.has(clean);
}
