import { describe, it, expect } from 'vitest';
import { formatSafeLog, redactSensitiveText } from '@/lib/logger';

describe('Step A10 Hardening: Next.js Request Logs, Error Pages & Unhandled Rejections', () => {
  it('sanitizes Next.js error boundary payloads and prevents PII leakage', () => {
    const runtimePhone = '9' + '0000' + '00001';
    // Simulate a Next.js App Router error object passed to error.tsx
    const simulatedNextJsError = new Error(
      `Unhandled error during SSR: Customer ${runtimePhone} failed verification with token ws_dev_0123456789abcdef0123456789abcdef`,
    );

    const safeMessage = redactSensitiveText(simulatedNextJsError.message);
    expect(safeMessage).not.toContain(runtimePhone);
    expect(safeMessage).not.toContain('ws_dev_0123456789abcdef0123456789abcdef');
    expect(safeMessage).toContain('[REDACTED_PHONE]');
    expect(safeMessage).toContain('[REDACTED_DEVICE_TOKEN]');
  });

  it('sanitizes Next.js request logging metadata and strips cookies, auth headers, and query PII', () => {
    const queryPhone = '8' + '0000' + '00002';
    const rawUrl = `/api/v1/transactions?search=${queryPhone}&limit=50`;
    const rawHeader = 'cookie: sb-token=secret1234567890abcdef1234567890; Bearer test_token';

    const safeUrl = redactSensitiveText(rawUrl);
    const safeHeader = redactSensitiveText(rawHeader);

    expect(safeUrl).not.toContain(queryPhone);
    expect(safeHeader).not.toContain('secret1234567890abcdef1234567890');
    expect(safeUrl).toContain('[REDACTED_PHONE]');
    expect(safeHeader).toContain('[REDACTED_COOKIE]');
  });

  it('handles unhandled promise rejections safely without raw SQL or request bodies', () => {
    const sqlPhone = '7' + '0000' + '00003';
    const unhandledRejectionReason = {
      code: '23505',
      detail: `Key (tenant_id, customer_no)=(00000000-0000-0000-0000-000000000001, ${sqlPhone}) already exists`,
      table: 'transactions',
    };

    const formattedLog = formatSafeLog('ERROR', JSON.stringify(unhandledRejectionReason), {
      route: '/api/v1/ingest',
      method: 'POST',
      status: 500,
    });

    expect(formattedLog).not.toContain(sqlPhone);
    expect(formattedLog).toContain('route=/api/v1/ingest');
    expect(formattedLog).toContain('status=500');
  });
});

