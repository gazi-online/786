import { z } from 'zod';
import { IngestTransactionSchema } from './transaction';
import { SCHEMA_VERSION } from './device';

export const PageTotalsSchema = z.object({
  amountPaise: z.number().int().nonnegative(),
});
export type PageTotals = z.infer<typeof PageTotalsSchema>;

export const IngestRequestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  deviceId: z.string().uuid(),
  parserVersion: z.string().min(1),
  capturedAt: z.string().datetime({ offset: true }),
  balancePaise: z.number().int().nonnegative().nullable().optional().default(null),
  commissionPaise: z.number().int().nonnegative().nullable().optional().default(null),
  pageTotals: PageTotalsSchema,
  rows: z.array(IngestTransactionSchema).max(500),
});
export type IngestRequest = z.infer<typeof IngestRequestSchema>;

export const IngestRejectedRowSchema = z.object({
  txnId: z.string(),
  reason: z.string(),
});

export const IngestResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
  inserted: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  rejected: z.array(IngestRejectedRowSchema),
  serverTime: z.string().datetime({ offset: true }),
});
export type IngestResponse = z.infer<typeof IngestResponseSchema>;

