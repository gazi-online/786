import type { ParseResult } from '@walletsync/contract';
import { parse as parseSimpleWallet, PARSER_VERSION as SW_VERSION } from './simplewallet/transactionHistory';
import { parseEgPayment, PARSER_VERSION as EG_VERSION } from './egpayment/transactionHistory';

export { parseSimpleWallet, SW_VERSION };
export { parseEgPayment, EG_VERSION };
export const PARSER_VERSION = '1.0.0';

// Auto-click engine for SimpleWallet (ADR 005)
export {
  verifySimpleWalletFingerprint,
  attemptAutoClick,
  MIN_AUTO_CLICK_INTERVAL_SECONDS,
  EXACT_EXPECTED_BUTTON_ID,
  EXACT_EXPECTED_PATH,
  EXPECTED_SENTINEL_TEXT,
  EXPECTED_FORM_ID,
  type FingerprintResult,
  type FingerprintFailureReason,
  type AutoClickOptions,
  type AutoClickExecutionResult,
} from './simplewallet/autoClick';

// Recharge automation runners (Milestone R3 & R5)
export {
  executeSimpleWalletRecharge,
  findRechargeRowInTable,
  parseMobileRechargeRows,
  parseMobileRechargeBalance,
  parseSimpleWalletHeaderStats,
  selectOperatorCard,
  type SimpleWalletPortalHeaderStats,
  type SimpleWalletRechargeOrderParams,
  type RechargeExecutionResult,
  type PortalRechargeRow,
} from './simplewallet/rechargeRunner';
export {
  executeEgPaymentRecharge,
  extractPortalOperatorAndCircle,
  findMobileInput as findEgPaymentMobileInput,
  cleanupStaleEgPaymentModals,
  closePaymentProcessingModal,
  confirmClosePaymentWindowAlert,
  closeProcessTransactionDrawer,
  resetPrepaidRechargeForm,
  type EgPaymentRechargeOrderParams,
  type PortalTelecomDetails,
} from './egpayment/rechargeRunner';

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
