import { z } from 'zod';
import { IngestTransactionSchema, TransactionSourceSchema } from './transaction';
import { PageTotalsSchema } from './ingest';

export const ParseFailureReasonSchema = z.enum([
  'layout_changed',
  'logged_out',
  'totals_mismatch',
]);
export type ParseFailureReason = z.infer<typeof ParseFailureReasonSchema>;

export const ParseSuccessSchema = z.object({
  ok: z.literal(true),
  source: TransactionSourceSchema,
  parserVersion: z.string().min(1),
  capturedAt: z.string().datetime({ offset: true }),
  balancePaise: z.number().int().nonnegative().nullable(),
  pageTotals: PageTotalsSchema,
  rows: z.array(IngestTransactionSchema),
});
export type ParseSuccess = z.infer<typeof ParseSuccessSchema>;

export const ParseFailureSchema = z.object({
  ok: z.literal(false),
  source: TransactionSourceSchema,
  reason: ParseFailureReasonSchema,
  detail: z.string().optional(),
});
export type ParseFailure = z.infer<typeof ParseFailureSchema>;

export const ParseResultSchema = z.discriminatedUnion('ok', [
  ParseSuccessSchema,
  ParseFailureSchema,
]);
export type ParseResult = z.infer<typeof ParseResultSchema>;

