/**
 * SimpleWallet Recharge Form Automation Runner
 *
 * Real-world flow verified from official portal recording:
 * 1. Navigate to MobileRecharge.aspx?mID=822&PID=821
 * 2. If 'Change Operator' button is visible, click it to show operator cards
 * 3. Click matching operator card (VI, AIRTEL, BSNL, JIO — excluding 'JIO SPECIAL 349')
 * 4. Form fields appear: fill Mobile No and Amount (in rupees)
 * 5. Verify input values round-trip
 * 6. Click green 'Recharge' button
 * 7. Modal appears: 'Confrim Transaction' with 'Pay Now' button -> click 'Pay Now'
 * 8. Alert dialog appears: 'Transaction accepted, Trn No: ...' with 'OK' button -> click 'OK'
 * 9. Modal closes cleanly and return { ok: true, status: 'submitted', portalTrnId }
 */

import type { IngestTransaction } from '@walletsync/contract';

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

function isElementVisible(el: HTMLElement): boolean {
  if (!el) return false;
  try {
    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) {
      return false;
    }
  } catch {
    // ignore
  }
  return true;
}

function isOperatorCurrentlySelected(doc: Document, operator: string): boolean {
  const target = operator.toUpperCase().trim();
  const changeOpBtn = findChangeOperatorButton(doc);
  if (!changeOpBtn) return false;

  const images = Array.from(doc.querySelectorAll<HTMLImageElement>('img'));
  for (const img of images) {
    const src = (img.src || '').toLowerCase();
    const alt = (img.alt || '').toLowerCase();
    if (target.includes('JIO') && (src.includes('jio') || alt.includes('jio')) && !src.includes('special')) return true;
    if (target.includes('AIRTEL') && (src.includes('airtel') || alt.includes('airtel'))) return true;
    if (target.includes('BSNL') && (src.includes('bsnl') || alt.includes('bsnl'))) return true;
    if ((target === 'VI' || target.includes('VODAFONE')) && (src.includes('vi') || alt.includes('vi'))) return true;
  }
  return false;
}

function findChangeOperatorButton(doc: Document): HTMLElement | null {
  const elements = Array.from(doc.querySelectorAll('button, a, input[type="button"], div, span'));
  return (
    (elements.find((el) => {
      const text = (el.textContent || (el as HTMLInputElement).value || '').trim();
      return /^change\s*operator$/i.test(text);
    }) as HTMLElement) || null
  );
}

function triggerClickFlow(el: HTMLElement) {
  if (!el) return;
  try {
    el.focus?.();
  } catch {
    // ignore
  }
  try {
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  } catch {
    // ignore
  }
  try {
    el.click();
  } catch {
    // ignore
  }
}

/**
 * Finds and clicks the target operator card / icon on SimpleWallet.
 * Prioritizes cards and images over dropdowns.
 */
function selectOperatorCard(doc: Document, operator: string): boolean {
  const target = operator.toUpperCase().trim();

  // 1. Look for operator image logos (alt / src / title match) - HIGHEST PRIORITY
  const images = Array.from(doc.querySelectorAll<HTMLImageElement>('img, input[type="image"]'));
  for (const img of images) {
    const src = (img.src || '').toLowerCase();
    const alt = (img.alt || '').toLowerCase();
    const title = (img.title || '').toLowerCase();
    let isImgMatch = false;

    if (target.includes('JIO')) {
      isImgMatch = (src.includes('jio') || alt.includes('jio') || title.includes('jio')) &&
        !src.includes('special') && !alt.includes('special') && !title.includes('special');
    } else if (target.includes('AIRTEL')) {
      isImgMatch = src.includes('airtel') || alt.includes('airtel') || title.includes('airtel');
    } else if (target.includes('BSNL')) {
      isImgMatch = src.includes('bsnl') || alt.includes('bsnl') || title.includes('bsnl');
    } else if (target === 'VI' || target.includes('VODAFONE') || target.includes('IDEA')) {
      isImgMatch = (src.includes('vi') || alt.includes('vi') || src.includes('vodafone') || title.includes('vi')) &&
        !src.includes('special') && !alt.includes('special');
    }

    if (isImgMatch) {
      triggerClickFlow(img);
      const parent = img.parentElement;
      if (parent) {
        triggerClickFlow(parent);
      }
      const clickableParent = img.closest('a, button, [onclick], .operator-card, .card, li, div') as HTMLElement | null;
      if (clickableParent && clickableParent !== img && clickableParent !== parent) {
        triggerClickFlow(clickableParent);
      }
      return true;
    }
  }

  // 2. Look for text labels on operator cards (excluding tables, gridviews, headers)
  const candidateElements = Array.from(doc.querySelectorAll('div, a, li, button, span, p'));
  for (const el of candidateElements) {
    // Avoid table cells from recent transaction history table
    if (el.closest('table, #gvList, .table, tr, td, th, nav, footer, .navbar')) {
      continue;
    }

    const text = (el.textContent || '').trim().toUpperCase();
    let isMatch = false;

    if (target.includes('JIO')) {
      isMatch = text === 'JIO';
    } else if (target.includes('AIRTEL')) {
      isMatch = text === 'AIRTEL';
    } else if (target.includes('BSNL')) {
      isMatch = text === 'BSNL';
    } else if (target === 'VI' || target.includes('VODAFONE') || target.includes('IDEA')) {
      isMatch = text === 'VI' || text === 'VODAFONE' || text === 'IDEA';
    }

    if (isMatch) {
      const htmlEl = el as HTMLElement;
      triggerClickFlow(htmlEl);

      // Also trigger sibling or parent image if present
      const container = htmlEl.closest('div, a, li, td') as HTMLElement | null;
      if (container) {
        const siblingImg = container.querySelector<HTMLImageElement>('img');
        if (siblingImg) {
          triggerClickFlow(siblingImg);
        }
        triggerClickFlow(container);
      }

      const clickable = htmlEl.closest('a, button, [onclick], .operator-card, .card, li, div[class*="operator" i]') as HTMLElement | null;
      if (clickable && clickable !== htmlEl && clickable !== container) {
        triggerClickFlow(clickable);
      }
      return true;
    }
  }

  // 3. Dropdown fallback if cards not present
  const operatorSelect = (doc.getElementById('ddlOperator') ||
    doc.querySelector('select[name*="Operator" i], select[id*="ddlOperator" i]')) as HTMLSelectElement | null;
  if (operatorSelect && operatorSelect.options.length > 1) {
    const options = Array.from(operatorSelect.options);
    const matchedOption = options.find((opt) => {
      const text = opt.text.toUpperCase().trim();
      const val = opt.value.toUpperCase().trim();
      if (target.includes('JIO')) {
        return (text.includes('JIO') || val.includes('JIO')) && !text.includes('SPECIAL');
      }
      return text.includes(target) || val.includes(target);
    });
    if (matchedOption) {
      operatorSelect.value = matchedOption.value;
      operatorSelect.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }

  return false;
}

function findMobileInput(doc: Document): HTMLInputElement | null {
  const direct = doc.querySelector(
    'input[id*="txtMobile" i], input[name*="Mobile" i], input[id*="mobile" i], input[id*="txtCust" i], input[id*="txtPhone" i], input[placeholder*="Mobile" i], input[type="tel"]',
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
  const candidates = Array.from(doc.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn, a'));
  const match = candidates.find((b) => {
    const text = (b.textContent || (b as HTMLInputElement).value || '').trim().toLowerCase();
    return text === 'recharge' || text === 'proceed to recharge';
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

function findSuccessDialog(doc: Document): { okBtn: HTMLElement; trnNo?: string } | null {
  // 1. Exact icon class provided from live portal: 'bootstrap-dialog-button-icon glyphicon glyphicon-ok'
  const glyphiconOk = doc.querySelector('.glyphicon-ok, .bootstrap-dialog-button-icon');
  let btn: HTMLElement | null = null;
  if (glyphiconOk) {
    btn = (glyphiconOk.closest('button, a, [role="button"], .btn') || glyphiconOk.parentElement) as HTMLElement;
  }

  if (!btn) {
    const dialogBtns = Array.from(
      doc.querySelectorAll(
        '.bootstrap-dialog-footer-buttons button, .bootstrap-dialog-footer-buttons .btn, .bootstrap-dialog .modal-footer button, .bootstrap-dialog button, .modal-footer button, .modal-dialog button',
      ),
    );
    btn = (dialogBtns.find((b) => {
      const text = (b.textContent || (b as HTMLInputElement).value || '').trim().toLowerCase();
      return text === 'ok' || text.includes('ok');
    }) as HTMLElement) || null;
  }

  // Extract Trn No from body or dialog
  const bodyText = doc.body?.textContent || '';
  const match =
    bodyText.match(/Trn\s*No:?\s*(\d+)/i) ||
    bodyText.match(/Transaction\s*accepted.*?(\d{6,})/i) ||
    bodyText.match(/Trn No:\s*([A-Za-z0-9]+)/i);
  const trnNo = match ? match[1] : undefined;

  if (btn) {
    return { okBtn: btn, ...(trnNo ? { trnNo } : {}) };
  }
  return null;
}

function findPortalErrorMessage(doc: Document): string | null {
  const dialogs = Array.from(
    doc.querySelectorAll(
      '.bootstrap-dialog.type-danger, .bootstrap-dialog.type-warning, .modal.in, .modal.show, .alert-danger, .alert',
    ),
  );
  for (const dialog of dialogs) {
    const text = (dialog.textContent || '').trim();
    if (
      /insufficient\s*balance/i.test(text) ||
      /transaction\s*failed/i.test(text) ||
      /invalid\s*number/i.test(text) ||
      /operator\s*down/i.test(text)
    ) {
      return text.replace(/\s+/g, ' ').slice(0, 200);
    }
  }
  return null;
}

export interface PortalRechargeRow {
  trnNo: string;
  trnDate?: string | undefined;
  serviceName?: string | undefined;
  customerNo: string;
  amountPaise: number;
  operatorRef?: string | undefined;
  status: 'success' | 'failed' | 'pending';
  rawStatus: string;
}

export function parseDateToISO(rawDate: string): string | null {
  // Format: "08/11/2026 04:49:20 PM" or "08/11/2026 16:49:20"
  const m = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m || !m[1] || !m[2] || !m[3] || !m[4] || !m[5] || !m[6]) return null;
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const yyyy = m[3];
  let hour = parseInt(m[4], 10);
  const min = m[5];
  const sec = m[6];
  const ampm = m[7]?.toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  const hh = String(hour).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${sec}+05:30`;
}

/**
 * Searches the live transactions table on MobileRecharge.aspx for an order row matching
 * customer number and optional amount. Returns the extracted row if found.
 */
export function findRechargeRowInTable(
  doc: Document,
  customerNo: string,
  amountPaise?: number,
): PortalRechargeRow | null {
  const tables = Array.from(doc.querySelectorAll('table'));
  for (const table of tables) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length < 2) continue;

    let headerRowIdx = -1;
    let trnNoIdx = -1;
    let custNoIdx = -1;
    let statusIdx = -1;
    let amountIdx = -1;
    let dateIdx = -1;
    let opRefIdx = -1;
    let serviceIdx = -1;

    for (let r = 0; r < Math.min(rows.length, 3); r++) {
      const headerCells = Array.from(rows[r]?.querySelectorAll('th, td') || []).map((c) =>
        (c.textContent || '').trim().toLowerCase(),
      );
      const tIdx = headerCells.findIndex((h) => h.includes('trn no') || h === 'trn no');
      const cIdx = headerCells.findIndex((h) => h.includes('customer') || h.includes('mobile'));
      const sIdx = headerCells.findIndex((h) => h.includes('status'));
      if (tIdx !== -1 && sIdx !== -1) {
        headerRowIdx = r;
        trnNoIdx = tIdx;
        custNoIdx = cIdx !== -1 ? cIdx : headerCells.findIndex((h) => h.includes('no'));
        statusIdx = sIdx;
        amountIdx = headerCells.findIndex((h) => h.includes('amount'));
        dateIdx = headerCells.findIndex((h) => h.includes('date'));
        opRefIdx = headerCells.findIndex((h) => h.includes('trn id') || h.includes('operator id'));
        serviceIdx = headerCells.findIndex((h) => h.includes('service') || h.includes('operator'));
        break;
      }
    }

    if (headerRowIdx === -1 || trnNoIdx === -1 || statusIdx === -1) {
      continue;
    }

    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const cells = Array.from(rows[i]?.querySelectorAll('td') || []);
      if (cells.length <= Math.max(trnNoIdx, custNoIdx, statusIdx)) continue;

      const rowCustNo = (cells[custNoIdx]?.textContent || '').replace(/\D/g, '');
      const rowTrnNo = (cells[trnNoIdx]?.textContent || '').trim();
      const rawStatus = (cells[statusIdx]?.textContent || '').trim();
      const rowAmountStr = amountIdx !== -1 ? (cells[amountIdx]?.textContent || '').replace(/[^0-9.]/g, '') : '';
      const rowAmountPaise = Math.round(parseFloat(rowAmountStr || '0') * 100);

      const targetDigits = customerNo.replace(/\D/g, '');
      const targetLast4 = targetDigits.slice(-4);
      const matchesCust = rowCustNo === targetDigits || (targetLast4.length === 4 && rowCustNo.endsWith(targetLast4));
      const matchesAmount = !amountPaise || Math.abs(rowAmountPaise - amountPaise) < 100;

      if (matchesCust && matchesAmount && rowTrnNo) {
        let status: 'success' | 'failed' | 'pending' = 'pending';
        const stLower = rawStatus.toLowerCase();
        if (stLower.includes('success')) status = 'success';
        else if (stLower.includes('fail') || stLower.includes('reject')) status = 'failed';
        else if (stLower.includes('pend') || stLower.includes('process')) status = 'pending';

        return {
          trnNo: rowTrnNo,
          trnDate: dateIdx !== -1 ? (cells[dateIdx]?.textContent || '').trim() : undefined,
          serviceName: serviceIdx !== -1 ? (cells[serviceIdx]?.textContent || '').trim() : undefined,
          customerNo: rowCustNo,
          amountPaise: rowAmountPaise,
          operatorRef: opRefIdx !== -1 ? (cells[opRefIdx]?.textContent || '').trim() || undefined : undefined,
          status,
          rawStatus,
        };
      }
    }
  }
  return null;
}

/**
 * Parses all recent transaction rows from the table on MobileRecharge.aspx.
 */
export function parseMobileRechargeRows(doc: Document): IngestTransaction[] {
  const tables = Array.from(doc.querySelectorAll('table'));
  for (const table of tables) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length < 2) continue;

    let headerRowIdx = -1;
    let trnNoIdx = -1;
    let custNoIdx = -1;
    let statusIdx = -1;
    let amountIdx = -1;
    let dateIdx = -1;
    let opRefIdx = -1;
    let serviceIdx = -1;

    for (let r = 0; r < Math.min(rows.length, 3); r++) {
      const headerCells = Array.from(rows[r]?.querySelectorAll('th, td') || []).map((c) =>
        (c.textContent || '').trim().toLowerCase(),
      );
      const tIdx = headerCells.findIndex((h) => h.includes('trn no') || h === 'trn no');
      const cIdx = headerCells.findIndex((h) => h.includes('customer') || h.includes('mobile'));
      const sIdx = headerCells.findIndex((h) => h.includes('status'));
      if (tIdx !== -1 && sIdx !== -1) {
        headerRowIdx = r;
        trnNoIdx = tIdx;
        custNoIdx = cIdx !== -1 ? cIdx : headerCells.findIndex((h) => h.includes('no'));
        statusIdx = sIdx;
        amountIdx = headerCells.findIndex((h) => h.includes('amount'));
        dateIdx = headerCells.findIndex((h) => h.includes('date'));
        opRefIdx = headerCells.findIndex((h) => h.includes('trn id') || h.includes('operator id'));
        serviceIdx = headerCells.findIndex((h) => h.includes('service') || h.includes('operator'));
        break;
      }
    }

    if (headerRowIdx === -1 || trnNoIdx === -1 || statusIdx === -1) {
      continue;
    }

    const results: IngestTransaction[] = [];
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const cells = Array.from(rows[i]?.querySelectorAll('td') || []);
      if (cells.length <= Math.max(trnNoIdx, custNoIdx, statusIdx)) continue;

      const rawTrnNo = (cells[trnNoIdx]?.textContent || '').trim();
      const rawCustNo = (cells[custNoIdx]?.textContent || '').replace(/\D/g, '');
      const rawStatus = (cells[statusIdx]?.textContent || '').trim();
      if (!rawTrnNo || !rawCustNo) continue;

      const rawAmount = amountIdx !== -1 ? (cells[amountIdx]?.textContent || '').replace(/[^0-9.]/g, '') : '0';
      const amountPaise = Math.round(parseFloat(rawAmount || '0') * 100);
      const rawDate = dateIdx !== -1 ? (cells[dateIdx]?.textContent || '').trim() : '';
      const rawService = serviceIdx !== -1 ? (cells[serviceIdx]?.textContent || '').trim() : 'AIRTEL';
      const opRef = opRefIdx !== -1 ? (cells[opRefIdx]?.textContent || '').trim() : '';

      let status: 'success' | 'failed' | 'pending' | 'refunded' | 'unknown' = 'unknown';
      const st = rawStatus.toLowerCase();
      if (st.includes('success')) status = 'success';
      else if (st.includes('fail') || st.includes('reject')) status = 'failed';
      else if (st.includes('pend') || st.includes('process')) status = 'pending';

      const occurredAt = parseDateToISO(rawDate) || new Date().toISOString();

      results.push({
        txnId: rawTrnNo,
        source: 'simplewallet',
        service: 'Prepaid',
        serviceName: rawService,
        customerNo: rawCustNo,
        occurredAt,
        status,
        statusRaw: rawStatus,
        operatorRef: opRef,
        amountPaise,
        discountPct: 0,
        discountPaise: 0,
      });
    }
    if (results.length > 0) return results;
  }
  return [];
}

/**
 * Extracts portal balance in paise from the top header on MobileRecharge.aspx (e.g. "Regular : 1299.98").
 */
export function parseMobileRechargeBalance(doc: Document): number | null {
  try {
    const text = doc.body?.innerText || doc.body?.textContent || '';
    const match = text.match(/Regular\s*:\s*([\d,]+(?:\.\d+)?)/i);
    if (match && match[1]) {
      const clean = match[1].replace(/,/g, '');
      const val = parseFloat(clean);
      if (!isNaN(val) && val >= 0) {
        return Math.round(val * 100);
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function dismissAnyOpenModal(doc: Document) {
  try {
    const closeBtns = Array.from(
      doc.querySelectorAll(
        '.modal.in [data-dismiss="modal"], .bootstrap-dialog.in [data-dismiss="modal"], .modal [data-dismiss="modal"], .modal .close, .bootstrap-dialog .close, button.btn-close',
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
    (currentUrl.includes('/default.aspx') && !currentUrl.includes('mobilerecharge')) ||
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

  // 3. Reset to operator card selection view if "Change Operator" button is visible
  const changeOpBtn = findChangeOperatorButton(doc);
  if (changeOpBtn && isElementVisible(changeOpBtn)) {
    changeOpBtn.click();
    try {
      changeOpBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  // 4. Select operator card
  const operatorSelected = selectOperatorCard(doc, order.operator);
  if (!operatorSelected) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'operator_mismatch',
      failureDetail: `Operator '${order.operator}' not found on SimpleWallet portal`,
    };
  }

  // 5. Wait for form inputs to mount
  const mobileInput = await waitForElement(() => {
    const input = findMobileInput(doc);
    return input ? input : null;
  }, 6000, 100);

  if (!mobileInput) {
    const allInputsSummary = Array.from(doc.querySelectorAll('input'))
      .slice(0, 10)
      .map((i) => `${i.id || i.name || i.type}`)
      .join(', ');
    return {
      ok: false,
      status: 'failed',
      failureCode: 'element_not_found',
      failureDetail: `Mobile number input element not found after operator selection (Inputs: ${allInputsSummary || 'none'})`,
    };
  }

  const amountInput = await waitForElement(() => {
    const input = findAmountInput(doc);
    return input ? input : null;
  }, 4000, 100);

  if (!amountInput) {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'element_not_found',
      failureDetail: 'Amount input element not found on page',
    };
  }

  // 6. Fill Mobile Number
  mobileInput.focus();
  mobileInput.value = order.customerNo;
  mobileInput.dispatchEvent(new Event('input', { bubbles: true }));
  mobileInput.dispatchEvent(new Event('change', { bubbles: true }));
  mobileInput.dispatchEvent(new Event('blur', { bubbles: true }));

  // 7. Fill Amount in Rupees (integer e.g. '299')
  const rupees = Math.round(order.amountPaise / 100).toString();
  amountInput.focus();
  amountInput.value = rupees;
  amountInput.dispatchEvent(new Event('input', { bubbles: true }));
  amountInput.dispatchEvent(new Event('change', { bubbles: true }));
  amountInput.dispatchEvent(new Event('blur', { bubbles: true }));

  // 8. Verify inputs before clicking
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

  // 9. Locate & Click Recharge Button
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
  try {
    rechargeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  } catch {
    // ignore
  }

  // 10. Handle "Confrim Transaction" Modal ("Pay Now" button)
  const payNowBtn = await waitForElement(() => {
    const btn = findPayNowButton(doc);
    return btn && isElementVisible(btn) ? btn : null;
  }, 6000, 250);

  if (!payNowBtn) {
    const inlineError = findPortalErrorMessage(doc);
    return {
      ok: false,
      status: 'failed',
      failureCode: 'confirmation_modal_missing',
      failureDetail:
        inlineError ||
        'Confirmation modal ("Confrim Transaction" / "Pay Now") did not appear after clicking Recharge button',
    };
  }

  payNowBtn.click();
  try {
    payNowBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  } catch {
    // ignore
  }

  // 11. Handle Success Alert Message ("OK" button & Trn No extraction) or Live Table Update
  let portalTrnId: string | undefined;
  const dialogResult = await waitForElement(() => {
    // 11a. Check for table row update first (fastest and most accurate for ASP.NET postbacks)
    const tableRow = findRechargeRowInTable(doc, order.customerNo, order.amountPaise);
    if (tableRow) {
      return { tableRow };
    }

    const errMsg = findPortalErrorMessage(doc);
    if (errMsg) {
      return { error: errMsg };
    }

    const success = findSuccessDialog(doc);
    if (success) {
      portalTrnId = success.trnNo;
      return { okBtn: success.okBtn, ...(success.trnNo ? { trnNo: success.trnNo } : {}) };
    }

    return null;
  }, 10000, 250);

  if (dialogResult && 'tableRow' in dialogResult) {
    const row = dialogResult.tableRow;
    dismissAnyOpenModal(doc);
    if (row.status === 'failed') {
      return {
        ok: false,
        status: 'failed',
        failureCode: 'portal_rejected',
        failureDetail: `Official portal rejected recharge: Trn No ${row.trnNo} marked as ${row.rawStatus}`,
      };
    }
    return {
      ok: true,
      status: 'submitted',
      portalTrnId: row.trnNo,
    };
  }

  if (!dialogResult || 'error' in dialogResult) {
    // Check table one final time before reporting failure
    const finalRow = findRechargeRowInTable(doc, order.customerNo, order.amountPaise);
    if (finalRow) {
      dismissAnyOpenModal(doc);
      if (finalRow.status === 'failed') {
        return {
          ok: false,
          status: 'failed',
          failureCode: 'portal_rejected',
          failureDetail: `Official portal rejected recharge: Trn No ${finalRow.trnNo} marked as ${finalRow.rawStatus}`,
        };
      }
      return {
        ok: true,
        status: 'submitted',
        portalTrnId: finalRow.trnNo,
      };
    }

    const detail =
      dialogResult && 'error' in dialogResult
        ? dialogResult.error
        : 'Official portal transaction confirmation dialog was not received';
    return {
      ok: false,
      status: 'failed',
      failureCode: 'portal_recharge_failed',
      failureDetail: detail,
    };
  }

  // Click OK button on confirmation dialog
  dialogResult.okBtn.click();
  try {
    dialogResult.okBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  } catch {
    // ignore
  }

  // Ensure recharge modal and backdrops close cleanly
  await new Promise((resolve) => setTimeout(resolve, 300));
  dismissAnyOpenModal(doc);

  // Check table to see if portal transaction is already marked as failed/success
  const postDialogRow = findRechargeRowInTable(doc, order.customerNo, order.amountPaise);
  if (postDialogRow && postDialogRow.status === 'failed') {
    return {
      ok: false,
      status: 'failed',
      failureCode: 'portal_rejected',
      failureDetail: `Official portal rejected recharge: Trn No ${postDialogRow.trnNo} marked as ${postDialogRow.rawStatus}`,
    };
  }

  const resolvedTrnId = portalTrnId || postDialogRow?.trnNo;
  return {
    ok: true,
    status: 'submitted',
    ...(resolvedTrnId ? { portalTrnId: resolvedTrnId } : {}),
  };
}
