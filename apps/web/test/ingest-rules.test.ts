import { describe, it, expect } from 'vitest';
import {
  IngestRequestSchema,
  SCHEMA_VERSION,
  type IngestRequest,
  type TransactionStatus,
} from '@walletsync/contract';

/**
 * Replicates the status transition state machine from the ingest route handler
 */
function isValidStatusTransition(
  current: TransactionStatus,
  incoming: TransactionStatus,
): boolean {
  if (current === incoming) return true;
  if (current === 'pending') {
    return incoming === 'success' || incoming === 'failed';
  }
  if (current === 'success') {
    return incoming === 'refunded';
  }
  return false;
}

describe('M2 Ingest Rules & Status Transitions (GUIDE.md §3)', () => {
  describe('Status state machine rules', () => {
    it('allows pending -> success', () => {
      expect(isValidStatusTransition('pending', 'success')).toBe(true);
    });

    it('allows pending -> failed', () => {
      expect(isValidStatusTransition('pending', 'failed')).toBe(true);
    });

    it('allows success -> refunded', () => {
      expect(isValidStatusTransition('success', 'refunded')).toBe(true);
    });

    it('allows identical status transition (idempotent)', () => {
      expect(isValidStatusTransition('success', 'success')).toBe(true);
      expect(isValidStatusTransition('pending', 'pending')).toBe(true);
      expect(isValidStatusTransition('failed', 'failed')).toBe(true);
      expect(isValidStatusTransition('refunded', 'refunded')).toBe(true);
    });

    it('strictly forbids success -> pending (downgrade)', () => {
      expect(isValidStatusTransition('success', 'pending')).toBe(false);
    });

    it('forbids failed -> pending', () => {
      expect(isValidStatusTransition('failed', 'pending')).toBe(false);
    });

    it('forbids refunded -> success', () => {
      expect(isValidStatusTransition('refunded', 'success')).toBe(false);
    });
  });

  describe('IngestRequestSchema validation', () => {
    const validSample: IngestRequest = {
      schemaVersion: SCHEMA_VERSION,
      deviceId: '123e4567-e89b-12d3-a456-426614174000',
      parserVersion: '0.1.0',
      capturedAt: '2025-01-01T12:00:00+05:30',
      balancePaise: 50000,
      pageTotals: { amountPaise: 10000 },
      rows: [
        {
          txnId: '55000001',
          source: 'simplewallet',
          service: 'Prepaid',
          serviceName: 'AIRTEL',
          customerNo: '5000000000',
          occurredAt: '2025-01-01T12:00:00+05:30',
          status: 'success',
          statusRaw: 'Success',
          operatorRef: '',
          amountPaise: 10000,
          discountPct: 1.5,
          discountPaise: 150,
        },
      ],
    };

    it('accepts valid payload matching contract', () => {
      const result = IngestRequestSchema.safeParse(validSample);
      expect(result.success).toBe(true);
    });

    it('rejects payload with negative amountPaise', () => {
      const invalid = {
        ...validSample,
        rows: [
          {
            ...validSample.rows[0]!,
            amountPaise: -100,
          },
        ],
      };
      const result = IngestRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects unsupported schemaVersion', () => {
      const invalid = {
        ...validSample,
        schemaVersion: 999,
      };
      const result = IngestRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects more than 500 rows in a single batch', () => {
      const row = validSample.rows[0]!;
      const rows = Array.from({ length: 501 }, (_, i) => ({
        ...row,
        txnId: `txn-${i}`,
      }));
      const invalid = {
        ...validSample,
        rows,
      };
      const result = IngestRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });
});

