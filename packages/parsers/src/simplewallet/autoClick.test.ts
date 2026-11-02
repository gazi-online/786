import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  attemptAutoClick,
  verifySimpleWalletFingerprint,
  MIN_AUTO_CLICK_INTERVAL_SECONDS,
  EXACT_EXPECTED_BUTTON_ID,
} from './autoClick.js';

function loadFixture(name: string): Document {
  const root = join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'simplewallet');
  const html = readFileSync(join(root, name), 'utf-8');
  // Strip script and link tags to avoid Happy-DOM network fetch attempts
  const cleanHtml = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<link\b[^>]*>/gi, '');
  return new DOMParser().parseFromString(cleanHtml, 'text/html');
}

describe('ADR 005: Auto-Click Single Exception Security & Fingerprint Enforcer', () => {
  const validPath = '/web/MyTrans.aspx';

  it('proves that only #cmdShow is clicked and other buttons (cancel, export, receipt print) are NEVER clicked', () => {
    const doc = loadFixture('normal-day.html');

    const cmdShow = doc.getElementById('cmdShow') as HTMLInputElement;
    const cmdCancel = doc.getElementById('cmdCancel') as HTMLInputElement;
    const cmdPrint = doc.getElementById('cmdPrint') as HTMLInputElement;
    const receiptButtons = Array.from(doc.querySelectorAll('input[id*="cmdRecPrint"]')) as HTMLInputElement[];

    expect(cmdShow).toBeDefined();
    expect(cmdCancel).toBeDefined();
    expect(cmdPrint).toBeDefined();
    expect(receiptButtons.length).toBeGreaterThan(0);

    // Prevent default form navigation in happy-dom unit test environment
    cmdShow.addEventListener('click', (e) => e.preventDefault());
    cmdCancel.addEventListener('click', (e) => e.preventDefault());
    cmdPrint.addEventListener('click', (e) => e.preventDefault());

    const showClickSpy = vi.spyOn(cmdShow, 'click');
    const cancelClickSpy = vi.spyOn(cmdCancel, 'click');
    const printClickSpy = vi.spyOn(cmdPrint, 'click');
    const receiptSpies = receiptButtons.map((btn) => vi.spyOn(btn, 'click'));

    const result = attemptAutoClick(doc, validPath, {
      autoClickEnabled: true,
      autoClickIntervalSeconds: 120,
    });

    expect(result.clicked).toBe(true);
    expect(result.clickedElementId).toBe(EXACT_EXPECTED_BUTTON_ID);

    // Assert strictly: ONLY #cmdShow was clicked
    expect(showClickSpy).toHaveBeenCalledTimes(1);

    // Other controls were NEVER clicked
    expect(cancelClickSpy).not.toHaveBeenCalled();
    expect(printClickSpy).not.toHaveBeenCalled();
    for (const rSpy of receiptSpies) {
      expect(rSpy).not.toHaveBeenCalled();
    }
  });

  it('proves that a changed page makes it do nothing and reports layout_changed', () => {
    const doc = loadFixture('layout-changed.html');
    let reportedLayoutChanged = false;

    const result = attemptAutoClick(
      doc,
      validPath,
      {
        autoClickEnabled: true,
        autoClickIntervalSeconds: 120,
      },
      (detail) => {
        reportedLayoutChanged = true;
        expect(detail).toContain('Fingerprint validation failed');
      },
    );

    expect(result.clicked).toBe(false);
    expect(reportedLayoutChanged).toBe(true);
  });

  it('refuses to click any button on a recharge, payment, or transfer page', () => {
    const doc = loadFixture('normal-day.html');
    const cmdShow = doc.getElementById('cmdShow') as HTMLInputElement;
    const showClickSpy = vi.spyOn(cmdShow, 'click');

    const forbiddenPaths = [
      '/web/MobileRecharge.aspx',
      '/web/DTHRecharge.aspx',
      '/web/BillPayment.aspx',
      '/web/FundTransfer.aspx',
      '/users/payment_gateway',
    ];

    for (const forbiddenPath of forbiddenPaths) {
      const result = attemptAutoClick(doc, forbiddenPath, {
        autoClickEnabled: true,
        autoClickIntervalSeconds: 120,
      });

      expect(result.clicked).toBe(false);
      expect(result.reason).toBe('forbidden_recharge_path');
      expect(showClickSpy).not.toHaveBeenCalled();
    }
  });

  it('defaults to safest option: does nothing when autoClickEnabled is false', () => {
    const doc = loadFixture('normal-day.html');
    const cmdShow = doc.getElementById('cmdShow') as HTMLInputElement;
    const showClickSpy = vi.spyOn(cmdShow, 'click');

    const result = attemptAutoClick(doc, validPath, {
      autoClickEnabled: false,
      autoClickIntervalSeconds: 120,
    });

    expect(result.clicked).toBe(false);
    expect(result.reason).toBe('disabled_by_settings');
    expect(showClickSpy).not.toHaveBeenCalled();
  });

  it('enforces frequency cap: throttles if called within minimum interval (60s)', () => {
    const doc = loadFixture('normal-day.html');
    const cmdShow = doc.getElementById('cmdShow') as HTMLInputElement;
    const showClickSpy = vi.spyOn(cmdShow, 'click');

    const now = Date.now();
    const result = attemptAutoClick(doc, validPath, {
      autoClickEnabled: true,
      autoClickIntervalSeconds: MIN_AUTO_CLICK_INTERVAL_SECONDS,
      lastClickTime: now - 30 * 1000, // only 30s ago
    });

    expect(result.clicked).toBe(false);
    expect(result.reason).toBe('throttled_frequency_cap');
    expect(showClickSpy).not.toHaveBeenCalled();
  });

  it('reports wrong_path when not on /web/MyTrans.aspx', () => {
    const doc = loadFixture('normal-day.html');
    const res = verifySimpleWalletFingerprint(doc, '/web/OtherPage.aspx');
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('wrong_path');
  });
});
