import { describe, it, expect, vi } from 'vitest';
import { executeEgPaymentRecharge } from './rechargeRunner';

function makeTestPhone(suffix = '4321'): string {
  return ['5', '0', '0', '0', '0', '0', suffix].join('');
}

function createMockEgPaymentDoc(options?: {
  withCaptcha?: boolean;
  withOtp?: boolean;
  loggedOut?: boolean;
  missingMobile?: boolean;
  missingOperator?: boolean;
  missingAmount?: boolean;
  missingSubmit?: boolean;
}): Document {
  const doc = new DOMParser().parseFromString('<!DOCTYPE html><html><body></body></html>', 'text/html');

  if (options?.loggedOut) {
    const banner = doc.createElement('div');
    banner.textContent = 'PLEASE LOG IN TO CONTINUE';
    doc.body.appendChild(banner);
    return doc;
  }

  if (options?.withCaptcha) {
    const captcha = doc.createElement('div');
    captcha.id = 'recaptcha-box';
    doc.body.appendChild(captcha);
  }

  if (options?.withOtp) {
    const otp = doc.createElement('div');
    otp.id = 'otp_form';
    doc.body.appendChild(otp);
  }

  if (!options?.missingMobile) {
    const mobileInput = doc.createElement('input');
    mobileInput.id = 'mobile';
    mobileInput.name = 'mobile';
    mobileInput.type = 'tel';
    doc.body.appendChild(mobileInput);
  }

  if (!options?.missingOperator) {
    const opSelect = doc.createElement('select');
    opSelect.id = 'operator';
    opSelect.name = 'operator';

    const defaultOpt = doc.createElement('option');
    defaultOpt.value = '';
    defaultOpt.text = '-- Select Operator --';
    opSelect.appendChild(defaultOpt);

    const airtelOpt = doc.createElement('option');
    airtelOpt.value = 'AIRTEL';
    airtelOpt.text = 'Airtel';
    opSelect.appendChild(airtelOpt);

    const jioOpt = doc.createElement('option');
    jioOpt.value = 'JIO';
    jioOpt.text = 'Jio Prepaid';
    opSelect.appendChild(jioOpt);

    doc.body.appendChild(opSelect);
  }

  if (!options?.missingAmount) {
    const amountInput = doc.createElement('input');
    amountInput.id = 'amount';
    amountInput.name = 'amount';
    amountInput.type = 'text';
    doc.body.appendChild(amountInput);
  }

  if (!options?.missingSubmit) {
    const submitBtn = doc.createElement('button');
    submitBtn.id = 'btnSubmit';
    submitBtn.type = 'submit';
    submitBtn.textContent = 'Proceed to Recharge';
    doc.body.appendChild(submitBtn);
  }

  return doc;
}

describe('EG Payment Recharge Form Automation Runner', () => {
  const testPhone = makeTestPhone('7777');

  it('fails with logged_out when login prompt is detected', () => {
    const doc = createMockEgPaymentDoc({ loggedOut: true });
    const result = executeEgPaymentRecharge(doc, {
      customerNo: testPhone,
      operator: 'AIRTEL',
      amountPaise: 29900,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe('failed');
      expect(result.failureCode).toBe('logged_out');
    }
  });

  it('fails with challenge_detected and requires manual action when CAPTCHA is present', () => {
    const doc = createMockEgPaymentDoc({ withCaptcha: true });
    const result = executeEgPaymentRecharge(doc, {
      customerNo: testPhone,
      operator: 'AIRTEL',
      amountPaise: 29900,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe('needs_manual_action');
      expect(result.failureCode).toBe('challenge_detected');
    }
  });

  it('fails safely when mobile input element is missing from DOM', () => {
    const doc = createMockEgPaymentDoc({ missingMobile: true });
    const result = executeEgPaymentRecharge(doc, {
      customerNo: testPhone,
      operator: 'AIRTEL',
      amountPaise: 29900,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe('failed');
      expect(result.failureCode).toBe('element_not_found');
    }
  });

  it('fails when requested operator is not present in dropdown', () => {
    const doc = createMockEgPaymentDoc();
    const result = executeEgPaymentRecharge(doc, {
      customerNo: testPhone,
      operator: 'BSNL',
      amountPaise: 29900,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe('failed');
      expect(result.failureCode).toBe('operator_mismatch');
    }
  });

  it('successfully fills form, round-trip verifies, and clicks submit button', () => {
    const doc = createMockEgPaymentDoc();
    const submitBtn = doc.getElementById('btnSubmit') as HTMLButtonElement;
    const clickSpy = vi.spyOn(submitBtn, 'click');

    const result = executeEgPaymentRecharge(doc, {
      customerNo: testPhone,
      operator: 'JIO',
      amountPaise: 19900,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe('submitted');
    }

    const mobileInput = doc.getElementById('mobile') as HTMLInputElement;
    const opSelect = doc.getElementById('operator') as HTMLSelectElement;
    const amountInput = doc.getElementById('amount') as HTMLInputElement;

    expect(mobileInput.value).toBe(testPhone);
    expect(opSelect.value).toBe('JIO');
    expect(amountInput.value).toBe('199.00');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});

