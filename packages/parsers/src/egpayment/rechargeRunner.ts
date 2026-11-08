import type { RechargeExecutionResult } from '../simplewallet/rechargeRunner';

/**
 * EG Payment Recharge Form Automation Runner (Milestone R5)
 * Matches live portal at https://egpayment.com/users/recharge/Prepaid
 *
 * Core Security & Invariants:
 * 1. Read-only validation before any form interaction.
 * 2. Strict fingerprinting of form elements: Mobile, Operator, Amount, Submit button.
 * 3. Never blind-submits: verifies input values before click.
 * 4. Fills 4-digit M-Pin in the "Confirm Number & Amount" confirmation modal.
 * 5. Handles insufficient balance: clicks "Pay ₹ ... to proceed" and captures dynamic UPI QR code.
 * 6. Detects CAPTCHA, OTP, or auth challenges -> fails with 'needs_manual_action'.
 */

export interface EgPaymentRechargeOrderParams {
  customerNo: string;
  operator: string;
  amountPaise: number;
  mPin?: string;
  onQrCodeDetected?: (qrData: { qrDataUrl: string; amountText?: string | undefined; timerText?: string | undefined }) => void;
}

async function waitForElement<T>(
  getter: () => T | null | undefined,
  maxTimeoutMs = 3000,
  intervalMs = 100,
): Promise<T | null> {
  const isTest = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
  const effectiveTimeout = isTest ? Math.min(maxTimeoutMs, 250) : maxTimeoutMs;
  const effectiveInterval = isTest ? 25 : intervalMs;

  const startTime = Date.now();
  while (Date.now() - startTime < effectiveTimeout) {
    const el = getter();
    if (el) return el;
    await new Promise((resolve) => setTimeout(resolve, effectiveInterval));
  }
  return null;
}

function isElementVisible(el: HTMLElement): boolean {
  if (!el) return false;
  try {
    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
      return false;
    }
  } catch {
    // ignore
  }
  return true;
}

function findMobileInput(doc: Document): HTMLInputElement | null {
  const byPlaceholder = doc.querySelector<HTMLInputElement>(
    'input[placeholder*="Enter Mobile" i], input[placeholder*="Mobile Number" i], input[placeholder*="Mobile" i]',
  );
  if (byPlaceholder) return byPlaceholder;

  return ((doc.getElementById('mobile') as HTMLInputElement | null) ||
    doc.querySelector<HTMLInputElement>('input[name="mobile"], input[name*="mobile" i], input[type="tel"]')) || null;
}

function findAmountInput(doc: Document): HTMLInputElement | null {
  const byPlaceholder = doc.querySelector<HTMLInputElement>(
    'input[placeholder*="Enter Amount" i], input[placeholder*="Amount" i]',
  );
  if (byPlaceholder) return byPlaceholder;

  return ((doc.getElementById('amount') as HTMLInputElement | null) ||
    doc.querySelector<HTMLInputElement>('input[name="amount"], input[name*="amount" i]')) || null;
}

function findSubmitButton(doc: Document): HTMLElement | null {
  const buttons = Array.from(doc.querySelectorAll<HTMLElement>('button, input[type="submit"], a.btn'));
  const submitBtn = buttons.find((b) => {
    const text = (b.textContent || (b as HTMLInputElement).value || '').trim();
    return /^submit$/i.test(text) || /proceed\s*to\s*recharge/i.test(text);
  });
  if (submitBtn) return submitBtn;

  return (doc.getElementById('btnSubmit') ||
    doc.querySelector<HTMLElement>('button[type="submit"]')) || null;
}

function findMPinModal(doc: Document): { pinInput: HTMLInputElement; confirmBtn: HTMLElement } | null {
  const dialogs = Array.from(
    doc.querySelectorAll('.modal.show, .modal.in, .modal, div[role="dialog"], .dialog, .popup, body > div'),
  );

  for (const dlg of dialogs) {
    const text = dlg.textContent || '';
    if (text.includes('Confirm Number & Amount') || text.includes('M Pin') || text.includes('Digit M Pin')) {
      const pinInput = dlg.querySelector<HTMLInputElement>(
        'input[placeholder*="M Pin" i], input[placeholder*="Pin" i], input[type="password"], input[name*="pin" i], input[id*="pin" i]',
      );
      const btns = Array.from(dlg.querySelectorAll<HTMLElement>('button, a, input[type="button"], [role="button"]'));
      const confirmBtn = btns.find((b) => {
        const bText = (b.textContent || (b as HTMLInputElement).value || '').trim().toUpperCase();
        return bText === 'CONFIRM' || bText.includes('CONFIRM');
      });

      if (pinInput && confirmBtn) {
        return { pinInput, confirmBtn };
      }
    }
  }

  // Fallback direct global selectors
  const pinInput = doc.querySelector<HTMLInputElement>(
    'input[placeholder*="M Pin" i], input[placeholder*="Digit M Pin" i]',
  );
  const confirmBtn = Array.from(doc.querySelectorAll<HTMLElement>('button, a, input[type="button"]')).find((b) =>
    (b.textContent || '').trim().toUpperCase() === 'CONFIRM',
  );

  if (pinInput && confirmBtn) {
    return { pinInput, confirmBtn };
  }

  return null;
}

function findProcessTransactionPayButton(doc: Document): HTMLElement | null {
  const candidates = Array.from(doc.querySelectorAll<HTMLElement>('button, a, div[role="button"]'));
  return (
    candidates.find((b) => {
      const text = (b.textContent || '').trim();
      return /pay\s*₹?\s*[\d,.]+\s*to\s*proceed/i.test(text);
    }) || null
  );
}

function findQRCodeDetails(doc: Document): { qrDataUrl: string; amountText?: string | undefined; timerText?: string | undefined } | null {
  const dialogs = Array.from(doc.querySelectorAll('div, .modal, [role="dialog"]'));
  const qrDialog = dialogs.find((d) => (d.textContent || '').includes('Payment Processing') || (d.textContent || '').includes('Scan the QR'));

  const container = qrDialog || doc.body;
  if (!container) return null;

  // 1. Look for QR Image
  const imgs = Array.from(container.querySelectorAll<HTMLImageElement>('img'));
  const qrImg = imgs.find((img) => {
    const src = img.src || '';
    return src.includes('data:image') || src.includes('qr') || (img.width > 120 && img.height > 120);
  });

  let qrDataUrl = qrImg?.src || '';

  // 2. Look for Canvas QR
  if (!qrDataUrl) {
    const canvas = container.querySelector('canvas');
    if (canvas) {
      try {
        qrDataUrl = canvas.toDataURL('image/png');
      } catch {
        // ignore
      }
    }
  }

  // 3. Look for SVG QR
  if (!qrDataUrl) {
    const svg = container.querySelector('svg');
    if (svg && svg.clientWidth > 100) {
      try {
        const svgXml = new XMLSerializer().serializeToString(svg);
        qrDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgXml)}`;
      } catch {
        // ignore
      }
    }
  }

  if (!qrDataUrl) return null;

  // Extract timer
  const text = container.textContent || '';
  const timerMatch = text.match(/(\d{1,2}\s*[mM]\s*:\s*\d{1,2}\s*[sS])/i);
  const timerText = timerMatch?.[1] ? timerMatch[1].replace(/\s+/g, '') : undefined;

  // Extract amount from container or document body
  const fullText = text + ' ' + (doc.body?.textContent || '');
  const amountMatch = fullText.match(/₹\s*([\d,.]+)/i);
  const amountText = amountMatch?.[1] ? `₹${amountMatch[1]}` : undefined;

  return {
    qrDataUrl,
    ...(amountText ? { amountText } : {}),
    ...(timerText ? { timerText } : {}),
  };
}

/**
 * Executes form filling, M-Pin confirmation, and QR code handling on EG Payment Prepaid Recharge
 */
export async function executeEgPaymentRecharge(
  doc: Document,
  order: EgPaymentRechargeOrderParams,
): Promise<RechargeExecutionResult> {
  // 1. Check logged-in state
  const bodyText = doc.body?.textContent?.toUpperCase() || '';
  if (
    bodyText.includes('PLEASE LOG IN') ||
    bodyText.includes('SIGN IN TO CONTINUE') ||
    bodyText.includes('LOGIN TO YOUR ACCOUNT') ||
    bodyText.includes('SESSION EXPIRED')
  ) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'logged_out',
      failureDetail: 'EG Payment portal session is logged out. Please log in to egpayment.com and try again.',
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
  const mobileInput = await waitForElement(() => findMobileInput(doc), 3000, 100);
  if (!mobileInput) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'element_not_found',
      failureDetail: 'Mobile number input element ("Enter Mobile Number") not found on page',
    };
  }

  // 4. Fill Mobile Number and trigger events for operator auto-fetch
  mobileInput.focus();
  mobileInput.value = order.customerNo;
  mobileInput.dispatchEvent(new Event('input', { bubbles: true }));
  mobileInput.dispatchEvent(new Event('change', { bubbles: true }));
  mobileInput.dispatchEvent(new Event('blur', { bubbles: true }));

  // Brief pause for AJAX auto-detection of Operator & Circle
  await new Promise((resolve) => setTimeout(resolve, 350));

  // 5. If operator select exists and is still empty, manually select target operator
  const operatorSelect = doc.querySelector<HTMLSelectElement>(
    'select#operator, select[name="operator"], select[name*="operator" i]',
  );
  if (operatorSelect && (!operatorSelect.value || operatorSelect.value === '')) {
    const targetOp = order.operator.toLowerCase().trim();
    const options = Array.from(operatorSelect.options);
    const matchedOption = options.find((opt) => {
      const text = opt.text.toLowerCase().trim();
      const val = opt.value.toLowerCase().trim();
      return text.includes(targetOp) || val.includes(targetOp);
    });
    if (matchedOption) {
      operatorSelect.value = matchedOption.value;
      operatorSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // 6. Locate & Fill Amount input
  const amountInput = await waitForElement(() => findAmountInput(doc), 3000, 100);
  if (!amountInput) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'element_not_found',
      failureDetail: 'Amount input element ("Enter Amount") not found on page',
    };
  }

  const rupees = Math.round(order.amountPaise / 100).toString();
  amountInput.focus();
  amountInput.value = rupees;
  amountInput.dispatchEvent(new Event('input', { bubbles: true }));
  amountInput.dispatchEvent(new Event('change', { bubbles: true }));
  amountInput.dispatchEvent(new Event('blur', { bubbles: true }));

  // 7. Verify inputs
  if (mobileInput.value !== order.customerNo) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'verification_failed',
      failureDetail: 'Mobile input verification failed before submission',
    };
  }

  const parsedAmount = parseFloat(amountInput.value);
  if (isNaN(parsedAmount) || Math.round(parsedAmount * 100) !== order.amountPaise) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'verification_failed',
      failureDetail: 'Amount input verification failed before submission',
    };
  }

  // 8. Locate & Click Submit Button
  const submitButton = await waitForElement(() => findSubmitButton(doc), 3000, 100);
  if (!submitButton) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'element_not_found',
      failureDetail: 'Recharge Submit button not found on page',
    };
  }

  submitButton.click();
  try {
    submitButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  } catch {
    // ignore
  }

  // 9. Handle "Confirm Number & Amount" Modal (M-Pin Input)
  const mPinModal = await waitForElement(() => findMPinModal(doc), 5000, 200);
  if (mPinModal) {
    if (!order.mPin) {
      return {
        ok: false,
        status: 'needs_manual_action',
        failureCode: 'mpin_required',
        failureDetail: '4-digit M-Pin is required to confirm EG Payment recharge',
      };
    }

    mPinModal.pinInput.focus();
    mPinModal.pinInput.value = order.mPin;
    mPinModal.pinInput.dispatchEvent(new Event('input', { bubbles: true }));
    mPinModal.pinInput.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 150));

    mPinModal.confirmBtn.click();
    try {
      mPinModal.confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } catch {
      // ignore
    }
  }

  // 10. Check Outcome: Sufficient Balance vs "Process Transaction" QR Payment
  const outcomeResult = await waitForElement(() => {
    // Check for insufficient balance "Process Transaction" button
    const payProceedBtn = findProcessTransactionPayButton(doc);
    if (payProceedBtn && isElementVisible(payProceedBtn)) {
      return { type: 'qr_required', button: payProceedBtn };
    }

    // Check for direct QR modal
    const qrDetails = findQRCodeDetails(doc);
    if (qrDetails) {
      return { type: 'qr_active', details: qrDetails };
    }

    // Check for success alert / toast / text
    const text = doc.body?.textContent?.toLowerCase() || '';
    if (
      text.includes('recharge successful') ||
      text.includes('recharge submitted') ||
      text.includes('transaction accepted') ||
      text.includes('request accepted')
    ) {
      return { type: 'success' };
    }

    // Check for error
    if (text.includes('wrong m pin') || text.includes('invalid m pin') || text.includes('invalid pin')) {
      return { type: 'error', message: 'Official portal rejected: Invalid 4-Digit M-Pin' };
    }

    return null;
  }, 6000, 250);

  // If QR code payment is needed (insufficient wallet balance):
  if (outcomeResult && outcomeResult.type === 'qr_required' && outcomeResult.button) {
    outcomeResult.button.click();
    try {
      outcomeResult.button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } catch {
      // ignore
    }

    // Wait for "Payment Processing." modal with dynamic QR code
    const qrData = await waitForElement(() => findQRCodeDetails(doc), 6000, 250);
    if (qrData) {
      if (order.onQrCodeDetected) {
        order.onQrCodeDetected(qrData);
      }

      return {
        ok: false,
        status: 'needs_manual_action',
        failureCode: 'qr_payment_required',
        failureDetail: `Dynamic UPI QR code generated (${qrData.amountText || 'UPI'}). Please scan and pay from web app to complete.`,
      };
    }
  }

  if (outcomeResult && outcomeResult.type === 'qr_active' && outcomeResult.details) {
    if (order.onQrCodeDetected) {
      order.onQrCodeDetected(outcomeResult.details);
    }
    return {
      ok: false,
      status: 'needs_manual_action',
      failureCode: 'qr_payment_required',
      failureDetail: `Dynamic UPI QR code generated (${outcomeResult.details.amountText || 'UPI'}). Please scan and pay from web app to complete.`,
    };
  }

  if (outcomeResult && outcomeResult.type === 'error') {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'invalid_mpin',
      failureDetail: outcomeResult.message || 'Invalid 4-Digit M-Pin',
    };
  }

  return {
    ok: true,
    status: 'submitted',
  };
}
