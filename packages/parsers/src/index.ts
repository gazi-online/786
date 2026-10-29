import type { ParseResult } from '@walletsync/contract';
import { parse as parseSimpleWallet, PARSER_VERSION as SW_VERSION } from './simplewallet/transactionHistory.js';
import { parseEgPayment, PARSER_VERSION as EG_VERSION } from './egpayment/transactionHistory.js';

export { parseSimpleWallet, SW_VERSION };
export { parseEgPayment, EG_VERSION };
export const PARSER_VERSION = '1.0.0';

/**
 * Unified parser entrypoint with auto-detection.
 * Inspects document indicators to dispatch to the correct portal connector.
 */
export function parse(html: string, portalHint?: 'simplewallet' | 'egpayment'): ParseResult {
  if (portalHint === 'egpayment') {
    return parseEgPayment(html);
  }
  if (portalHint === 'simplewallet') {
    return parseSimpleWallet(html);
  }

  // Auto-detection based on HTML fingerprint
  const lower = html.toLowerCase();
  if (lower.includes('egpayment') || lower.includes('/transaction_receipt/') || lower.includes('wallethistory')) {
    return parseEgPayment(html);
  }

  // Default to simplewallet
  return parseSimpleWallet(html);
}
