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
  withMPinModal?: boolean;
  withProcessTransaction?: boolean;
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
    mobileInput.placeholder = 'Enter Mobile Number';
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
    amountInput.placeholder = 'Enter Amount';
    amountInput.type = 'text';
    doc.body.appendChild(amountInput);
  }

  if (!options?.missingSubmit) {
    const submitBtn = doc.createElement('button');
    submitBtn.id = 'btnSubmit';
    submitBtn.type = 'submit';
    submitBtn.textContent = 'Submit';
    doc.body.appendChild(submitBtn);
  }

  if (options?.withMPinModal) {
    const modal = doc.createElement('div');
    modal.className = 'modal in';
    modal.innerHTML = `
      <div>Confirm Number & Amount</div>
      <div>Operator : Vi</div>
      <div>Number : 9733671094</div>
      <div>Amount : ₹349</div>
      <div>M Pin</div>
      <input type="password" placeholder="Enter your 4 Digit M Pin" id="mPinInput" />
      <button id="btnConfirm">CONFIRM</button>
    `;
    doc.body.appendChild(modal);
  }

  if (options?.withProcessTransaction) {
    const payModal = doc.createElement('div');
    payModal.innerHTML = `
      <div>Process Transaction</div>
      <button id="btnPayProceed">Pay ₹ 347 to proceed</button>
    `;
    const btn = payModal.querySelector('button');
    btn?.addEventListener('click', () => {
      // Simulate opening QR modal upon clicking Pay Proceed
      const qrModal = doc.createElement('div');
      qrModal.innerHTML = `
        <div>Payment Processing.</div>
        <img src="data:image/png;base64,mockQrCodeData" class="qr-code" width="200" height="200" />
        <div>Order Expring In</div>
        <div>9M : 58S</div>
        <div>Scan the QR with any UPI app.</div>
      `;
      doc.body.appendChild(qrModal);
    });
    doc.body.appendChild(payModal);
  }

  return doc;
}

describe('EG Payment Recharge Form Automation Runner (Milestone R5)', () => {
  const testPhone = makeTestPhone('7777');

  it('fails with logged_out when login prompt is detected', async () => {
    const doc = createMockEgPaymentDoc({ loggedOut: true });
    const result = await executeEgPaymentRecharge(doc, {
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

  it('fails with challenge_detected and requires manual action when CAPTCHA is present', async () => {
    const doc = createMockEgPaymentDoc({ withCaptcha: true });
    const result = await executeEgPaymentRecharge(doc, {
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

  it('fails safely when mobile input element is missing from DOM', async () => {
    const doc = createMockEgPaymentDoc({ missingMobile: true });
    const result = await executeEgPaymentRecharge(doc, {
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

  it('successfully fills form and clicks submit button', async () => {
    const doc = createMockEgPaymentDoc();
    const submitBtn = doc.getElementById('btnSubmit') as HTMLButtonElement;
    const clickSpy = vi.spyOn(submitBtn, 'click');

    const result = await executeEgPaymentRecharge(doc, {
      customerNo: testPhone,
      operator: 'JIO',
      amountPaise: 19900,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe('submitted');
    }

    const mobileInput = doc.getElementById('mobile') as HTMLInputElement;
    const amountInput = doc.getElementById('amount') as HTMLInputElement;

    expect(mobileInput.value).toBe(testPhone);
    expect(amountInput.value).toBe('199');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('handles M-Pin confirmation modal by filling 4-digit pin and clicking CONFIRM', async () => {
    const doc = createMockEgPaymentDoc({ withMPinModal: true });
    const result = await executeEgPaymentRecharge(doc, {
      customerNo: testPhone,
      operator: 'JIO',
      amountPaise: 34900,
      mPin: '1234',
    });

    const pinInput = doc.getElementById('mPinInput') as HTMLInputElement;
    expect(pinInput.value).toBe('1234');
    expect(result.ok).toBe(true);
  });

  it('detects insufficient balance, clicks Pay Proceed, and emits dynamic QR code data', async () => {
    const doc = createMockEgPaymentDoc({ withProcessTransaction: true });
    const qrCallback = vi.fn();

    const result = await executeEgPaymentRecharge(doc, {
      customerNo: testPhone,
      operator: 'JIO',
      amountPaise: 34900,
      onQrCodeDetected: qrCallback,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe('needs_manual_action');
      expect(result.failureCode).toBe('qr_payment_required');
    }

    expect(qrCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        qrDataUrl: 'data:image/png;base64,mockQrCodeData',
        amountText: '₹347',
        timerText: '9M:58S',
      }),
    );
  });

  it('detects insufficient balance, captures dynamic QR, and waits until payment is confirmed on portal to transition to submitted', async () => {
    const doc = createMockEgPaymentDoc({ withProcessTransaction: true });
    const qrCallback = vi.fn(() => {
      // Simulate user scanning QR code and paying via UPI: modal closes and success text is rendered
      setTimeout(() => {
        doc.body.innerHTML = '<div>Recharge Successful! Transaction Accepted.</div>';
      }, 40);
    });

    const result = await executeEgPaymentRecharge(doc, {
      customerNo: testPhone,
      operator: 'JIO',
      amountPaise: 34900,
      waitForPaymentCompletion: true,
      paymentWaitTimeoutMs: 1000,
      onQrCodeDetected: qrCallback,
    });

    expect(qrCallback).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.status).toBe('submitted');
  });

  it('does NOT prematurely transition to submitted while QR modal is still open, even if background text contains request accepted', async () => {
    const doc = createMockEgPaymentDoc({ withProcessTransaction: true });
    // Add background disclaimer containing "request accepted"
    const disclaimer = doc.createElement('div');
    disclaimer.textContent = 'Terms: Once request accepted, processing will take 2 minutes.';
    doc.body.appendChild(disclaimer);

    const qrCallback = vi.fn();
    // Do NOT close the QR modal; let it stay open until timeout
    const result = await executeEgPaymentRecharge(doc, {
      customerNo: testPhone,
      operator: 'JIO',
      amountPaise: 34900,
      waitForPaymentCompletion: true,
      paymentWaitTimeoutMs: 150,
      onQrCodeDetected: qrCallback,
    });

    expect(qrCallback).toHaveBeenCalled();
    // Must NOT be 'submitted' because payment was never captured!
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe('needs_manual_action');
      expect(result.failureCode).toBe('qr_payment_timeout');
    }
  });

  it('does NOT mistake placeholder EG Payment logo for a QR code and waits for genuine QR code', async () => {
    const doc = createMockEgPaymentDoc();
    const qrModal = doc.createElement('div');
    // Initially contains placeholder EG logo and spinner
    qrModal.innerHTML = `
      <div>EG Payment Gateway</div>
      <div>Payment Processing.</div>
      <img src="assets/img/egpayment-logo.png" alt="EG Payment" width="150" height="150" />
      <div>Order Expiring In</div>
      <div>10M:0S</div>
      <button class="pay-btn">Pay ₹297</button>
      <div>Scan the QR with any UPI app.</div>
    `;
    doc.body.appendChild(qrModal);

    // After 40ms, simulate client-side QR generator successfully injecting the QR canvas
    setTimeout(() => {
      const canvas = doc.createElement('canvas');
      canvas.width = 200;
      canvas.height = 200;
      canvas.toDataURL = () => 'data:image/png;base64,genuineDynamicQrData';
      qrModal.appendChild(canvas);
    }, 40);

    const qrCallback = vi.fn();
    const result = await executeEgPaymentRecharge(doc, {
      customerNo: testPhone,
      operator: 'VI',
      amountPaise: 29700,
      onQrCodeDetected: qrCallback,
    });

    expect(qrCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        qrDataUrl: 'data:image/png;base64,genuineDynamicQrData',
        amountText: '₹297',
      }),
    );
  });
});
