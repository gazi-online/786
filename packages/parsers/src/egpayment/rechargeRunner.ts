import type { RechargeExecutionResult } from '../simplewallet/rechargeRunner';

/**
 * EG Payment Recharge Form Automation Runner
 *
 * Core Security & Invariants:
 * 1. Read-only validation before any form interaction.
 * 2. Strict fingerprinting of form elements: Mobile, Operator dropdown, Amount, Submit button.
 * 3. Never blind-submits: verifies all input values match target order before click.
 * 4. Detects CAPTCHA, OTP, or auth challenges -> fails with 'needs_manual_action'.
 * 5. Zero DOM injection or modification outside the standard form fields.
 */

export interface EgPaymentRechargeOrderParams {
  customerNo: string;
  operator: string;
  amountPaise: number;
}

/**
 * Executes form filling and submission on EG Payment /users/recharge
 */
export function executeEgPaymentRecharge(
  doc: Document,
  order: EgPaymentRechargeOrderParams,
): RechargeExecutionResult {
  // 1. Check logged-in state
  const bodyText = doc.body?.textContent?.toUpperCase() || '';
  if (
    bodyText.includes('PLEASE LOG IN') ||
    bodyText.includes('SIGN IN TO CONTINUE') ||
    bodyText.includes('LOGIN TO YOUR ACCOUNT')
  ) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'logged_out',
      failureDetail: 'EG Payment portal session is logged out',
    };
  }

  // 2. Check for unexpected challenge (CAPTCHA / OTP modal / Turnstile)
  const captchaElem = doc.querySelector(
    '[id*="captcha"], [class*="captcha"], [id*="recaptcha"], [class*="cf-turnstile"]',
  );
  const otpModal = doc.querySelector('[id*="otpModal"], [class*="otp-modal"], [id*="otp_form"]');
  if (captchaElem || otpModal) {
    return {
      ok: false,
      status: 'needs_manual_action',
      failureCode: 'challenge_detected',
      failureDetail: 'CAPTCHA or OTP challenge detected on portal form',
    };
  }

  // 3. Locate Mobile Number input
  const mobileInput = (doc.getElementById('mobile') ||
    doc.querySelector('input[name="mobile"], input[name*="mobile" i], input[type="tel"]')) as HTMLInputElement | null;

  if (!mobileInput) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'element_not_found',
      failureDetail: 'Mobile number input element not found on page',
    };
  }

  // 4. Locate Operator dropdown
  const operatorSelect = (doc.getElementById('operator') ||
    doc.querySelector('select[name="operator"], select[name*="operator" i]')) as HTMLSelectElement | null;

  if (!operatorSelect) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'element_not_found',
      failureDetail: 'Operator select dropdown element not found on page',
    };
  }

  // 5. Locate Amount input
  const amountInput = (doc.getElementById('amount') ||
    doc.querySelector('input[name="amount"], input[name*="amount" i]')) as HTMLInputElement | null;

  if (!amountInput) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'element_not_found',
      failureDetail: 'Amount input element not found on page',
    };
  }

  // 6. Locate Recharge Submit button
  const submitButton = (doc.getElementById('btnSubmit') ||
    doc.querySelector(
      'button[type="submit"], input[type="submit"], button[class*="btn-recharge" i], button[id*="recharge" i]',
    )) as HTMLElement | null;

  if (!submitButton) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'element_not_found',
      failureDetail: 'Recharge submit button element not found on page',
    };
  }

  // -------------------------------------------------------------------------
  // Fill Form Elements with event dispatching
  // -------------------------------------------------------------------------

  // Set Mobile Number
  mobileInput.value = order.customerNo;
  mobileInput.dispatchEvent(new Event('input', { bubbles: true }));
  mobileInput.dispatchEvent(new Event('change', { bubbles: true }));

  // Match Operator Option
  const targetOp = order.operator.toLowerCase().trim();
  const options = Array.from(operatorSelect.options);
  const matchedOption = options.find((opt) => {
    const text = opt.text.toLowerCase().trim();
    const val = opt.value.toLowerCase().trim();
    return text.includes(targetOp) || val.includes(targetOp);
  });

  if (!matchedOption) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'operator_mismatch',
      failureDetail: `Operator '${order.operator}' not available in EG Payment dropdown`,
    };
  }

  operatorSelect.value = matchedOption.value;
  operatorSelect.dispatchEvent(new Event('change', { bubbles: true }));

  // Set Amount in Rupees
  const rupees = (order.amountPaise / 100).toFixed(2);
  amountInput.value = rupees;
  amountInput.dispatchEvent(new Event('input', { bubbles: true }));
  amountInput.dispatchEvent(new Event('change', { bubbles: true }));

  // -------------------------------------------------------------------------
  // Verify inputs match intended order values before click
  // -------------------------------------------------------------------------
  if (mobileInput.value !== order.customerNo) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'verification_failed',
      failureDetail: 'Mobile input round-trip verification failed',
    };
  }

  const parsedAmount = parseFloat(amountInput.value);
  if (isNaN(parsedAmount) || Math.round(parsedAmount * 100) !== order.amountPaise) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'verification_failed',
      failureDetail: 'Amount input round-trip verification failed',
    };
  }

  // Click Submit Button
  submitButton.click();

  return {
    ok: true,
    status: 'submitted',
  };
}

