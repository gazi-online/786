import { z } from 'zod';

export const RECHARGE_ORDER_STATUSES = [
  'draft',
  'awaiting_confirm',
  'queued',
  'claimed',
  'form_filled',
  'awaiting_payment',
  'payment_submitted',
  'submitting',
  'submitted',
  'pending',
  'success',
  'failed',
  'unknown',
  'needs_manual_action',
  'needs_review',
  'cancelled',
  'expired',
] as const;

export type RechargeOrderStatus = (typeof RECHARGE_ORDER_STATUSES)[number];

export const RechargeOrderStatusSchema = z.enum(RECHARGE_ORDER_STATUSES);

/**
 * Valid state transitions for a recharge order.
 *
 * Rules (Antigravity Guide M8: R1-R5):
 * - draft -> awaiting_confirm | cancelled
 * - awaiting_confirm -> queued | cancelled
 * - queued -> claimed | cancelled
 * - claimed -> queued (lease expired) | form_filled | submitting | needs_review | needs_manual_action | failed | cancelled
 * - form_filled -> awaiting_payment | payment_submitted | submitted | needs_review | needs_manual_action | failed | cancelled
 * - awaiting_payment -> payment_submitted | submitted | pending | needs_review | needs_manual_action | failed | cancelled | expired
 * - payment_submitted -> pending | submitted | success | failed | needs_review | needs_manual_action
 * - submitting -> submitted | payment_submitted | failed | unknown | needs_manual_action | needs_review
 * - submitted -> pending | success | failed | unknown
 * - pending -> success | failed | needs_review | unknown
 * - unknown -> success | failed (via reconciliation or audit decision)
 * - needs_manual_action / needs_review -> queued | submitted | success | failed | unknown | cancelled
 * - success, failed, cancelled, expired are terminal.
 */
const VALID_RECHARGE_TRANSITIONS: Record<RechargeOrderStatus, readonly RechargeOrderStatus[]> = {
  draft: ['awaiting_confirm', 'cancelled'],
  awaiting_confirm: ['queued', 'cancelled'],
  queued: ['claimed', 'cancelled'],
  claimed: ['queued', 'form_filled', 'submitting', 'needs_review', 'needs_manual_action', 'failed', 'cancelled'],
  form_filled: ['awaiting_payment', 'payment_submitted', 'submitted', 'needs_review', 'needs_manual_action', 'failed', 'cancelled'],
  awaiting_payment: ['payment_submitted', 'submitted', 'pending', 'needs_review', 'needs_manual_action', 'failed', 'cancelled', 'expired'],
  payment_submitted: ['pending', 'submitted', 'success', 'failed', 'needs_review', 'needs_manual_action'],
  submitting: ['submitted', 'payment_submitted', 'failed', 'unknown', 'needs_manual_action', 'needs_review'],
  submitted: ['pending', 'success', 'failed', 'unknown'],
  pending: ['success', 'failed', 'needs_review', 'unknown'],
  unknown: ['success', 'failed'],
  needs_manual_action: ['submitted', 'success', 'failed', 'unknown', 'cancelled'],
  needs_review: ['queued', 'submitted', 'success', 'failed', 'unknown', 'cancelled'],
  expired: [],
  success: [],
  failed: [],
  cancelled: [],
};

export function isValidRechargeTransition(
  current: RechargeOrderStatus,
  next: RechargeOrderStatus,
): boolean {
  if (current === next) return false;
  const allowed = VALID_RECHARGE_TRANSITIONS[current];
  return allowed ? allowed.includes(next) : false;
}

// ---------------------------------------------------------------------------
// Request & Response Schemas
// ---------------------------------------------------------------------------

export const CreateRechargeOrderRequestSchema = z.object({
  source: z.enum(['simplewallet', 'egpayment']),
  service: z.literal('Prepaid'), // V1 allows only 'Prepaid'
  operator: z.string().trim().min(1).max(64),
  circle: z.string().trim().max(64).optional(),
  customerNo: z
    .string()
    .trim()
    .regex(/^[5-9]\d{9}$/, 'Must be a valid 10-digit mobile number'),
  amountPaise: z.number().int().positive('Amount in paise must be positive integer'),
  expectedPayablePaise: z.number().int().positive().optional(),
  dryRun: z.boolean().optional(),
  confirmDuplicate: z.boolean().optional(),
  mPin: z.string().trim().regex(/^\d{4}$/, 'Must be a 4-digit M-Pin').optional(),
});
export type CreateRechargeOrderRequest = z.infer<typeof CreateRechargeOrderRequestSchema>;

export const UpdateRechargeSettingsRequestSchema = z.object({
  rechargeEnabled: z.boolean().optional(),
  perOrderMaxPaise: z.number().int().positive().optional(),
  dailyMaxPaise: z.number().int().positive().optional(),
  maxOrdersPerMinute: z.number().int().positive().optional(),
  dailyMaxCount: z.number().int().positive().optional(),
  cancelQueuedOnDisable: z.boolean().optional(),
});
export type UpdateRechargeSettingsRequest = z.infer<typeof UpdateRechargeSettingsRequestSchema>;

export const ResolveRechargeOrderRequestSchema = z.object({
  outcome: z.enum(['cancelled', 'failed', 'unknown', 'success']),
  note: z
    .string()
    .trim()
    .min(1, 'Note is required')
    .max(500, 'Note cannot exceed 500 characters')
    .refine(
      (val) => !/(?:\b|[^\da-fA-F])([5-9]\d{9})(?:\b|[^\da-fA-F])/.test(val),
      { message: 'Note must never contain phone numbers' },
    ),
});
export type ResolveRechargeOrderRequest = z.infer<typeof ResolveRechargeOrderRequestSchema>;

// ---------------------------------------------------------------------------
// Milestone R2: Claim & Extension Dispatch Schemas
// ---------------------------------------------------------------------------

export const DEFAULT_CLAIM_LEASE_SECONDS = 60;

export const ClaimedRechargeOrderSchema = z.object({
  id: z.string().uuid(),
  source: z.enum(['simplewallet', 'egpayment']),
  service: z.string(),
  operator: z.string(),
  circle: z.string().optional(),
  customerNo: z.string().regex(/^[5-9]\d{9}$/, 'Must be a valid 10-digit mobile number'),
  amountPaise: z.number().int().positive(),
  expectedPayablePaise: z.number().int().positive().optional(),
  dryRun: z.boolean().optional(),
  status: z.literal('claimed'),
  mPin: z.string().regex(/^\d{4}$/).optional(),
  claimedAt: z.string(),
  claimExpiresAt: z.string(),
});
export type ClaimedRechargeOrder = z.infer<typeof ClaimedRechargeOrderSchema>;

export const ClaimRechargeOrderResponseSchema = z.object({
  order: ClaimedRechargeOrderSchema.nullable(),
  message: z.string().optional(),
});
export type ClaimRechargeOrderResponse = z.infer<typeof ClaimRechargeOrderResponseSchema>;

export const UpdateOrderStatusRequestSchema = z.object({
  status: RechargeOrderStatusSchema,
  failureCode: z.string().trim().max(64).optional(),
  failureDetail: z
    .string()
    .trim()
    .max(500)
    .refine(
      (val) => !val || !/(?:\b|[^\da-fA-F])([5-9]\d{9})(?:\b|[^\da-fA-F])/.test(val),
      { message: 'failureDetail must never contain phone numbers' },
    )
    .optional(),
  qrDataUrl: z.string().max(100000).optional(),
  qrAmount: z.string().max(64).optional(),
  qrTimer: z.string().max(64).optional(),
  portalTxnRef: z.string().trim().max(128).optional(),
});
export type UpdateOrderStatusRequest = z.infer<typeof UpdateOrderStatusRequestSchema>;

export const ReportJobEventRequestSchema = z.object({
  fromStatus: z.string(),
  toStatus: RechargeOrderStatusSchema,
  actor: z.enum(['web', 'extension', 'system']).default('extension'),
  detail: z.record(z.any()).optional(),
});
export type ReportJobEventRequest = z.infer<typeof ReportJobEventRequestSchema>;

export const UploadJobQrRequestSchema = z.object({
  qrImageUrl: z.string().min(1).max(500000),
  actualPayablePaise: z.number().int().positive().optional(),
  qrExpiresAt: z.string().optional(),
  qrTimer: z.string().max(64).optional(),
});
export type UploadJobQrRequest = z.infer<typeof UploadJobQrRequestSchema>;



