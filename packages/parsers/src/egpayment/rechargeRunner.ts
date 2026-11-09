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
  circle?: string | undefined;
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

export function findMobileInput(doc: Document): HTMLInputElement | null {
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

export interface PortalTelecomDetails {
  operator?: string | undefined;
  circle?: string | undefined;
}

/**
 * Reads the auto-detected or selected Operator and Circle from the official EG Payment portal DOM.
 * Supports standard <select>, <input>, and custom dropdown markup.
 */
export function extractPortalOperatorAndCircle(doc: Document): PortalTelecomDetails {
  let operator: string | undefined;
  let circle: string | undefined;

  // 1. Try Operator Select
  const opSelect = doc.querySelector<HTMLSelectElement>(
    'select#operator, select[name="operator"], select[name*="operator" i], select#op, select[name="op"]',
  );
  if (opSelect) {
    const opt = opSelect.options[opSelect.selectedIndex];
    const text = (opt?.text || '').trim();
    const val = (opSelect.value || '').trim();
    if (text && !/select\s*operator/i.test(text) && val !== '' && val !== '0') {
      operator = text;
    }
  }

  // 2. Try Operator Input (including readonly / disabled populated inputs)
  if (!operator) {
    const opInput = doc.querySelector<HTMLInputElement>(
      'input#operator, input[name="operator"], input[name*="operator" i], input#op, input[name="op"]',
    );
    if (opInput) {
      const val = (opInput.value || '').trim();
      if (val && !/select\s*operator/i.test(val)) {
        operator = val;
      }
    }
  }

  // 3. Try custom dropdown / text container near Operator label
  if (!operator) {
    const labels = Array.from(doc.querySelectorAll('label, div, p, span, h5, h6, strong'));
    for (const opLabel of labels) {
      if ((opLabel.textContent || '').trim().toLowerCase() === 'operator') {
        const parent = opLabel.closest('.form-group, .mb-3, .col-md-6, div') || opLabel.parentElement;
        const candidate = parent?.querySelector(
          '.select2-selection__rendered, .chosen-single, .dropdown-toggle, input, select, .form-control, p, span',
        ) || opLabel.nextElementSibling;
        const txt = (
          (candidate as HTMLInputElement)?.value ||
          candidate?.textContent ||
          ''
        ).trim();
        if (txt && !/select\s*operator/i.test(txt) && txt.length < 50) {
          operator = txt;
          break;
        }
      }
    }
  }

  // 4. Try Circle Select
  const circleSelect = doc.querySelector<HTMLSelectElement>(
    'select#circle, select[name="circle"], select[name*="circle" i]',
  );
  if (circleSelect) {
    const opt = circleSelect.options[circleSelect.selectedIndex];
    const text = (opt?.text || '').trim();
    const val = (circleSelect.value || '').trim();
    if (text && !/select\s*circle/i.test(text) && val !== '' && val !== '0') {
      circle = text;
    }
  }

  // 5. Try Circle Input
  if (!circle) {
    const circleInput = doc.querySelector<HTMLInputElement>(
      'input#circle, input[name="circle"], input[name*="circle" i], input#circle_name, input[name="circle_name"]',
    );
    if (circleInput) {
      const val = (circleInput.value || '').trim();
      if (val && !/select\s*circle/i.test(val)) {
        circle = val;
      }
    }
  }

  // 6. Try custom dropdown / text container near Circle label
  if (!circle) {
    const labels = Array.from(doc.querySelectorAll('label, div, p, span, h5, h6, strong'));
    for (const circleLabel of labels) {
      if ((circleLabel.textContent || '').trim().toLowerCase() === 'circle') {
        const parent = circleLabel.closest('.form-group, .mb-3, .col-md-6, div') || circleLabel.parentElement;
        const candidate = parent?.querySelector(
          '.select2-selection__rendered, .chosen-single, .dropdown-toggle, input, select, .form-control, p, span',
        ) || circleLabel.nextElementSibling;
        const txt = (
          (candidate as HTMLInputElement)?.value ||
          candidate?.textContent ||
          ''
        ).trim();
        if (txt && !/select\s*circle/i.test(txt) && txt.length < 50) {
          circle = txt;
          break;
        }
      }
    }
  }

  return { operator, circle };
}

/**
 * Executes form filling, M-Pin confirmation, and QR code handling on EG Payment Prepaid Recharge
 */
export async function executeEgPaymentRecharge(
  doc: Document,
  order: EgPaymentRechargeOrderParams,
): Promise<RechargeExecutionResult> {
  // 1. Check logged-in state
  const curUrl = (doc.defaultView?.location?.href || '').toLowerCase();
  const isLoginPage =
    curUrl.includes('/login') ||
    curUrl.includes('/users/login') ||
    (curUrl.includes('/logout') && !curUrl.includes('/recharge'));

  // Check for visible SweetAlert or modal indicating session expired (never match raw script tags!)
  const visibleExpiredModal = Array.from(
    doc.querySelectorAll('.swal-overlay--show-modal, .swal-modal, .modal.show, .modal.in, div[role="dialog"]'),
  ).some((el) => {
    const text = (el.textContent || '').toUpperCase();
    return text.includes('SESSION EXPIRED') || text.includes('LOGIN AGAIN');
  });

  if (isLoginPage || visibleExpiredModal) {
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
    // If mobile input is missing, check if this is an unauthenticated login screen or banner
    const hasLoginFields = Boolean(
      doc.querySelector('input[type="password"], input[name*="password" i], input[placeholder*="Password" i]'),
    );
    const visibleAuthText = Array.from(doc.querySelectorAll('div, p, span, h1, h2, h3, h4'))
      .filter((el) => el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE')
      .some((el) => {
        const txt = (el.textContent || '').trim().toUpperCase();
        return (
          txt.includes('PLEASE LOG IN') ||
          txt.includes('SIGN IN TO CONTINUE') ||
          txt.includes('LOGIN TO YOUR ACCOUNT')
        );
      });

    if (isLoginPage || hasLoginFields || visibleAuthText) {
      return {
        ok: false,
        status: 'failed',
        failureCode: 'logged_out',
        failureDetail: 'EG Payment portal is not logged in. Please log in to egpayment.com and try again.',
      };
    }

    return {
      ok: false,
      status: 'failed',
      failureCode: 'element_not_found',
      failureDetail: 'Mobile number input element ("Enter Mobile Number") not found on page',
    };
  }

  // 4. Fill Mobile Number and trigger events for operator auto-fetch
  mobileInput.focus();
  try {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      doc.defaultView?.HTMLInputElement?.prototype || Object.getPrototypeOf(mobileInput),
      'value',
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(mobileInput, order.customerNo);
    } else {
      mobileInput.value = order.customerNo;
    }
  } catch {
    mobileInput.value = order.customerNo;
  }
  mobileInput.dispatchEvent(new Event('input', { bubbles: true }));
  mobileInput.dispatchEvent(new Event('change', { bubbles: true }));
  try {
    mobileInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: '0' }));
  } catch {
    // ignore
  }
  mobileInput.dispatchEvent(new Event('blur', { bubbles: true }));

  // Brief pause for AJAX auto-detection of Operator & Circle
  await new Promise((resolve) => setTimeout(resolve, 400));

  // 5. Enforce target operator (if merchant corrected or confirmed an operator on our platform)
  const operatorSelect = doc.querySelector<HTMLSelectElement>(
    'select#operator, select[name="operator"], select[name*="operator" i]',
  );
  const targetOp = order.operator.toLowerCase().trim();
  if (operatorSelect) {
    const options = Array.from(operatorSelect.options);
    const selectedText = operatorSelect.options[operatorSelect.selectedIndex]?.text?.toLowerCase().trim() || '';
    const selectedVal = operatorSelect.value.toLowerCase().trim();

    // If current portal selection does not match merchant's choice, update it
    if (!selectedText.includes(targetOp) && !selectedVal.includes(targetOp)) {
      const matchedOption = options.find((opt) => {
        const text = opt.text.toLowerCase().trim();
        const val = opt.value.toLowerCase().trim();
        return text.includes(targetOp) || val.includes(targetOp);
      });
      if (matchedOption) {
        operatorSelect.value = matchedOption.value;
        operatorSelect.dispatchEvent(new Event('input', { bubbles: true }));
        operatorSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }
  const operatorInput = doc.querySelector<HTMLInputElement>(
    'input#operator, input[name="operator"], input[name*="operator" i]',
  );
  if (operatorInput && !operatorInput.value.toLowerCase().includes(targetOp)) {
    const opNames: Record<string, string> = { AIRTEL: 'Airtel', JIO: 'Jio', VI: 'Vi', BSNL: 'BSNL' };
    operatorInput.value = opNames[order.operator.toUpperCase()] || order.operator;
    operatorInput.dispatchEvent(new Event('input', { bubbles: true }));
    operatorInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // 5.1 Enforce target circle (if merchant corrected or selected circle on our platform)
  const targetCircle = (order.circle || 'West Bengal').toLowerCase().trim();
  const circleSelect = doc.querySelector<HTMLSelectElement>(
    'select#circle, select[name="circle"], select[name*="circle" i]',
  );
  if (circleSelect) {
    const options = Array.from(circleSelect.options);
    const selectedText = circleSelect.options[circleSelect.selectedIndex]?.text?.toLowerCase().trim() || '';
    const selectedVal = circleSelect.value.toLowerCase().trim();

    if (!selectedText.includes(targetCircle) && !selectedVal.includes(targetCircle)) {
      const matchedOption = options.find((opt) => {
        const text = opt.text.toLowerCase().trim();
        const val = opt.value.toLowerCase().trim();
        return text.includes(targetCircle) || val.includes(targetCircle);
      });
      if (matchedOption) {
        circleSelect.value = matchedOption.value;
        circleSelect.dispatchEvent(new Event('input', { bubbles: true }));
        circleSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }
  const circleInput = doc.querySelector<HTMLInputElement>(
    'input#circle, input[name="circle"], input[name*="circle" i]',
  );
  if (circleInput && !circleInput.value.toLowerCase().includes(targetCircle)) {
    circleInput.value = order.circle || 'West Bengal';
    circleInput.dispatchEvent(new Event('input', { bubbles: true }));
    circleInput.dispatchEvent(new Event('change', { bubbles: true }));
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
