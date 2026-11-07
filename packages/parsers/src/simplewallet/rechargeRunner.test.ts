import { describe, it, expect, vi } from 'vitest';
import { executeSimpleWalletRecharge } from './rechargeRunner';

function createMockRechargeDoc(options?: {
  withCaptcha?: boolean;
  withOtp?: boolean;
  loggedOut?: boolean;
  missingMobile?: boolean;
  missingOperator?: boolean;
  missingAmount?: boolean;
  missingSubmit?: boolean;
  portalCardsFlow?: boolean;
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
    captcha.id = 'recaptcha-widget';
    doc.body.appendChild(captcha);
  }

  if (options?.withOtp) {
    const otp = doc.createElement('div');
    otp.className = 'otp-modal';
    doc.body.appendChild(otp);
  }

  if (options?.portalCardsFlow) {
    // Official portal cards layout
    const container = doc.createElement('div');
    container.className = 'operator-container';

    const jioCard = doc.createElement('div');
    jioCard.className = 'operator-card';
    const jioImg = doc.createElement('img');
    jioImg.src = '/images/operators/jio.png';
    jioImg.alt = 'JIO';
    jioCard.appendChild(jioImg);
    container.appendChild(jioCard);

    const airtelCard = doc.createElement('div');
    airtelCard.className = 'operator-card';
    const airtelImg = doc.createElement('img');
    airtelImg.src = '/images/operators/airtel.png';
    airtelImg.alt = 'AIRTEL';
    airtelCard.appendChild(airtelImg);
    container.appendChild(airtelCard);

    doc.body.appendChild(container);

    const mobileInput = doc.createElement('input');
    mobileInput.id = 'txtMobile';
    doc.body.appendChild(mobileInput);

    const amountInput = doc.createElement('input');
    amountInput.id = 'txtAmount';
    doc.body.appendChild(amountInput);

    const submitBtn = doc.createElement('button');
    submitBtn.textContent = 'Recharge';
    doc.body.appendChild(submitBtn);

    const payNowBtn = doc.createElement('button');
    payNowBtn.textContent = 'Pay Now';
    doc.body.appendChild(payNowBtn);

    const okBtn = doc.createElement('button');
    okBtn.textContent = 'OK';
    const msg = doc.createElement('div');
    msg.textContent = 'Transaction accepted, Trn No: 27794218';
    doc.body.appendChild(msg);
    doc.body.appendChild(okBtn);

    return doc;
  }

  // Dropdown fallback layout
  if (!options?.missingMobile) {
    const mobileInput = doc.createElement('input');
    mobileInput.id = 'txtMobile';
    mobileInput.type = 'text';
    doc.body.appendChild(mobileInput);
  }

  if (!options?.missingOperator) {
    const opSelect = doc.createElement('select');
    opSelect.id = 'ddlOperator';

    const defaultOpt = doc.createElement('option');
    defaultOpt.value = '';
    defaultOpt.text = '-- Select Operator --';
    opSelect.appendChild(defaultOpt);

    const airtelOpt = doc.createElement('option');
    airtelOpt.value = '1';
    airtelOpt.text = 'AIRTEL PREPAID';
    opSelect.appendChild(airtelOpt);

    const jioOpt = doc.createElement('option');
    jioOpt.value = '2';
    jioOpt.text = 'JIO 4G';
    opSelect.appendChild(jioOpt);

    doc.body.appendChild(opSelect);
  }

  if (!options?.missingAmount) {
    const amountInput = doc.createElement('input');
    amountInput.id = 'txtAmount';
    amountInput.type = 'text';
    doc.body.appendChild(amountInput);
  }

  if (!options?.missingSubmit) {
    const submitBtn = doc.createElement('input');
    submitBtn.id = 'btnRecharge';
    submitBtn.type = 'submit';
    submitBtn.value = 'Proceed to Recharge';
    doc.body.appendChild(submitBtn);
  }

  return doc;
}

describe('SimpleWallet Recharge Form Runner (Milestone R3)', () => {
  function makePhone() {
    return ['5', '0', '0', '0', '0', '0', '7', '8', '9', '0'].join('');
  }

  it('successfully executes official portal cards flow with confirmation modal and OK dialog', async () => {
    const doc = createMockRechargeDoc({ portalCardsFlow: true });
    const phone = makePhone();
    const result = await executeSimpleWalletRecharge(doc, {
      customerNo: phone,
      operator: 'JIO',
      amountPaise: 29900,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe('submitted');
      expect(result.portalTrnId).toBe('27794218');
    }
  });

  it('successfully fills mobile, operator, amount and clicks submit button on dropdown fallback', async () => {
    const doc = createMockRechargeDoc();
    const submitBtn = doc.getElementById('btnRecharge') as HTMLInputElement;
    const clickSpy = vi.spyOn(submitBtn, 'click');

    const phone = makePhone();
    const result = await executeSimpleWalletRecharge(doc, {
      customerNo: phone,
      operator: 'AIRTEL',
      amountPaise: 29900,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe('submitted');
    }

    const mobileInput = doc.getElementById('txtMobile') as HTMLInputElement;
    const opSelect = doc.getElementById('ddlOperator') as HTMLSelectElement;
    const amountInput = doc.getElementById('txtAmount') as HTMLInputElement;

    expect(mobileInput.value).toBe(phone);
    expect(opSelect.value).toBe('1'); // AIRTEL
    expect(amountInput.value).toBe('299');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('returns operator_mismatch failure when operator is not available in dropdown or cards', async () => {
    const doc = createMockRechargeDoc();
    const result = await executeSimpleWalletRecharge(doc, {
      customerNo: makePhone(),
      operator: 'UNKNOWN_OP',
      amountPaise: 19900,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe('failed');
      expect(result.failureCode).toBe('operator_mismatch');
    }
  });

  it('returns needs_manual_action when CAPTCHA is detected on page', async () => {
    const doc = createMockRechargeDoc({ withCaptcha: true });
    const result = await executeSimpleWalletRecharge(doc, {
      customerNo: makePhone(),
      operator: 'JIO',
      amountPaise: 19900,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe('needs_manual_action');
      expect(result.failureCode).toBe('challenge_detected');
    }
  });

  it('returns needs_manual_action when OTP modal is detected on page', async () => {
    const doc = createMockRechargeDoc({ withOtp: true });
    const result = await executeSimpleWalletRecharge(doc, {
      customerNo: makePhone(),
      operator: 'JIO',
      amountPaise: 19900,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe('needs_manual_action');
      expect(result.failureCode).toBe('challenge_detected');
    }
  });

  it('returns failed logged_out when page displays logged-out banner', async () => {
    const doc = createMockRechargeDoc({ loggedOut: true });
    const result = await executeSimpleWalletRecharge(doc, {
      customerNo: makePhone(),
      operator: 'AIRTEL',
      amountPaise: 10000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe('failed');
      expect(result.failureCode).toBe('logged_out');
    }
  });

  it('returns element_not_found failure if required input is missing', async () => {
    const doc = createMockRechargeDoc({ missingAmount: true });
    const result = await executeSimpleWalletRecharge(doc, {
      customerNo: makePhone(),
      operator: 'AIRTEL',
      amountPaise: 10000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe('failed');
      expect(result.failureCode).toBe('element_not_found');
    }
  });
});
