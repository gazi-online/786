/**
 * SimpleWallet Recharge Form Automation Runner
 *
 * Real-world flow verified from official portal recording:
 * 1. Navigate to MobileRecharge.aspx?mID=822&PID=821
 * 2. If operator selection list is visible: click matching operator card (VI, Airtel, BSNL, JIO)
 * 3. Form fields appear: fill Mobile No and Amount (in rupees)
 * 4. Verify input values round-trip
 * 5. Click green 'Recharge' button
 * 6. Modal appears: 'Confirm Transaction' with 'Pay Now' button -> click 'Pay Now'
 * 7. Alert dialog appears: 'Transaction accepted, Trn No: ...' with 'OK' button -> click 'OK'
 * 8. Return { ok: true, status: 'submitted', portalTrnId }
 */

export interface SimpleWalletRechargeOrderParams {
  customerNo: string;
  operator: string;
  amountPaise: number;
}

export type RechargeExecutionResult =
  | {
      ok: true;
      status: 'submitted';
      portalTrnId?: string;
    }
  | {
      ok: false;
      status: 'failed' | 'needs_manual_action';
      failureCode: string;
      failureDetail: string;
    };

/**
 * Helper to wait for a DOM element or condition asynchronously with timeout.
 */
async function waitForElement<T>(
  getter: () => T | null | undefined,
  maxTimeoutMs = 2000,
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

/**
 * Selects the target operator on SimpleWallet (Card/Icon click or Dropdown fallback).
 */
function selectOperator(doc: Document, operator: string): boolean {
  const targetOp = operator.toLowerCase().trim();

  // 1. Dropdown fallback if present
  const operatorSelect = (doc.getElementById('ddlOperator') ||
    doc.querySelector('select[name*="Operator" i], select[id*="ddlOperator" i]')) as HTMLSelectElement | null;
  if (operatorSelect && operatorSelect.options.length > 1) {
    const options = Array.from(operatorSelect.options);
    const matchedOption = options.find((opt) => {
      const text = opt.text.toLowerCase().trim();
      const val = opt.value.toLowerCase().trim();
      return text.includes(targetOp) || val.includes(targetOp);
    });
    if (matchedOption) {
      operatorSelect.value = matchedOption.value;
      operatorSelect.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }

  // 2. Click Operator Card / Icon (Real portal workflow)
  const allElements = Array.from(doc.querySelectorAll('img, a, button, div, span, p'));

  for (const el of allElements) {
    const isImg = el instanceof HTMLImageElement;
    const src = isImg ? el.src.toLowerCase() : '';
    const alt = isImg ? el.alt.toLowerCase() : '';
    const text = (el.textContent || '').trim().toLowerCase();

    let matches = false;
    if (targetOp.includes('jio')) {
      matches = src.includes('jio') || alt.includes('jio') || text === 'jio';
    } else if (targetOp.includes('airtel')) {
      matches = src.includes('airtel') || alt.includes('airtel') || text === 'airtel';
    } else if (targetOp.includes('bsnl')) {
      matches = src.includes('bsnl') || alt.includes('bsnl') || text.includes('bsnl');
    } else if (targetOp === 'vi' || targetOp.includes('vodafone') || targetOp.includes('idea')) {
      matches = src.includes('vi') || alt.includes('vi') || text === 'vi' || text.includes('vodafone');
    }

    if (matches) {
      const clickable = (el.closest('a, button, [onclick], .card, li, div[class*="operator" i]') || el) as HTMLElement;
      clickable.click();
      return true;
    }
  }

  return false;
}

function findMobileInput(doc: Document): HTMLInputElement | null {
  const direct = doc.querySelector(
    'input[id*="txtMobile" i], input[name*="Mobile" i], input[id*="mobile" i], input[placeholder*="Mobile" i], input[type="tel"]',
  ) as HTMLInputElement | null;
  if (direct) return direct;

  const labels = Array.from(doc.querySelectorAll('label, span, div, p'));
  const mobileLabel = labels.find((l) => /^mobile(?:\s*no)?[:.]?$/i.test((l.textContent || '').trim()));
  if (mobileLabel) {
    const parent = mobileLabel.parentElement || mobileLabel.closest('div');
    const input = parent?.querySelector('input');
    if (input) return input;
  }

  return null;
}

function findAmountInput(doc: Document): HTMLInputElement | null {
  const direct = doc.querySelector(
    'input[id*="txtAmount" i], input[name*="Amount" i], input[id*="amount" i], input[placeholder*="Amount" i]',
  ) as HTMLInputElement | null;
  if (direct) return direct;

  const labels = Array.from(doc.querySelectorAll('label, span, div, p'));
  const amountLabel = labels.find((l) => /^amount[:.]?$/i.test((l.textContent || '').trim()));
  if (amountLabel) {
    const parent = amountLabel.parentElement || amountLabel.closest('div');
    const input = parent?.querySelector('input');
    if (input) return input;
  }

  return null;
}

function findRechargeButton(doc: Document): HTMLElement | null {
  const candidates = Array.from(doc.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn'));
  const match = candidates.find((b) => {
    const text = (b.textContent || (b as HTMLInputElement).value || '').trim();
    return /^recharge$/i.test(text) || /^proceed\s*to\s*recharge$/i.test(text);
  });
  if (match) return match as HTMLElement;

  return (doc.getElementById('btnRecharge') as HTMLElement | null) ||
    (doc.getElementById('btnSubmit') as HTMLElement | null);
}

function findPayNowButton(doc: Document): HTMLElement | null {
  // 1. Check modal containers first
  const modals = Array.from(
    doc.querySelectorAll(
      '.modal.in, .modal.show, .modal, .bootstrap-dialog, div[role="dialog"], .modal-dialog',
    ),
  );
  for (const modal of modals) {
    const btns = Array.from(
      modal.querySelectorAll(
        'button, a.btn, a, input[type="button"], input[type="submit"]',
      ),
    );
    const payBtn = btns.find((b) =>
      /pay\s*now/i.test((b.textContent || (b as HTMLInputElement).value || '').trim()),
    );
    if (payBtn) return payBtn as HTMLElement;
  }

  // 2. Global button / link candidates
  const candidates = Array.from(doc.querySelectorAll('button, input[type="button"], input[type="submit"], a'));
  return (
    (candidates.find((b) => {
      const text = (b.textContent || (b as HTMLInputElement).value || '').trim();
      return /pay\s*now/i.test(text);
    }) as HTMLElement) || null
  );
}

function findOkButton(doc: Document): HTMLElement | null {
  // 1. Exact icon class provided from live portal: 'bootstrap-dialog-button-icon glyphicon glyphicon-ok'
  const glyphiconOk = doc.querySelector('.glyphicon-ok, .bootstrap-dialog-button-icon');
  if (glyphiconOk) {
    const btn = glyphiconOk.closest('button, a, [role="button"], .btn');
    if (btn) return btn as HTMLElement;
  }

  // 2. Buttons inside BootstrapDialog or modal footer
  const dialogBtns = Array.from(
    doc.querySelectorAll(
      '.bootstrap-dialog-footer-buttons button, .bootstrap-dialog-footer-buttons .btn, .bootstrap-dialog .modal-footer button, .bootstrap-dialog button, .modal-footer button, .modal-dialog button',
    ),
  );
  const okDialogBtn = dialogBtns.find((b) => {
    const text = (b.textContent || (b as HTMLInputElement).value || '').trim();
    return /^ok$/i.test(text) || text.includes('OK') || b.querySelector('.glyphicon-ok') !== null;
  });
  if (okDialogBtn) return okDialogBtn as HTMLElement;

  // 3. Fallback: Any button with 'OK' text
  const candidates = Array.from(doc.querySelectorAll('button, input[type="button"], input[type="submit"], a'));
  return (
    (candidates.find((b) => {
      const text = (b.textContent || (b as HTMLInputElement).value || '').trim();
      return /^ok$/i.test(text);
    }) as HTMLElement) || null
  );
}

function dismissAnyOpenModal(doc: Document) {
  try {
    const closeBtns = Array.from(
      doc.querySelectorAll(
        '.modal.in [data-dismiss="modal"], .bootstrap-dialog.in [data-dismiss="modal"], .modal .close, .bootstrap-dialog .close, button.btn-close',
      ),
    );
    for (const cb of closeBtns) {
      (cb as HTMLElement).click();
    }
    const backdrops = doc.querySelectorAll('.modal-backdrop');
    backdrops.forEach((b) => b.remove());
  } catch {
    // ignore DOM cleanup errors
  }
}

/**
 * Executes form filling and multi-step submission on SimpleWallet MobileRecharge.aspx
 */
export async function executeSimpleWalletRecharge(
  doc: Document,
  order: SimpleWalletRechargeOrderParams,
): Promise<RechargeExecutionResult> {
  // 1. Check logged-in state (URL, password fields, or session-expired text)
  const currentUrl = doc.location?.href?.toLowerCase() || '';
  const isLoginPageUrl =
    currentUrl.includes('/login') ||
    currentUrl.includes('/default.aspx') ||
    currentUrl.includes('/logout');

  const passwordField = doc.querySelector(
    'input[type="password"], input[id*="txtPassword" i], input[name*="Password" i]',
  );
  const loginBtn = doc.querySelector('#btnLogin, #btnSignIn, input[value*="Login" i]');

  const bodyText = doc.body?.textContent?.toUpperCase() || '';
  const hasLoggedOutText =
    bodyText.includes('PLEASE LOG IN') ||
    bodyText.includes('SIGN IN TO CONTINUE') ||
    bodyText.includes('SESSION EXPIRED') ||
    bodyText.includes('INVALID SESSION');

  if (isLoginPageUrl || (passwordField && loginBtn) || hasLoggedOutText) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'logged_out',
      failureDetail:
        'Official portal is not logged in. Please log in to SimpleWallet (https://simplewallet.in/web/MobileRecharge.aspx?mID=822&PID=821) and try again.',
    };
  }

  // 2. Check for unexpected challenge (CAPTCHA / OTP modal)
  const captchaElem = doc.querySelector('[id*="captcha"], [class*="captcha"], [id*="recaptcha"]');
  const otpModal = doc.querySelector('[id*="otpModal"], [class*="otp-modal"]');
  if (captchaElem || otpModal) {
    return {
      ok: false,
      status: 'needs_manual_action',
      failureCode: 'challenge_detected',
      failureDetail: 'CAPTCHA or OTP challenge detected on portal form',
    };
  }

  // 3. Operator Selection (Card/Icon Click or Dropdown)
  let mobileInput = findMobileInput(doc);
  if (!mobileInput) {
    // Select operator card first
    const selected = selectOperator(doc, order.operator);
    if (!selected) {
      return {
        ok: false,
        status: 'failed',
        failureCode: 'operator_mismatch',
        failureDetail: `Operator '${order.operator}' not available on SimpleWallet portal`,
      };
    }

    // Wait for form inputs to mount after operator selection
    mobileInput = await waitForElement(() => findMobileInput(doc), 2000, 100);
  } else {
    // If mobileInput is already visible, still select or confirm operator
    const selected = selectOperator(doc, order.operator);
    if (!selected) {
      return {
        ok: false,
        status: 'failed',
        failureCode: 'operator_mismatch',
        failureDetail: `Operator '${order.operator}' not available on SimpleWallet portal`,
      };
    }
  }

  if (!mobileInput) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'element_not_found',
      failureDetail: 'Mobile number input element not found on page after operator selection',
    };
  }

  // 4. Locate Amount input
  const amountInput = await waitForElement(() => findAmountInput(doc), 2000, 200);
  if (!amountInput) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'element_not_found',
      failureDetail: 'Amount input element not found on page',
    };
  }

  // 5. Fill Mobile Number
  mobileInput.value = order.customerNo;
  mobileInput.dispatchEvent(new Event('input', { bubbles: true }));
  mobileInput.dispatchEvent(new Event('change', { bubbles: true }));

  // 6. Fill Amount in Rupees (integer e.g. '299')
  const rupees = Math.round(order.amountPaise / 100).toString();
  amountInput.value = rupees;
  amountInput.dispatchEvent(new Event('input', { bubbles: true }));
  amountInput.dispatchEvent(new Event('change', { bubbles: true }));

  // 7. Verify inputs before clicking
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

  // 8. Locate & Click Recharge Button
  const rechargeBtn = findRechargeButton(doc);
  if (!rechargeBtn) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'element_not_found',
      failureDetail: 'Recharge submit button element not found on page',
    };
  }

  rechargeBtn.click();

  // 9. Handle "Confirm Transaction" Modal ("Pay Now" button)
  const payNowBtn = await waitForElement(() => findPayNowButton(doc), 4000, 250);
  if (payNowBtn) {
    payNowBtn.click();
    try {
      payNowBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } catch {
      // ignore
    }
  }

  // 10. Handle Success Alert Message ("OK" button & Trn No extraction)
  let portalTrnId: string | undefined;
  const okBtn = await waitForElement(() => {
    const btn = findOkButton(doc);
    if (btn) {
      const match =
        doc.body?.textContent?.match(/Trn\s*No:?\s*(\d+)/i) ||
        doc.body?.textContent?.match(/Transaction\s*accepted.*?(\d{6,})/i);
      if (match) portalTrnId = match[1];
      return btn;
    }
    return null;
  }, 5000, 300);

  if (okBtn) {
    okBtn.click();
    try {
      okBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } catch {
      // ignore
    }

    // Ensure recharge modal and backdrops close cleanly
    await new Promise((resolve) => setTimeout(resolve, 300));
    dismissAnyOpenModal(doc);
  }

  return {
    ok: true,
    status: 'submitted',
    portalTrnId,
  };
}
