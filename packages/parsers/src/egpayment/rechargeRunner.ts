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
  waitForPaymentCompletion?: boolean;
  paymentWaitTimeoutMs?: number;
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
    const view = el.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
    const style = view?.getComputedStyle ? view.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) {
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

  const byIdOrName = ((doc.getElementById('mobile') as HTMLInputElement | null) ||
    doc.querySelector<HTMLInputElement>('input[name="mobile"], input[name*="mobile" i], input[type="tel"]')) || null;
  if (byIdOrName) return byIdOrName;

  // Search inside custom elements or shadow roots (e.g. ion-input)
  const customEls = Array.from(doc.querySelectorAll('ion-input, ion-item, .form-group, div'));
  for (const el of customEls) {
    if (el.shadowRoot) {
      const shadowInput = el.shadowRoot.querySelector<HTMLInputElement>(
        'input.native-input, input[placeholder*="Mobile" i], input',
      );
      if (shadowInput) return shadowInput;
    }
    const inner = el.querySelector<HTMLInputElement>('input.native-input, input[type="tel"], input[type="number"]');
    if (inner && (inner.placeholder?.toLowerCase().includes('mobile') || inner.name?.toLowerCase().includes('mobile') || inner.id?.toLowerCase().includes('mobile'))) {
      return inner;
    }
  }

  // Fallback: the first numeric or tel input in the recharge form
  const firstNumeric = doc.querySelector<HTMLInputElement>('input[type="tel"], input[type="number"]');
  if (firstNumeric) return firstNumeric;

  return null;
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

/**
 * Traverses all HTML elements including inside open Shadow DOM roots (e.g. Ionic ion-modal, ion-button)
 */
export function getAllNodes(doc: Document): HTMLElement[] {
  const result: HTMLElement[] = [];
  function traverse(node: Node) {
    if (node && (node.nodeType === 1 || node instanceof HTMLElement)) {
      const el = node as HTMLElement;
      result.push(el);
      if (el.shadowRoot) {
        for (const child of Array.from(el.shadowRoot.childNodes)) {
          traverse(child);
        }
      }
    }
    for (const child of Array.from(node.childNodes)) {
      traverse(child);
    }
  }
  if (doc.body) {
    traverse(doc.body);
  }
  return result;
}

export function findProcessTransactionPayButton(doc: Document): HTMLElement | null {
  const allNodes = getAllNodes(doc);

  // Strategy 1: Look inside any container titled / containing "Process Transaction"
  for (const el of allNodes) {
    const text = (el.textContent || '').trim().toLowerCase();
    if (text.includes('process transaction') && (text.includes('pay') || text.includes('proceed') || /₹|\d+/.test(text))) {
      // Look for real buttons or links inside the container
      const directButtons = Array.from(
        el.querySelectorAll<HTMLElement>('button, ion-button, a, [role="button"], .btn, input[type="button"]'),
      );
      const payBtn = directButtons.find((c) => {
        const cText = (c.textContent || (c as HTMLInputElement).value || '').trim().toLowerCase();
        return cText.includes('pay') && !cText.includes('close');
      });
      if (payBtn) {
        return payBtn;
      }
    }
  }

  // Strategy 2: Search any button/ion-button with text matching /pay\s*₹?\s*[\d,.]+/i
  const payRegex = /pay\s*₹?\s*[\d,.]+/i;
  for (const el of allNodes) {
    const isClickable =
      el.tagName === 'BUTTON' ||
      el.tagName === 'ION-BUTTON' ||
      el.tagName === 'A' ||
      el.getAttribute('role') === 'button' ||
      el.classList.contains('btn');
    if (isClickable) {
      const text = (el.textContent || (el as HTMLInputElement).value || '').trim().replace(/\s+/g, ' ');
      const containerText = (el.closest('.modal, .swal-modal, .swal2-modal, div')?.textContent || '').toLowerCase();
      // Do NOT mistake a button inside the active QR modal ("Payment Processing.") for a Process Transaction drawer button
      if (containerText.includes('payment processing')) continue;

      if (payRegex.test(text) && !text.toLowerCase().includes('close') && !text.toLowerCase().includes('process transaction')) {
        return el;
      }
    }
  }

  // Strategy 3: Any element matching payRegex that has a clickable parent or child
  for (const el of allNodes) {
    const text = (el.textContent || (el as HTMLInputElement).value || '').trim().replace(/\s+/g, ' ');
    const containerText = (el.closest('.modal, .swal-modal, .swal2-modal, div')?.textContent || '').toLowerCase();
    if (containerText.includes('payment processing')) continue;

    if (
      payRegex.test(text) &&
      !text.toLowerCase().includes('close') &&
      !text.toLowerCase().includes('process transaction') &&
      text.length < 50
    ) {
      const btn =
        el.closest<HTMLElement>('button, ion-button, a, [role="button"], .btn') ||
        el.querySelector<HTMLElement>('button, ion-button, a, [role="button"], .btn') ||
        el;
      return btn;
    }
  }

  return null;
}

export function findQRCodeDetails(
  doc: Document,
  fallbackAmountRupees?: string | number,
): {
  qrDataUrl: string;
  amountText?: string | undefined;
  timerText?: string | undefined;
} | null {
  const allNodes = getAllNodes(doc);

  const qrContainer = allNodes.find((el) => {
    const t = (el.textContent || '').toLowerCase();
    return (
      (t.includes('payment processing') ||
        t.includes('order expring in') ||
        t.includes('order expiring in') ||
        t.includes('scan the qr')) &&
      isElementVisible(el)
    );
  }) || allNodes.find((el) => {
    const t = (el.textContent || '').toLowerCase();
    return (
      t.includes('payment processing') ||
      t.includes('order expring in') ||
      t.includes('order expiring in') ||
      t.includes('scan the qr')
    );
  }) || doc.body;

  if (!qrContainer) return null;

  const isExcludedImage = (img: HTMLImageElement): boolean => {
    const src = (img.src || '').toLowerCase();
    const alt = (img.alt || '').toLowerCase();
    const className = (img.className || '').toLowerCase();
    const id = (img.id || '').toLowerCase();

    return (
      src.includes('logo') ||
      src.includes('banner') ||
      src.includes('brand') ||
      src.includes('egpayment') ||
      src.includes('eg-logo') ||
      src.includes('spinner') ||
      src.includes('loader') ||
      alt.includes('logo') ||
      alt.includes('brand') ||
      alt.includes('egpayment') ||
      alt.includes('eg payment') ||
      className.includes('logo') ||
      className.includes('spinner') ||
      className.includes('loader') ||
      id.includes('logo') ||
      id.includes('spinner')
    );
  };

  // 1. Look for genuine QR Image (must have QR indicators or full QR data URL, NOT a logo/spinner)
  const imgs = Array.from(qrContainer.querySelectorAll<HTMLImageElement>('img'));
  const allImgs = [
    ...imgs,
    ...allNodes.filter((n): n is HTMLImageElement => n.tagName?.toLowerCase() === 'img'),
  ];
  const qrImg = allImgs.find((img) => {
    if (isExcludedImage(img)) return false;

    const src = (img.src || '').toLowerCase();
    const alt = (img.alt || '').toLowerCase();
    const className = (img.className || '').toLowerCase();
    const id = (img.id || '').toLowerCase();

    return (
      src.includes('qr') ||
      src.includes('chart.googleapis.com') ||
      src.includes('qrserver.com') ||
      src.includes('quickchart') ||
      src.includes('barcode') ||
      alt.includes('qr') ||
      className.includes('qr') ||
      id.includes('qr') ||
      (src.startsWith('data:image') && src.length > 500)
    );
  });

  let qrDataUrl = '';
  if (qrImg) {
    if (qrImg.src.startsWith('data:image')) {
      qrDataUrl = qrImg.src;
    } else {
      try {
        const canvas = doc.createElement('canvas');
        canvas.width = qrImg.naturalWidth || qrImg.width || 250;
        canvas.height = qrImg.naturalHeight || qrImg.height || 250;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(qrImg, 0, 0);
          qrDataUrl = canvas.toDataURL('image/png');
        } else {
          qrDataUrl = qrImg.src;
        }
      } catch {
        qrDataUrl = qrImg.src;
      }
    }
  }

  // 2. Look for Canvas QR
  if (!qrDataUrl) {
    const canvases = allNodes.filter((n): n is HTMLCanvasElement => n.tagName?.toLowerCase() === 'canvas');
    for (const canvas of canvases) {
      try {
        if ((canvas.width > 50 && canvas.height > 50) || canvas.clientWidth > 50) {
          const data = canvas.toDataURL('image/png');
          if (data && data.length > 30) {
            qrDataUrl = data;
            break;
          }
        }
      } catch {
        // ignore
      }
    }
  }

  // 3. Look for SVG QR (ensure it has QR matrix paths/rects, not just a simple icon)
  if (!qrDataUrl) {
    const svgs = allNodes.filter((n): n is HTMLElement & SVGElement => n.tagName?.toLowerCase() === 'svg');
    for (const svg of svgs) {
      if ((svg.clientWidth > 80 || svg.getAttribute('width')) && !svg.classList.contains('lucide')) {
        const rects = svg.querySelectorAll('rect, path');
        if (rects.length > 5) {
          try {
            const svgXml = new XMLSerializer().serializeToString(svg);
            qrDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgXml)}`;
            break;
          } catch {
            // ignore
          }
        }
      }
    }
  }

  if (!qrDataUrl) return null;

  // Extract timer: prefer timer inside modal container first
  const containerText = qrContainer.textContent || '';
  const timerMatch =
    containerText.match(/(\d{1,2}\s*[mM]\s*:\s*\d{1,2}\s*[sS])/i) ||
    containerText.match(/(\d{1,2}\s*:\s*\d{2})/) ||
    (doc.body?.textContent || '').match(/(\d{1,2}\s*[mM]\s*:\s*\d{1,2}\s*[sS])/i) ||
    (doc.body?.textContent || '').match(/(\d{1,2}\s*:\s*\d{2})/);
  const timerText = timerMatch?.[1] ? timerMatch[1].replace(/\s+/g, '') : undefined;

  // Extract amount with strict priority:
  let detectedAmountNum: number | undefined;

  // Priority 1: Check if the QR source URI has an embedded UPI amount param (e.g. upi://pay?...am=195.00)
  const upiCandidate = (qrImg?.src || qrDataUrl || '');
  const decodedUpi = (() => {
    try {
      return decodeURIComponent(upiCandidate);
    } catch {
      return upiCandidate;
    }
  })();
  const upiAmountMatch = decodedUpi.match(/[?&]am=([\d.]+)/i);
  if (upiAmountMatch && upiAmountMatch[1]) {
    const val = parseFloat(upiAmountMatch[1]);
    if (!isNaN(val) && val > 0) {
      detectedAmountNum = val;
    }
  }

  // Priority 2: Check inside the QR modal container ONLY (e.g., "Pay ₹297")
  if (detectedAmountNum === undefined) {
    const modalPayMatch = containerText.match(/pay\s*₹?\s*([\d,.]+)/i);
    if (modalPayMatch && modalPayMatch[1]) {
      const val = parseFloat(modalPayMatch[1].replace(/,/g, ''));
      if (!isNaN(val) && val > 0) {
        detectedAmountNum = val;
      }
    }
  }

  // Priority 3: Check visible "Process Transaction" pay button (e.g., "Pay ₹ 195 to proceed")
  if (detectedAmountNum === undefined) {
    const payProceedBtn = findProcessTransactionPayButton(doc);
    if (payProceedBtn && isElementVisible(payProceedBtn)) {
      const btnMatch = (payProceedBtn.textContent || '').match(/pay\s*₹?\s*([\d,.]+)/i);
      if (btnMatch && btnMatch[1]) {
        const val = parseFloat(btnMatch[1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0) {
          detectedAmountNum = val;
        }
      }
    }
  }

  // Priority 4: Fallback to expected order amount
  if (detectedAmountNum === undefined && fallbackAmountRupees !== undefined) {
    const fbNum = typeof fallbackAmountRupees === 'number'
      ? fallbackAmountRupees
      : parseFloat(String(fallbackAmountRupees).replace(/[^\d.]/g, ''));
    if (!isNaN(fbNum) && fbNum > 0) {
      detectedAmountNum = fbNum;
    }
  }

  // Format clean amount text: "₹195" (or undefined)
  let amountText: string | undefined;
  if (detectedAmountNum !== undefined) {
    const cleanNum = Number.isInteger(detectedAmountNum)
      ? String(detectedAmountNum)
      : detectedAmountNum.toFixed(2);
    amountText = `₹${cleanNum}`;
  }

  return {
    qrDataUrl,
    ...(amountText ? { amountText } : {}),
    ...(timerText ? { timerText } : {}),
  };
}

export function findVisibleSuccessElement(doc: Document): HTMLElement | null {
  const allNodes = getAllNodes(doc);
  for (const el of allNodes) {
    const isModalOrAlert =
      el.classList.contains('swal-modal') ||
      el.classList.contains('swal2-modal') ||
      el.classList.contains('modal') ||
      el.classList.contains('alert-success') ||
      el.getAttribute('role') === 'alert';

    if (isModalOrAlert && isElementVisible(el)) {
      const t = (el.textContent || '').toLowerCase();
      if (
        t.includes('recharge successful') ||
        t.includes('recharge submitted') ||
        t.includes('transaction accepted') ||
        t.includes('request has been accepted')
      ) {
        return el;
      }
    }
  }
  return null;
}

export function safeClickElement(el: HTMLElement): void {
  try {
    el.click();
  } catch {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }
}

export function findVisibleErrorElement(doc: Document): string | null {
  const allNodes = getAllNodes(doc);
  for (const el of allNodes) {
    const isModalOrAlert =
      el.classList.contains('swal-modal') ||
      el.classList.contains('swal2-modal') ||
      el.classList.contains('modal') ||
      el.classList.contains('alert-danger') ||
      el.classList.contains('error') ||
      el.getAttribute('role') === 'alert';

    if (isModalOrAlert && isElementVisible(el)) {
      const t = (el.textContent || '').toLowerCase();
      if (t.includes('wrong m pin') || t.includes('invalid m pin') || t.includes('invalid pin')) {
        return 'Official portal rejected: Invalid 4-Digit M-Pin';
      }
      if (t.includes('insufficient') && !t.includes('process transaction')) {
        return 'Official portal rejected: Insufficient wallet balance';
      }
      if (t.includes('enter valid amount') || t.includes('numeric value')) {
        return 'Official portal error: Enter valid amount(numeric value).';
      }
      if (t.includes('enter valid mobile') || t.includes('invalid mobile') || t.includes('invalid number')) {
        return 'Official portal error: Enter valid mobile number';
      }
      if (t.includes('error') && !t.includes('process transaction') && !t.includes('payment processing')) {
        const titleEl = el.querySelector('.swal-title, .swal2-title, .modal-title, h2, h3, strong');
        const textEl = el.querySelector('.swal-text, .swal2-html-container, .modal-body, p');
        const msg = (textEl?.textContent || titleEl?.textContent || '').trim();
        if (msg) {
          return `Official portal error: ${msg.replace(/\s+/g, ' ')}`;
        }
      }
    }
  }
  return null;
}

/**
 * Dismisses any visible SweetAlert or Error popup (e.g. "Enter valid amount(numeric value).")
 * by finding and clicking its OK or Confirm button.
 */
export async function dismissVisibleErrorPopup(doc: Document): Promise<boolean> {
  const allNodes = getAllNodes(doc);
  const errorContainer = allNodes.find((el) => {
    const isModalOrAlert =
      el.classList.contains('swal-modal') ||
      el.classList.contains('swal2-modal') ||
      el.classList.contains('modal') ||
      el.classList.contains('alert-danger') ||
      el.classList.contains('error') ||
      el.getAttribute('role') === 'alert';
    const t = (el.textContent || '').toLowerCase();
    return isModalOrAlert && isElementVisible(el) && (t.includes('error') || t.includes('numeric value') || t.includes('valid amount'));
  });

  if (!errorContainer) return false;

  const buttons = Array.from(
    errorContainer.querySelectorAll<HTMLElement>(
      'button, a, input[type="button"], [role="button"], .swal-button, .swal2-confirm'
    )
  );

  const okBtn = buttons.find((b) => {
    const txt = (b.textContent || (b as HTMLInputElement).value || '').trim().toLowerCase();
    const cls = (b.className || '').toLowerCase();
    return (
      txt === 'ok' ||
      txt === 'close' ||
      cls.includes('swal-button--confirm') ||
      cls.includes('swal2-confirm') ||
      cls.includes('confirm')
    );
  });

  if (okBtn && isElementVisible(okBtn)) {
    safeClickElement(okBtn);
    return true;
  }

  return false;
}

/**
 * 1. Closes the Payment Processing modal (Image 1):
 * Finds the close '✕' button in the Payment Processing modal and clicks it.
 */
export async function closePaymentProcessingModal(doc: Document): Promise<boolean> {
  const allNodes = getAllNodes(doc);
  const qrContainer = allNodes.find((el) => {
    const t = (el.textContent || '').toLowerCase();
    return (
      (t.includes('payment processing') || t.includes('order expring in') || t.includes('order expiring in')) &&
      isElementVisible(el)
    );
  });

  if (!qrContainer) return false;

  const modalEl = qrContainer.closest('.modal, .swal-modal, .swal2-modal, [role="dialog"], div') || qrContainer;
  const closeCandidates = Array.from(
    modalEl.querySelectorAll<HTMLElement>(
      'button.close, .close, [aria-label*="close" i], .btn-close, button, span, a, i, svg'
    )
  );

  const closeBtn = closeCandidates.find((el) => {
    const txt = (el.textContent || '').trim();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const cls = (el.className || '').toLowerCase();
    return (
      txt === '×' ||
      txt === '✕' ||
      txt.toLowerCase() === 'x' ||
      aria.includes('close') ||
      cls.includes('close') ||
      cls.includes('btn-close')
    );
  });

  if (closeBtn && isElementVisible(closeBtn)) {
    try {
      closeBtn.click();
    } catch {
      closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    return true;
  }

  return false;
}

/**
 * 2. Confirms closing payment window modal (Image 2):
 * "Are you sure? You want to close the payment window"
 * Clicks the red 'Yes' button.
 */
export async function confirmClosePaymentWindowAlert(doc: Document): Promise<boolean> {
  const allNodes = getAllNodes(doc);
  const alertContainer = allNodes.find((el) => {
    const t = (el.textContent || '').toLowerCase();
    return (
      (t.includes('are you sure') || t.includes('close the payment window')) &&
      isElementVisible(el)
    );
  });

  if (!alertContainer) return false;

  const buttons = Array.from(
    alertContainer.querySelectorAll<HTMLElement>('button, a, input[type="button"], [role="button"]')
  );
  const yesBtn = buttons.find((btn) => {
    const txt = (btn.textContent || (btn as HTMLInputElement).value || '').trim().toLowerCase();
    const cls = (btn.className || '').toLowerCase();
    return (
      txt === 'yes' ||
      txt.startsWith('yes') ||
      cls.includes('confirm') ||
      cls.includes('swal2-confirm') ||
      cls.includes('swal-button--confirm') ||
      cls.includes('btn-danger')
    );
  });

  if (yesBtn && isElementVisible(yesBtn)) {
    try {
      yesBtn.click();
    } catch {
      yesBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    return true;
  }

  return false;
}

/**
 * 3. Closes Process Transaction Drawer (Image 3):
 * Finds the green 'Close X' button inside the Process Transaction drawer and clicks it.
 */
export async function closeProcessTransactionDrawer(doc: Document): Promise<boolean> {
  const allNodes = getAllNodes(doc).filter(
    (el) => el !== doc.body && el !== doc.documentElement && (el as any) !== doc
  );

  // 1. Direct match: Any visible element with exact text 'Close X' or 'Close ✕' or 'Close ×'
  const directCloseBtn = allNodes.find((el) => {
    if (!isElementVisible(el)) return false;
    const txt = (el.textContent || (el as HTMLInputElement).value || '').trim().toLowerCase();
    return (
      txt === 'close x' ||
      txt === 'close ✕' ||
      txt === 'close ×' ||
      txt === 'close\nx'
    );
  });

  if (directCloseBtn && isElementVisible(directCloseBtn)) {
    safeClickElement(directCloseBtn);
    return true;
  }

  // 2. Fallback: Search inside container matching 'process transaction'
  const drawerContainer = allNodes.find((el) => {
    const t = (el.textContent || '').toLowerCase();
    return t.includes('process transaction') && isElementVisible(el);
  });

  if (!drawerContainer) return false;

  const candidates = Array.from(
    drawerContainer.querySelectorAll<HTMLElement>(
      'button, a, [role="button"], input[type="button"], ion-button, span, div, .close-btn, .btn-close'
    )
  );

  const closeBtn = candidates.find((el) => {
    const txt = (el.textContent || (el as HTMLInputElement).value || '').trim().toLowerCase();
    const cls = (el.className || '').toLowerCase();
    return (
      (txt.includes('close') && (txt.includes('x') || txt.includes('✕') || txt.includes('×'))) ||
      txt === 'close' ||
      txt === '×' ||
      txt === '✕' ||
      cls.includes('close-btn') ||
      cls.includes('btn-close')
    );
  });

  if (closeBtn && isElementVisible(closeBtn)) {
    safeClickElement(closeBtn);
    return true;
  }

  return false;
}

/**
 * 4. Resets the Prepaid Recharge form inputs (Image 4):
 * Clears Mobile Number, Amount, and dispatches change/input events.
 */
export function resetPrepaidRechargeForm(doc: Document): void {
  const mobileInput = findMobileInput(doc);
  if (mobileInput) {
    mobileInput.focus();
    try {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        doc.defaultView?.HTMLInputElement?.prototype || Object.getPrototypeOf(mobileInput),
        'value',
      )?.set;
      if (nativeSetter) nativeSetter.call(mobileInput, '');
      else mobileInput.value = '';
    } catch {
      mobileInput.value = '';
    }
    mobileInput.dispatchEvent(new Event('input', { bubbles: true }));
    mobileInput.dispatchEvent(new Event('change', { bubbles: true }));
    mobileInput.dispatchEvent(new Event('blur', { bubbles: true }));
    try {
      const win = doc.defaultView as any;
      const $ = win?.$ || win?.jQuery;
      if ($) $(mobileInput).val('').trigger('input').trigger('change');
    } catch {}
  }

  const amountInput = findAmountInput(doc);
  if (amountInput) {
    amountInput.focus();
    try {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        doc.defaultView?.HTMLInputElement?.prototype || Object.getPrototypeOf(amountInput),
        'value',
      )?.set;
      if (nativeSetter) nativeSetter.call(amountInput, '');
      else amountInput.value = '';
    } catch {
      amountInput.value = '';
    }
    amountInput.dispatchEvent(new Event('input', { bubbles: true }));
    amountInput.dispatchEvent(new Event('change', { bubbles: true }));
    amountInput.dispatchEvent(new Event('blur', { bubbles: true }));
    try {
      const win = doc.defaultView as any;
      const $ = win?.$ || win?.jQuery;
      if ($) $(amountInput).val('').trigger('input').trigger('change');
    } catch {}
  }
}

/**
 * Executes the complete 4-step cleanup sequence:
 * Step 0: Dismisses any blocking Error / SweetAlert popup (e.g. "Enter valid amount")
 * Step 1: Closes Payment Processing modal if open
 * Step 2: Clicks 'Yes' on "Are you sure?" confirmation
 * Step 3: Closes Process Transaction drawer
 * Step 4: Resets the recharge form
 */
export async function cleanupStaleEgPaymentModals(doc: Document): Promise<void> {
  // 0. Dismiss any blocking Error / SweetAlert popup
  const didDismissError = await dismissVisibleErrorPopup(doc);
  if (didDismissError) {
    console.log('[EG Payment Automation] Dismissed visible Error popup');
    await new Promise((r) => setTimeout(r, 200));
  }

  // 1. Close Payment Processing modal if currently active
  const didCloseQr = await closePaymentProcessingModal(doc);
  if (didCloseQr) {
    console.log('[EG Payment Automation] Closed stale Payment Processing modal');
    await new Promise((r) => setTimeout(r, 200));
    // 2. Confirm 'Yes' on "Are you sure?" alert
    const didConfirm = await confirmClosePaymentWindowAlert(doc);
    if (didConfirm) {
      console.log('[EG Payment Automation] Confirmed "Yes" on close payment window alert');
      await new Promise((r) => setTimeout(r, 200));
    }
  } else {
    // If "Are you sure?" alert is already directly visible
    await confirmClosePaymentWindowAlert(doc);
  }

  // 3. Close Process Transaction drawer if visible
  const didCloseDrawer = await closeProcessTransactionDrawer(doc);
  if (didCloseDrawer) {
    console.log('[EG Payment Automation] Closed Process Transaction drawer');
    await new Promise((r) => setTimeout(r, 200));
  }

  // 4. Reset form inputs so next transaction starts completely fresh
  resetPrepaidRechargeForm(doc);
  console.log('[EG Payment Automation] Reset prefilled recharge form to clean state');
}

/**
 * Actively monitors EG Payment portal tab while customer scans & pays the dynamic UPI QR code.
 * Resolves to { ok: true, status: 'submitted' } when payment is verified and modal clears.
 */
export async function monitorQrPaymentCapture(
  doc: Document,
  timeoutMs = 600000,
  checkIntervalMs = 800,
): Promise<RechargeExecutionResult> {
  const isTest = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
  const effectiveTimeout = isTest ? Math.min(timeoutMs, 500) : timeoutMs;
  const effectiveInterval = isTest ? 25 : checkIntervalMs;

  const startTime = Date.now();
  let qrModalWasDetected = false;

  while (Date.now() - startTime < effectiveTimeout) {
    await new Promise((resolve) => setTimeout(resolve, effectiveInterval));

    const qrDetails = findQRCodeDetails(doc);
    if (qrDetails) {
      if (!qrModalWasDetected) {
        console.log('[EG Payment Automation] QR modal active. Actively monitoring for customer payment...');
      }
      qrModalWasDetected = true;

      // Check if countdown timer has explicitly expired to 0
      const timerStr = (qrDetails.timerText || '').replace(/\s+/g, '').toLowerCase();
      if (timerStr === '00:00' || timerStr === '0m:00s' || timerStr === '0m:0s' || timerStr === '0:00') {
        await cleanupStaleEgPaymentModals(doc);
        return {
          ok: false,
          status: 'failed',
          failureCode: 'qr_payment_expired',
          failureDetail: 'Dynamic QR code payment session expired (timer reached 00:00)',
        };
      }

      // Check for explicit visible error element inside modal
      const visibleError = findVisibleErrorElement(doc);
      if (visibleError && !visibleError.toLowerCase().includes('process transaction')) {
        return {
          ok: false,
          status: 'failed',
          failureCode: 'portal_rejected',
          failureDetail: visibleError,
        };
      }

      // While QR modal is still open, customer has not completed payment yet.
      // Continue actively waiting for the customer to scan and pay via UPI!
      continue;
    }

    // If QR modal was active and has now closed: payment was captured by the official portal!
    if (qrModalWasDetected && !qrDetails) {
      console.log('[EG Payment Automation] QR modal closed! Verifying portal payment capture...');
      await new Promise((resolve) => setTimeout(resolve, effectiveInterval));
      const postText = (doc.body?.textContent || '').toLowerCase();
      const hasErrorText =
        postText.includes('transaction failed') ||
        postText.includes('payment failed') ||
        postText.includes('order expired') ||
        postText.includes('payment cancelled') ||
        postText.includes('payment declined');

      if (hasErrorText) {
        return {
          ok: false,
          status: 'failed',
          failureCode: 'portal_rejected',
          failureDetail: 'Payment was cancelled or failed on EG Payment portal',
        };
      }

      console.log('[EG Payment Automation] Payment confirmed on portal! Transitioning to submitted.');
      return {
        ok: true,
        status: 'submitted',
      };
    }
  }

  // If timed out while QR modal was active
  await cleanupStaleEgPaymentModals(doc);
  return {
    ok: false,
    status: 'needs_manual_action',
    failureCode: 'qr_payment_timeout',
    failureDetail: 'Dynamic UPI QR code was not scanned or completed before timeout',
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
      'input#operator, input[name="operator"], input[name*="operator" i], input#op, input[name="op"], input#operator_name, input[name="operator_name"], input[placeholder*="Operator" i], input[aria-label*="Operator" i]',
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
      const labelText = (opLabel.textContent || '').trim().toLowerCase();
      if (labelText === 'operator' || labelText === 'operator name') {
        const parent = opLabel.closest('.form-group, .mb-3, .col-md-6, div') || opLabel.parentElement;
        const candidate = parent?.querySelector(
          '.select2-selection__rendered, .chosen-single, .dropdown-toggle, input, select, .form-control, p, span',
        ) || opLabel.nextElementSibling;
        const txt = (
          (candidate as HTMLInputElement)?.value ||
          candidate?.textContent ||
          ''
        ).trim();
        if (txt && !/select\s*operator/i.test(txt) && txt.toLowerCase() !== 'operator' && txt.length < 50) {
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
      'input#circle, input[name="circle"], input[name*="circle" i], input#circle_name, input[name="circle_name"], input[placeholder*="Circle" i], input[aria-label*="Circle" i]',
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
      const labelText = (circleLabel.textContent || '').trim().toLowerCase();
      if (labelText === 'circle' || labelText === 'circle name') {
        const parent = circleLabel.closest('.form-group, .mb-3, .col-md-6, div') || circleLabel.parentElement;
        const candidate = parent?.querySelector(
          '.select2-selection__rendered, .chosen-single, .dropdown-toggle, input, select, .form-control, p, span',
        ) || circleLabel.nextElementSibling;
        const txt = (
          (candidate as HTMLInputElement)?.value ||
          candidate?.textContent ||
          ''
        ).trim();
        if (txt && !/select\s*circle/i.test(txt) && txt.toLowerCase() !== 'circle' && txt.length < 50) {
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
    (curUrl.includes('/login') || curUrl.includes('/users/login')) &&
    !curUrl.includes('/recharge');

  // Check for truly visible SweetAlert or modal indicating session expired (never match raw script tags or hidden dialogs!)
  const visibleExpiredModal = Array.from(
    doc.querySelectorAll('.swal-overlay--show-modal .swal-modal, .swal-modal.swal-modal--visible, .modal.show, .modal.in'),
  ).some((el) => {
    if (!isElementVisible(el as HTMLElement)) return false;
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
  if ((captchaElem && isElementVisible(captchaElem as HTMLElement)) || (otpModal && isElementVisible(otpModal as HTMLElement))) {
    return {
      ok: false,
      status: 'needs_manual_action',
      failureCode: 'challenge_detected',
      failureDetail: 'CAPTCHA or OTP challenge detected on portal form',
    };
  }

  // 2.1 Ensure portal is completely clean before starting new recharge:
  // Closes any stale Payment Processing modal, confirms "Yes" on alert, closes Process Transaction drawer, and clears form
  await cleanupStaleEgPaymentModals(doc);

  // 3. Locate Mobile Number input
  const mobileInput = await waitForElement(() => findMobileInput(doc), 3000, 100);
  if (!mobileInput) {
    // If mobile input is missing, check if this is an unauthenticated login screen
    const hasLoginFields = Boolean(
      doc.querySelector('input[type="password"], input[name*="password" i], input[placeholder*="Password" i]'),
    );
    const visibleAuthText = Array.from(doc.querySelectorAll('div, p, span, h1, h2, h3, h4'))
      .filter((el) => el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' && isElementVisible(el as HTMLElement))
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

  mobileInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  for (const char of order.customerNo) {
    const code = `Digit${char}`;
    const keyCode = 48 + parseInt(char, 10);
    mobileInput.dispatchEvent(new KeyboardEvent('keydown', { key: char, code, keyCode, which: keyCode, bubbles: true, composed: true }));
    mobileInput.dispatchEvent(new KeyboardEvent('keypress', { key: char, code, keyCode, which: keyCode, bubbles: true, composed: true }));
    mobileInput.dispatchEvent(new KeyboardEvent('keyup', { key: char, code, keyCode, which: keyCode, bubbles: true, composed: true }));
  }
  mobileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  mobileInput.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));

  try {
    const win = doc.defaultView as any;
    const $ = win?.$ || win?.jQuery;
    if ($) {
      $(mobileInput).val(order.customerNo).trigger('input').trigger('change').trigger('keyup');
    }
  } catch {
    // ignore
  }

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

  try {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      doc.defaultView?.HTMLInputElement?.prototype || Object.getPrototypeOf(amountInput),
      'value',
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(amountInput, rupees);
    } else {
      amountInput.value = rupees;
    }
  } catch {
    amountInput.value = rupees;
  }

  amountInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  for (const char of rupees) {
    const code = `Digit${char}`;
    const keyCode = 48 + parseInt(char, 10);
    amountInput.dispatchEvent(new KeyboardEvent('keydown', { key: char, code, keyCode, which: keyCode, bubbles: true, composed: true }));
    amountInput.dispatchEvent(new KeyboardEvent('keypress', { key: char, code, keyCode, which: keyCode, bubbles: true, composed: true }));
    amountInput.dispatchEvent(new KeyboardEvent('keyup', { key: char, code, keyCode, which: keyCode, bubbles: true, composed: true }));
  }
  amountInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  amountInput.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));

  try {
    const win = doc.defaultView as any;
    const $ = win?.$ || win?.jQuery;
    if ($) {
      $(amountInput).val(rupees).trigger('input').trigger('change').trigger('keyup');
    }
  } catch {
    // ignore
  }

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

  // 8. Locate & Click Submit Button (single click only to prevent double form submission)
  const submitButton = await waitForElement(() => findSubmitButton(doc), 3000, 100);
  if (!submitButton) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'element_not_found',
      failureDetail: 'Recharge Submit button not found on page',
    };
  }

  safeClickElement(submitButton);

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

    // Single click only on CONFIRM to avoid submitting empty/reset form
    safeClickElement(mPinModal.confirmBtn);
  }

  // 10. Check Outcome: Insufficient Balance (Process Transaction / QR) vs Success vs Error
  const isTestEnv = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
  const outcomeWaitTimeout = isTestEnv ? 400 : 8000;

  let outcomeResult = await waitForElement(() => {
    // Priority 1: Check for insufficient balance "Process Transaction" button (Image 1)
    const payProceedBtn = findProcessTransactionPayButton(doc);
    if (payProceedBtn) {
      const vis = isElementVisible(payProceedBtn);
      // If pay button is found, return it
      if (vis) {
        return { type: 'qr_required', button: payProceedBtn };
      }
    }

    const expectedRupees = Math.round(order.amountPaise / 100);

    // Priority 2: Check for direct QR modal (Image 2)
    const qrDetails = findQRCodeDetails(doc, expectedRupees);
    if (qrDetails) {
      return { type: 'qr_active', details: qrDetails };
    }

    // Priority 3: Check for visible error alert
    const errorMsg = findVisibleErrorElement(doc);
    if (errorMsg) {
      return { type: 'error', message: errorMsg };
    }

    // Priority 4: Check for visible success alert (ONLY if no Process Transaction drawer is present!)
    const successEl = findVisibleSuccessElement(doc);
    if (successEl) {
      return { type: 'success' };
    }

    return null;
  }, outcomeWaitTimeout, 100);

  const expectedRupees = Math.round(order.amountPaise / 100);

  // If still not found after initial wait, do one more deep check for Process Transaction or QR
  if (!outcomeResult) {
    const latePayBtn = findProcessTransactionPayButton(doc);
    if (latePayBtn) {
      outcomeResult = { type: 'qr_required', button: latePayBtn };
    } else {
      const lateQr = findQRCodeDetails(doc, expectedRupees);
      if (lateQr) {
        outcomeResult = { type: 'qr_active', details: lateQr };
      }
    }
  }

  // If QR code payment is needed (insufficient wallet balance):
  if (outcomeResult && outcomeResult.type === 'qr_required' && outcomeResult.button) {
    const btnText = outcomeResult.button.textContent || '';
    const btnAmtMatch = btnText.match(/pay\s*₹?\s*([\d,.]+)/i);
    const payableRupees = btnAmtMatch
      ? parseFloat(btnAmtMatch[1].replace(/,/g, ''))
      : expectedRupees;

    console.log('[EG Payment Automation] Insufficient balance detected! Clicking Process Transaction Pay button:', btnText.trim(), 'Payable amount:', payableRupees);
    outcomeResult.button.focus();
    safeClickElement(outcomeResult.button);
    // If it has shadowRoot, click inner button
    if ((outcomeResult.button as any).shadowRoot) {
      const inner = (outcomeResult.button as any).shadowRoot.querySelector('button');
      if (inner) safeClickElement(inner);
    }

    // Wait for "Payment Processing." modal with dynamic QR code
    const qrWaitTimeout = isTestEnv ? 1000 : 15000;
    const qrData = await waitForElement(() => findQRCodeDetails(doc, payableRupees), qrWaitTimeout, 50);
    if (qrData) {
      console.log('[EG Payment Automation] Dynamic QR code captured:', qrData.amountText, qrData.timerText);
      if (order.onQrCodeDetected) {
        order.onQrCodeDetected(qrData);
      }

      if (order.waitForPaymentCompletion) {
        return await monitorQrPaymentCapture(doc, order.paymentWaitTimeoutMs || 600000);
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

    if (order.waitForPaymentCompletion) {
      return await monitorQrPaymentCapture(doc, order.paymentWaitTimeoutMs || 600000);
    }

    return {
      ok: false,
      status: 'needs_manual_action',
      failureCode: 'qr_payment_required',
      failureDetail: `Dynamic UPI QR code generated (${outcomeResult.details.amountText || 'UPI'}). Please scan and pay from web app to complete.`,
    };
  }

  if (outcomeResult && outcomeResult.type === 'error') {
    await dismissVisibleErrorPopup(doc);
    await cleanupStaleEgPaymentModals(doc);
    return {
      ok: false,
      status: 'failed',
      failureCode: outcomeResult.message?.includes('M-Pin') ? 'invalid_mpin' : 'portal_error',
      failureDetail: outcomeResult.message || 'Official portal error occurred',
    };
  }

  return {
    ok: true,
    status: 'submitted',
  };
}
