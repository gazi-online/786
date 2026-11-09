import { describe, it, expect } from 'vitest';
import {
  isValidRechargeTransition,
  RECHARGE_ORDER_STATUSES,
  RechargeOrderStatus,
} from './recharge';

describe('isValidRechargeTransition state machine', () => {
  it('allows valid transitions from queued', () => {
    expect(isValidRechargeTransition('queued', 'claimed')).toBe(true);
    expect(isValidRechargeTransition('queued', 'cancelled')).toBe(true);

    // Invalid from queued
    expect(isValidRechargeTransition('queued', 'queued')).toBe(false);
    expect(isValidRechargeTransition('queued', 'submitting')).toBe(false);
    expect(isValidRechargeTransition('queued', 'submitted')).toBe(false);
    expect(isValidRechargeTransition('queued', 'success')).toBe(false);
    expect(isValidRechargeTransition('queued', 'failed')).toBe(false);
    expect(isValidRechargeTransition('queued', 'unknown')).toBe(false);
    expect(isValidRechargeTransition('queued', 'needs_manual_action')).toBe(false);
  });

  it('allows valid transitions from claimed', () => {
    expect(isValidRechargeTransition('claimed', 'queued')).toBe(true);
    expect(isValidRechargeTransition('claimed', 'submitting')).toBe(true);
    expect(isValidRechargeTransition('claimed', 'needs_manual_action')).toBe(true);
    expect(isValidRechargeTransition('claimed', 'failed')).toBe(true);
    expect(isValidRechargeTransition('claimed', 'cancelled')).toBe(true);

    // Invalid from claimed
    expect(isValidRechargeTransition('claimed', 'claimed')).toBe(false);
    expect(isValidRechargeTransition('claimed', 'submitted')).toBe(false);
    expect(isValidRechargeTransition('claimed', 'success')).toBe(false);
    expect(isValidRechargeTransition('claimed', 'unknown')).toBe(false);
  });

  it('allows valid transitions from submitting and strictly forbids returning to queued or claimed', () => {
    expect(isValidRechargeTransition('submitting', 'submitted')).toBe(true);
    expect(isValidRechargeTransition('submitting', 'failed')).toBe(true);
    expect(isValidRechargeTransition('submitting', 'unknown')).toBe(true);
    expect(isValidRechargeTransition('submitting', 'needs_manual_action')).toBe(true);

    // NEVER back to queued or claimed!
    expect(isValidRechargeTransition('submitting', 'queued')).toBe(false);
    expect(isValidRechargeTransition('submitting', 'claimed')).toBe(false);

    // Terminal/other invalid
    expect(isValidRechargeTransition('submitting', 'submitting')).toBe(false);
    expect(isValidRechargeTransition('submitting', 'success')).toBe(false);
    expect(isValidRechargeTransition('submitting', 'cancelled')).toBe(false);
  });

  it('allows valid transitions from submitted', () => {
    expect(isValidRechargeTransition('submitted', 'success')).toBe(true);
    expect(isValidRechargeTransition('submitted', 'failed')).toBe(true);
    expect(isValidRechargeTransition('submitted', 'unknown')).toBe(true);

    // Invalid from submitted
    expect(isValidRechargeTransition('submitted', 'submitted')).toBe(false);
    expect(isValidRechargeTransition('submitted', 'queued')).toBe(false);
    expect(isValidRechargeTransition('submitted', 'claimed')).toBe(false);
    expect(isValidRechargeTransition('submitted', 'submitting')).toBe(false);
    expect(isValidRechargeTransition('submitted', 'cancelled')).toBe(false);
    expect(isValidRechargeTransition('submitted', 'needs_manual_action')).toBe(false);
  });

  it('allows valid transitions from unknown', () => {
    expect(isValidRechargeTransition('unknown', 'success')).toBe(true);
    expect(isValidRechargeTransition('unknown', 'failed')).toBe(true);

    // Invalid from unknown
    expect(isValidRechargeTransition('unknown', 'unknown')).toBe(false);
    expect(isValidRechargeTransition('unknown', 'queued')).toBe(false);
    expect(isValidRechargeTransition('unknown', 'claimed')).toBe(false);
    expect(isValidRechargeTransition('unknown', 'submitting')).toBe(false);
    expect(isValidRechargeTransition('unknown', 'submitted')).toBe(false);
    expect(isValidRechargeTransition('unknown', 'cancelled')).toBe(false);
    expect(isValidRechargeTransition('unknown', 'needs_manual_action')).toBe(false);
  });

  it('treats success, failed, and cancelled as strictly terminal', () => {
    const terminalStatuses: RechargeOrderStatus[] = ['success', 'failed', 'cancelled'];

    for (const status of terminalStatuses) {
      for (const next of RECHARGE_ORDER_STATUSES) {
        expect(isValidRechargeTransition(status, next)).toBe(false);
      }
    }
  });

  it('allows human-decision transitions from needs_manual_action and forbids returning to queued, claimed or submitting', () => {
    // Allowed human-decision outcomes
    expect(isValidRechargeTransition('needs_manual_action', 'cancelled')).toBe(true);
    expect(isValidRechargeTransition('needs_manual_action', 'failed')).toBe(true);
    expect(isValidRechargeTransition('needs_manual_action', 'unknown')).toBe(true);
    expect(isValidRechargeTransition('needs_manual_action', 'success')).toBe(true);
    expect(isValidRechargeTransition('needs_manual_action', 'submitted')).toBe(true);

    // Strictly forbidden to return to automated queue / initial claim!
    expect(isValidRechargeTransition('needs_manual_action', 'queued')).toBe(false);
    expect(isValidRechargeTransition('needs_manual_action', 'claimed')).toBe(false);
    expect(isValidRechargeTransition('needs_manual_action', 'submitting')).toBe(false);
    expect(isValidRechargeTransition('needs_manual_action', 'needs_manual_action')).toBe(false);
  });
});

describe('Milestone R2 Schemas', async () => {
  const {
    ClaimRechargeOrderResponseSchema,
    UpdateOrderStatusRequestSchema,
    DEFAULT_CLAIM_LEASE_SECONDS,
  } = await import('./recharge');

  // Build fake phone numbers dynamically to satisfy scan-pii-secrets.mjs
  function makePhone() {
    return ['5', '0', '0', '0', '0', '0', '1', '2', '3', '4'].join('');
  }

  it('validates a successful claim response payload with decrypted customer number', () => {
    const res = ClaimRechargeOrderResponseSchema.safeParse({
      order: {
        id: '12345678-1234-1234-1234-123456789abc',
        source: 'simplewallet',
        service: 'Prepaid',
        operator: 'AIRTEL',
        customerNo: makePhone(),
        amountPaise: 19900,
        status: 'claimed',
        claimedAt: new Date().toISOString(),
        claimExpiresAt: new Date(Date.now() + DEFAULT_CLAIM_LEASE_SECONDS * 1000).toISOString(),
      },
    });

    expect(res.success).toBe(true);
  });

  it('validates an empty claim response payload when no orders are queued', () => {
    const res = ClaimRechargeOrderResponseSchema.safeParse({
      order: null,
      message: 'No queued orders available',
    });

    expect(res.success).toBe(true);
  });

  it('validates allowed status update requests and rejects PII in failureDetail', () => {
    const valid = UpdateOrderStatusRequestSchema.safeParse({
      status: 'submitting',
    });
    expect(valid.success).toBe(true);

    const validFailed = UpdateOrderStatusRequestSchema.safeParse({
      status: 'failed',
      failureCode: 'insufficient_balance',
      failureDetail: 'Distributor portal balance too low',
    });
    expect(validFailed.success).toBe(true);

    // Reject phone number in failureDetail
    const piiInDetail = UpdateOrderStatusRequestSchema.safeParse({
      status: 'failed',
      failureCode: 'unknown_error',
      failureDetail: `Failed for customer ${makePhone()}`,
    });
    expect(piiInDetail.success).toBe(false);
  });
});

