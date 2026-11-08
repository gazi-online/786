import { z } from 'zod';

export const RECHARGE_ORDER_STATUSES = [
  'queued',
  'claimed',
  'submitting',
  'submitted',
  'success',
  'failed',
  'unknown',
  'needs_manual_action',
  'cancelled',
] as const;

export type RechargeOrderStatus = (typeof RECHARGE_ORDER_STATUSES)[number];

export const RechargeOrderStatusSchema = z.enum(RECHARGE_ORDER_STATUSES);

/**
 * Valid state transitions for a recharge order.
 *
 * Rules (Milestone R1):
 * - queued -> claimed | cancelled
 * - claimed -> queued (lease expired BEFORE submitting only) | submitting | needs_manual_action | failed | cancelled
 * - submitting -> submitted | failed | unknown | needs_manual_action.
 *   NEVER back to queued or claimed. Once an order reaches submitting it must never be submitted again automatically.
 * - submitted -> success | failed | unknown
 * - unknown -> success | failed (only via reconciliation or an explicit human decision recorded in audit_log)
 * - success, failed, cancelled are terminal.
 * All other transitions are invalid.
 */
const VALID_RECHARGE_TRANSITIONS: Record<RechargeOrderStatus, readonly RechargeOrderStatus[]> = {
  queued: ['claimed', 'cancelled'],
  claimed: ['queued', 'submitting', 'needs_manual_action', 'failed', 'cancelled'],
  submitting: ['submitted', 'failed', 'unknown', 'needs_manual_action'],
  submitted: ['success', 'failed', 'unknown'],
  unknown: ['success', 'failed'],
  needs_manual_action: ['cancelled', 'failed', 'unknown', 'success'],
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
  customerNo: z
    .string()
    .trim()
    .regex(/^[5-9]\d{9}$/, 'Must be a valid 10-digit mobile number'),
  amountPaise: z.number().int().positive('Amount in paise must be positive integer'),
  confirmDuplicate: z.boolean().optional(),
  mPin: z.string().trim().regex(/^\d{4}$/, 'Must be a 4-digit M-Pin').optional(),
});
export type CreateRechargeOrderRequest = z.infer<typeof CreateRechargeOrderRequestSchema>;

export const UpdateRechargeSettingsRequestSchema = z.object({
  rechargeEnabled: z.boolean().optional(),
  perOrderMaxPaise: z.number().int().positive().optional(),
  dailyMaxPaise: z.number().int().positive().optional(),
  maxOrdersPerMinute: z.number().int().positive().optional(),
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
  customerNo: z.string().regex(/^[5-9]\d{9}$/, 'Must be a valid 10-digit mobile number'),
  amountPaise: z.number().int().positive(),
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
  status: z.enum(['submitting', 'submitted', 'failed', 'needs_manual_action']),
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
});
export type UpdateOrderStatusRequest = z.infer<typeof UpdateOrderStatusRequestSchema>;



