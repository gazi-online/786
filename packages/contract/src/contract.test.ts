import { describe, it, expect } from 'vitest';
import { SCHEMA_VERSION, IngestRequestSchema, ParseResultSchema, DeviceStatusSchema } from './index';

describe('contract', () => {
  it('SCHEMA_VERSION is 1', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('DeviceStatusSchema parses ok', () => {
    expect(DeviceStatusSchema.parse('ok')).toBe('ok');
  });

  it('IngestRequestSchema rejects more than 500 rows', () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({
      txnId: String(i),
      source: 'simplewallet',
      service: 'Prepaid',
      serviceName: 'AIRTEL',
      customerNo: '5000003210',
      occurredAt: '2025-01-01T12:00:00+05:30',
      status: 'success',
      statusRaw: 'Success',
      operatorRef: 'OPR0000000001',
      amountPaise: 50000,
      discountPct: 1.5,
      discountPaise: 750,
    }));
    const result = IngestRequestSchema.safeParse({
      schemaVersion: 1,
      deviceId: '00000000-0000-0000-0000-000000000001',
      parserVersion: '0.1.0',
      capturedAt: '2025-01-01T12:00:00+05:30',
      balancePaise: null,
      pageTotals: { amountPaise: 0 },
      rows,
    });
    expect(result.success).toBe(false);
  });

  it('ParseResultSchema discriminates on ok', () => {
    const success = ParseResultSchema.parse({
      ok: true,
      source: 'simplewallet',
      parserVersion: '0.1.0',
      capturedAt: '2025-01-01T12:00:00+05:30',
      balancePaise: null,
      pageTotals: { amountPaise: 50000 },
      rows: [],
    });
    expect(success.ok).toBe(true);

    const failure = ParseResultSchema.parse({
      ok: false,
      source: 'simplewallet',
      reason: 'logged_out',
    });
    expect(failure.ok).toBe(false);
  });
});

