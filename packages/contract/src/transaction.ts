import { z } from 'zod';

export const TransactionStatusSchema = z.enum([
  'success',
  'pending',
  'failed',
  'refunded',
  'unknown',
]);
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;

export const TransactionSourceSchema = z.enum(['simplewallet', 'egpayment']);
export type TransactionSource = z.infer<typeof TransactionSourceSchema>;

/**
 * Transaction shape sent FROM the extension TO the API (POST /api/v1/ingest).
 * Contains customerNo in plaintext (sent over TLS).
 * The API derives customerLast4 and customerNoHash server-side and stores
 * customerNo encrypted at field level.
 */
export const IngestTransactionSchema = z.object({
  txnId: z.string().min(1),
  source: TransactionSourceSchema,
  service: z.string().min(1), // Raw service type text from portal
  serviceName: z.string().min(1), // Raw operator name from portal
  customerNo: z.string().min(1), // PII — encrypted at rest, masked in UI
  occurredAt: z.string().datetime({ offset: true }), // ISO 8601, Asia/Kolkata
  status: TransactionStatusSchema,
  statusRaw: z.string(), // Raw status text from portal
  operatorRef: z.string(), // Portal's Operator ID column
  amountPaise: z.number().int().nonnegative(), // Amount × 100, never float
  discountPct: z.number().nonnegative(), // From Disc (%) column
  discountPaise: z.number().int().nonnegative(), // From Disc (Rs) column × 100
});
export type IngestTransaction = z.infer<typeof IngestTransactionSchema>;

/**
 * Transaction shape returned FROM the API TO the web app.
 * customerNo is never returned in plaintext — only the masked form and last4.
 * customerNoHash is strictly kept internal/server-side and NOT returned in public API responses.
 */
export const ApiTransactionSchema = z.object({
  id: z.string().uuid(), // DB row UUID
  tenantId: z.string().uuid(),
  txnId: z.string().min(1),
  source: TransactionSourceSchema,
  service: z.string(),
  serviceName: z.string(),
  /** Last 4 digits of the customer number, stored plaintext for search. */
  customerLast4: z.string().length(4).regex(/^\d{4}$/),
  /** Masked display form, e.g. "••••••1234". Never the raw number or hash. */
  customerNoMasked: z.string().min(1),
  occurredAt: z.string().datetime({ offset: true }),
  status: TransactionStatusSchema,
  statusRaw: z.string(),
  operatorRef: z.string(),
  amountPaise: z.number().int().nonnegative(),
  discountPct: z.number().nonnegative(),
  discountPaise: z.number().int().nonnegative(),
  parserVersion: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type ApiTransaction = z.infer<typeof ApiTransactionSchema>;

