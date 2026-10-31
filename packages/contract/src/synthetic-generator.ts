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
