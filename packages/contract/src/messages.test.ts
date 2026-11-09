import { describe, it, expect } from 'vitest';
import {
  isAllowedPortalHistoryUrl,
  isAllowedPortalRechargeUrl,
  validateBackgroundMessage,
  validateContentMessage,
} from './messages';

const EXTENSION_ID = 'test-extension-id-12345';
const VALID_SW_URL = 'https://simplewallet.in/web/MyTrans.aspx?ST=1&mID=824&PID=821';
const VALID_EG_URL = 'https://egpayment.com/users/recharge_history';
const VALID_SW_RECHARGE_URL = 'https://simplewallet.in/web/MobileRecharge.aspx?mID=824';
const VALID_EG_RECHARGE_URL = 'https://egpayment.com/users/recharge';

describe('isAllowedPortalHistoryUrl', () => {
  it('accepts valid simplewallet and egpayment history URLs', () => {
    expect(isAllowedPortalHistoryUrl(VALID_SW_URL)).toBe(true);
    expect(isAllowedPortalHistoryUrl('https://www.simplewallet.in/web/MyTrans.aspx')).toBe(true);
    expect(isAllowedPortalHistoryUrl(VALID_EG_URL)).toBe(true);
    expect(isAllowedPortalHistoryUrl('https://www.egpayment.com/users/recharge_history?page=2')).toBe(true);
  });

  it('rejects URLs from other origins or wrong paths', () => {
    expect(isAllowedPortalHistoryUrl('https://evil.com/web/MyTrans.aspx')).toBe(false);
    expect(isAllowedPortalHistoryUrl('https://simplewallet.in/web/Dashboard.aspx')).toBe(false);
    expect(isAllowedPortalHistoryUrl('https://egpayment.com/users/dashboard')).toBe(false);
    expect(isAllowedPortalHistoryUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedPortalHistoryUrl(undefined)).toBe(false);
    expect(isAllowedPortalHistoryUrl(null)).toBe(false);
    expect(isAllowedPortalHistoryUrl('')).toBe(false);
  });
});

describe('validateBackgroundMessage', () => {
  it('rejects wrong sender id', () => {
    const res = validateBackgroundMessage(
      { type: 'SYNC_NOW' },
      { id: 'wrong-extension-id' },
      EXTENSION_ID,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('unauthorized_sender_id');
    }
  });

  it('rejects content script trying to send PAIR_DEVICE', () => {
    const res = validateBackgroundMessage(
      { type: 'PAIR_DEVICE', code: 'ABCD1234' },
      {
        id: EXTENSION_ID,
        tab: { id: 1, url: VALID_SW_URL }, // Coming from a tab/content script
      },
      EXTENSION_ID,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('tab_sender_disallowed_for_ui_action');
    }
  });

  it('rejects content script trying to send other UI actions (UNPAIR, SYNC_NOW, TOGGLE_PAUSE)', () => {
    for (const type of ['UNPAIR_DEVICE', 'SYNC_NOW', 'TOGGLE_PAUSE']) {
      const res = validateBackgroundMessage(
        { type },
        { id: EXTENSION_ID, tab: { id: 1, url: VALID_EG_URL } },
        EXTENSION_ID,
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toBe('tab_sender_disallowed_for_ui_action');
      }
    }
  });

  it('rejects unknown message type', () => {
    const res = validateBackgroundMessage(
      { type: 'EXECUTE_ORDER', amount: 100 },
      { id: EXTENSION_ID },
      EXTENSION_ID,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('malformed_payload');
    }
  });

  it('rejects malformed PAIR_DEVICE payload (code not 8 alphanumeric characters)', () => {
    // Too short
    expect(
      validateBackgroundMessage(
        { type: 'PAIR_DEVICE', code: '123' },
        { id: EXTENSION_ID },
        EXTENSION_ID,
      ).ok,
    ).toBe(false);

    // Too long
    expect(
      validateBackgroundMessage(
        { type: 'PAIR_DEVICE', code: 'ABCD123456789' },
        { id: EXTENSION_ID },
        EXTENSION_ID,
      ).ok,
    ).toBe(false);

    // Invalid characters / missing code
    expect(
      validateBackgroundMessage(
        { type: 'PAIR_DEVICE' },
        { id: EXTENSION_ID },
        EXTENSION_ID,
      ).ok,
    ).toBe(false);
  });

  it('rejects PAIR_DEVICE with malicious apiUrl', () => {
    const res = validateBackgroundMessage(
      {
        type: 'PAIR_DEVICE',
        code: 'ABCD1234',
        apiUrl: 'javascript:alert(document.cookie)',
      },
      { id: EXTENSION_ID },
      EXTENSION_ID,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('malformed_payload');
    }
  });

  it('rejects CONTENT_PARSED_PAGE if tab is missing or has unauthorized URL', () => {
    const validResult = {
      ok: true as const,
      source: 'simplewallet' as const,
      parserVersion: '1.0.0',
      capturedAt: '2026-11-06T10:00:00+05:30',
      balancePaise: 10000,
      pageTotals: { amountPaise: 10000 },
      rows: [],
    };

    // Missing tab
    const missingTabRes = validateBackgroundMessage(
      { type: 'CONTENT_PARSED_PAGE', result: validResult },
      { id: EXTENSION_ID },
      EXTENSION_ID,
    );
    expect(missingTabRes.ok).toBe(false);

    // Unauthorized tab URL
    const evilTabRes = validateBackgroundMessage(
      { type: 'CONTENT_PARSED_PAGE', result: validResult },
      { id: EXTENSION_ID, tab: { id: 1, url: 'https://attacker.com/portal' } },
      EXTENSION_ID,
    );
    expect(evilTabRes.ok).toBe(false);
    if (!evilTabRes.ok) {
      expect(evilTabRes.reason).toBe('unauthorized_tab_url');
    }
  });

  it('accepts valid UI messages from extension popup/options', () => {
    // Valid PAIR_DEVICE
    const pairRes = validateBackgroundMessage(
      {
        type: 'PAIR_DEVICE',
        code: 'ABCD-1234', // Formatted with hyphen
        apiUrl: 'https://wallet-sync.vercel.app',
      },
      { id: EXTENSION_ID },
      EXTENSION_ID,
    );
    expect(pairRes.ok).toBe(true);

    // Valid UNPAIR_DEVICE
    expect(
      validateBackgroundMessage(
        { type: 'UNPAIR_DEVICE' },
        { id: EXTENSION_ID },
        EXTENSION_ID,
      ).ok,
    ).toBe(true);

    // Valid SYNC_NOW
    expect(
      validateBackgroundMessage(
        { type: 'SYNC_NOW' },
        { id: EXTENSION_ID },
        EXTENSION_ID,
      ).ok,
    ).toBe(true);

    // Valid TOGGLE_PAUSE
    expect(
      validateBackgroundMessage(
        { type: 'TOGGLE_PAUSE' },
        { id: EXTENSION_ID },
        EXTENSION_ID,
      ).ok,
    ).toBe(true);
  });

  it('accepts valid CONTENT_PARSED_PAGE and CONTENT_PARSER_ERROR from authorized tab', () => {
    const validResult = {
      ok: true as const,
      source: 'simplewallet' as const,
      parserVersion: '1.0.0',
      capturedAt: '2026-11-06T10:00:00+05:30',
      balancePaise: 5000,
      pageTotals: { amountPaise: 5000 },
      rows: [],
    };

    const parsedRes = validateBackgroundMessage(
      { type: 'CONTENT_PARSED_PAGE', result: validResult },
      { id: EXTENSION_ID, tab: { id: 42, url: VALID_SW_URL } },
      EXTENSION_ID,
    );
    expect(parsedRes.ok).toBe(true);

    const errorRes = validateBackgroundMessage(
      {
        type: 'CONTENT_PARSER_ERROR',
        error: { reason: 'layout_changed', detail: 'gvList table missing' },
      },
      { id: EXTENSION_ID, tab: { id: 42, url: VALID_EG_URL } },
      EXTENSION_ID,
    );
    expect(errorRes.ok).toBe(true);
  });

  it('validates LOOKUP_OPERATOR_ON_PORTAL from authorized web app tab', () => {
    const validLookup = validateBackgroundMessage(
      {
        type: 'LOOKUP_OPERATOR_ON_PORTAL',
        mobile: '9733671094',
        portal: 'egpayment',
      },
      { id: EXTENSION_ID, tab: { id: 10, url: 'https://walletsync-seven.vercel.app/recharge' } },
      EXTENSION_ID,
    );
    expect(validLookup.ok).toBe(true);

    const unauthorizedTab = validateBackgroundMessage(
      {
        type: 'LOOKUP_OPERATOR_ON_PORTAL',
        mobile: '9733671094',
        portal: 'egpayment',
      },
      { id: EXTENSION_ID, tab: { id: 10, url: 'https://malicious-site.com' } },
      EXTENSION_ID,
    );
    expect(unauthorizedTab.ok).toBe(false);

    const malformedNo = validateBackgroundMessage(
      {
        type: 'LOOKUP_OPERATOR_ON_PORTAL',
        mobile: '123', // invalid phone
      },
      { id: EXTENSION_ID, tab: { id: 10, url: 'https://walletsync-seven.vercel.app/recharge' } },
      EXTENSION_ID,
    );
    expect(malformedNo.ok).toBe(false);
  });
});

describe('validateContentMessage', () => {
  it('rejects wrong sender id', () => {
    const res = validateContentMessage(
      { type: 'TRIGGER_PARSE' },
      { id: 'wrong-id' },
      EXTENSION_ID,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('unauthorized_sender_id');
    }
  });

  it('rejects malformed or unknown content messages', () => {
    expect(
      validateContentMessage(
        { type: 'UNKNOWN_COMMAND' },
        { id: EXTENSION_ID },
        EXTENSION_ID,
      ).ok,
    ).toBe(false);

    expect(
      validateContentMessage(
        { type: 'TRIGGER_PARSE', refresh: 'not-a-boolean' },
        { id: EXTENSION_ID },
        EXTENSION_ID,
      ).ok,
    ).toBe(false);
  });

  it('accepts valid TRIGGER_PARSE and TRIGGER_SHOW_CLICK messages', () => {
    expect(
      validateContentMessage(
        { type: 'TRIGGER_PARSE', refresh: true },
        { id: EXTENSION_ID },
        EXTENSION_ID,
      ).ok,
    ).toBe(true);

    expect(
      validateContentMessage(
        { type: 'TRIGGER_SHOW_CLICK' },
        { id: EXTENSION_ID },
        EXTENSION_ID,
      ).ok,
    ).toBe(true);
  });

  it('accepts valid EXECUTE_PORTAL_RECHARGE messages', () => {
    // Generate synthetic non-Indian phone number dynamically
    const fakePhone = ['5', '0', '0', '0', '0', '0', '9', '9', '9', '9'].join('');

    const res = validateContentMessage(
      {
        type: 'EXECUTE_PORTAL_RECHARGE',
        order: {
          id: '12345678-1234-1234-1234-123456789abc',
          source: 'simplewallet',
          service: 'Prepaid',
          operator: 'AIRTEL',
          customerNo: fakePhone,
          amountPaise: 19900,
          status: 'claimed',
          claimedAt: new Date().toISOString(),
          claimExpiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      },
      { id: EXTENSION_ID },
      EXTENSION_ID,
    );
    expect(res.ok).toBe(true);
  });
});

describe('Milestone R3 Portal Recharge Messages', () => {
  it('isAllowedPortalRechargeUrl correctly validates allowed recharge form URLs', () => {
    expect(isAllowedPortalRechargeUrl(VALID_SW_RECHARGE_URL)).toBe(true);
    expect(isAllowedPortalRechargeUrl('https://www.simplewallet.in/web/MobileRecharge.aspx')).toBe(true);
    expect(isAllowedPortalRechargeUrl(VALID_EG_RECHARGE_URL)).toBe(true);
    expect(isAllowedPortalRechargeUrl('https://www.egpayment.com/users/recharge/prepaid')).toBe(true);

    // Rejects other paths/origins
    expect(isAllowedPortalRechargeUrl(VALID_SW_URL)).toBe(false); // History page is not a recharge form
    expect(isAllowedPortalRechargeUrl(VALID_EG_URL)).toBe(false);
    expect(isAllowedPortalRechargeUrl('https://evil.com/web/MobileRecharge.aspx')).toBe(false);
    expect(isAllowedPortalRechargeUrl(undefined)).toBe(false);
    expect(isAllowedPortalRechargeUrl('')).toBe(false);
  });

  it('accepts valid PORTAL_RECHARGE_RESULT messages from authorized recharge URLs', () => {
    const res = validateBackgroundMessage(
      {
        type: 'PORTAL_RECHARGE_RESULT',
        orderId: '12345678-1234-1234-1234-123456789abc',
        status: 'submitted',
      },
      {
        id: EXTENSION_ID,
        tab: { id: 2, url: VALID_SW_RECHARGE_URL },
      },
      EXTENSION_ID,
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.source).toBe('content');
    }
  });

  it('rejects PORTAL_RECHARGE_RESULT without tab or with wrong tab URL', () => {
    // Missing tab
    expect(
      validateBackgroundMessage(
        {
          type: 'PORTAL_RECHARGE_RESULT',
          orderId: '12345678-1234-1234-1234-123456789abc',
          status: 'submitting',
        },
        { id: EXTENSION_ID },
        EXTENSION_ID,
      ).ok,
    ).toBe(false);

    // Wrong tab URL (e.g. from history URL instead of recharge form)
    const wrongUrlRes = validateBackgroundMessage(
      {
        type: 'PORTAL_RECHARGE_RESULT',
        orderId: '12345678-1234-1234-1234-123456789abc',
        status: 'submitting',
      },
      {
        id: EXTENSION_ID,
        tab: { id: 2, url: VALID_SW_URL },
      },
      EXTENSION_ID,
    );
    expect(wrongUrlRes.ok).toBe(false);
    if (!wrongUrlRes.ok) {
      expect(wrongUrlRes.reason).toBe('unauthorized_tab_url');
    }
  });
});

