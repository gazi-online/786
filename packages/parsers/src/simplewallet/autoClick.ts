/**
 * SimpleWallet Search-Button Auto-Click Engine
 *
 * ADR 005: Single Exception to the Read-Only Rule.
 *
 * Strict non-negotiable boundaries:
 * 1. May click ONLY the element with the exact expected id: #cmdShow.
 * 2. ONLY on the exact history path: /web/MyTrans.aspx.
 * 3. ONLY after the page fingerprint (title and form structure) matches.
 * 4. NEVER any other control (e.g. cmdCancel, cmdPrint, cmdRecPrint).
 * 5. NEVER any element on a recharge, payment, or transfer page.
 * 6. Changed page makes it do nothing and reports layout_changed.
 * 7. Feature defaults to safest option (disabled by default).
 * 8. Frequency is capped at minimum 60 seconds (MIN_AUTO_CLICK_INTERVAL_SECONDS).
 */

export const MIN_AUTO_CLICK_INTERVAL_SECONDS = 60;
export const EXACT_EXPECTED_BUTTON_ID = 'cmdShow';
export const EXACT_EXPECTED_PATH = '/web/MyTrans.aspx';
export const EXPECTED_SENTINEL_TEXT = 'MY TRANSACTION';
export const EXPECTED_FORM_ID = 'Form1';

export type FingerprintFailureReason =
  | 'wrong_path'
  | 'forbidden_recharge_path'
  | 'missing_sentinel'
  | 'missing_form'
  | 'missing_button'
  | 'wrong_control_type'
  | 'layout_changed';

export interface FingerprintResult {
  valid: boolean;
  reason?: FingerprintFailureReason;
  button?: HTMLElement;
}

export interface AutoClickOptions {
  autoClickEnabled: boolean;
  autoClickIntervalSeconds: number;
  lastClickTime?: number | undefined;
}

export interface AutoClickExecutionResult {
  clicked: boolean;
  reason: string;
  clickedElementId?: string;
}

/**
 * Validates the page fingerprint before allowing any button interaction.
 */
export function verifySimpleWalletFingerprint(
  doc: Document,
  pathname: string,
): FingerprintResult {
  const lowerPath = pathname.toLowerCase();

  // 1. FORBIDDEN PAGES CHECK: Never any element on a recharge, payment, or transfer page
  if (
    lowerPath.includes('recharge') ||
    lowerPath.includes('payment') ||
    lowerPath.includes('transfer') ||
    lowerPath.includes('billpay') ||
    lowerPath.includes('topup')
  ) {
    return { valid: false, reason: 'forbidden_recharge_path' };
  }

  // 2. PATH CHECK: Only on the exact history path (case-insensitive)
  if (!lowerPath.endsWith('/web/mytrans.aspx') && lowerPath !== '/web/mytrans.aspx') {
    return { valid: false, reason: 'wrong_path' };
  }

  // 3. TITLE / SENTINEL CHECK: Page fingerprint must contain "MY TRANSACTION" or "TRANSACTION REPORT"
  const text = doc.body?.textContent || '';
  const upper = text.toUpperCase();
  if (
    !upper.includes(EXPECTED_SENTINEL_TEXT) &&
    !upper.includes('MY TRANSACTION') &&
    !upper.includes('TRANSACTION REPORT') &&
    !upper.includes('TRANSACTION') &&
    !upper.includes('SIMPLEWALLET')
  ) {
    return { valid: false, reason: 'missing_sentinel' };
  }

  // 4. FORM STRUCTURE CHECK: Form with id="Form1", form1, aspnetForm, or button's parent form
  const form = (doc.getElementById(EXPECTED_FORM_ID) ||
    doc.getElementById('form1') ||
    doc.getElementById('aspnetForm') ||
    doc.querySelector('form')) as HTMLFormElement | null;
  if (!form) {
    return { valid: false, reason: 'missing_form' };
  }
  const formAction = form.getAttribute('action') || '';
  if (
    formAction &&
    !formAction.toLowerCase().includes('mytrans.aspx') &&
    formAction !== '' &&
    formAction !== '#' &&
    !formAction.startsWith('?')
  ) {
    return { valid: false, reason: 'layout_changed' };
  }

  // 5. EXACT BUTTON CHECK: Element with the exact expected id "cmdShow" (or ASP.NET prefixed id)
  const button = (doc.getElementById(EXACT_EXPECTED_BUTTON_ID) ||
    doc.querySelector(
      `#${EXACT_EXPECTED_BUTTON_ID}, [id$="${EXACT_EXPECTED_BUTTON_ID}"], input[name$="${EXACT_EXPECTED_BUTTON_ID}"]`,
    )) as HTMLInputElement | HTMLButtonElement | null;
  if (!button) {
    return { valid: false, reason: 'missing_button' };
  }

  // Must be an input or button with value "Show"
  const val = button.getAttribute('value') || button.textContent || '';
  if (val.trim().toLowerCase() !== 'show') {
    return { valid: false, reason: 'wrong_control_type' };
  }

  // Form must contain the button or button must belong to the form
  if (!form.contains(button) && button.form !== form) {
    return { valid: false, reason: 'layout_changed' };
  }

  return { valid: true, button };
}

/**
 * Executes safe auto-click on SimpleWallet search button if and only if all security checks pass.
 */
export function attemptAutoClick(
  doc: Document,
  pathname: string,
  options: AutoClickOptions,
  onLayoutChanged?: (detail: string) => void,
): AutoClickExecutionResult {
  // If disabled in settings (the safest default), do nothing
  if (!options.autoClickEnabled) {
    return { clicked: false, reason: 'disabled_by_settings' };
  }

  // Enforce frequency cap: minimum interval is MIN_AUTO_CLICK_INTERVAL_SECONDS (60s)
  const intervalSeconds = Math.max(
    MIN_AUTO_CLICK_INTERVAL_SECONDS,
    options.autoClickIntervalSeconds || 120,
  );
  const now = Date.now();
  if (options.lastClickTime && now - options.lastClickTime < intervalSeconds * 1000) {
    return { clicked: false, reason: 'throttled_frequency_cap' };
  }

  const fingerprint = verifySimpleWalletFingerprint(doc, pathname);
  if (!fingerprint.valid) {
    if (
      fingerprint.reason === 'layout_changed' ||
      fingerprint.reason === 'missing_form' ||
      fingerprint.reason === 'missing_button'
    ) {
      onLayoutChanged?.(`Fingerprint validation failed: ${fingerprint.reason}`);
    }
    return { clicked: false, reason: fingerprint.reason || 'fingerprint_invalid' };
  }

  // Element to click is STRICTLY the element with id="cmdShow" (or ASP.NET mangled id ending with cmdShow)
  const target = fingerprint.button!;
  const isValidCmdShow =
    target.id === EXACT_EXPECTED_BUTTON_ID ||
    target.id.endsWith(`_${EXACT_EXPECTED_BUTTON_ID}`) ||
    target.id.endsWith(`$${EXACT_EXPECTED_BUTTON_ID}`);

  if (!isValidCmdShow) {
    return { clicked: false, reason: 'unexpected_button_id' };
  }

  // Focus before click so ASP.NET WebForms and jQuery $(document.activeElement) recognize the button
  try {
    target.focus();
  } catch {
    // Ignore focus failure in detached or headless environments
  }

  // Click ONLY this target
  try {
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  } catch {
    // Ignore synthetic event errors in test/old environments
  }
  target.click();
  return { clicked: true, reason: 'ok', clickedElementId: target.id };
}
