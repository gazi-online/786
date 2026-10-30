import { describe, it, expect, vi } from 'vitest';
import { formatSafeLog, redactSensitiveText } from '@/lib/logger';

describe('Step A10 Hardening: Next.js Request Logs, Error Pages & Unhandled Rejections', () => {
  it('sanitizes Next.js error boundary payloads and prevents PII leakage', () => {
    // Simulate a Next.js App Router error object passed to error.tsx
    const simulatedNextJsError = new Error(
      'Unhandled error during SSR: Customer 9990000001 failed verification with token ws_dev_0123456789abcdef0123456789abcdef',
    );

    const safeMessage = redactSensitiveText(simulatedNextJsError.message);
    expect(safeMessage).not.toContain('9990000001');
    expect(safeMessage).not.toContain('ws_dev_0123456789abcdef0123456789abcdef');
    expect(safeMessage).toContain('[REDACTED_PHONE]');
    expect(safeMessage).toContain('[REDACTED_DEVICE_TOKEN]');
  });

  it('sanitizes Next.js request logging metadata and strips cookies, auth headers, and query PII', () => {
    const rawUrl = '/api/v1/transactions?search=9990000001&limit=50';
    const rawHeader = 'cookie: sb-token=secret1234567890abcdef1234567890; Bearer test_token';

    const safeUrl = redactSensitiveText(rawUrl);
    const safeHeader = redactSensitiveText(rawHeader);

    expect(safeUrl).not.toContain('9990000001');
    expect(safeHeader).not.toContain('secret1234567890abcdef1234567890');
    expect(safeUrl).toContain('[REDACTED_PHONE]');
    expect(safeHeader).toContain('[REDACTED_COOKIE]');
  });

  it('handles unhandled promise rejections safely without raw SQL or request bodies', () => {
    const unhandledRejectionReason = {
      code: '23505',
      detail: 'Key (tenant_id, customer_no)=(00000000-0000-0000-0000-000000000001, 9990000001) already exists',
      table: 'transactions',
    };

    const formattedLog = formatSafeLog('ERROR', JSON.stringify(unhandledRejectionReason), {
      route: '/api/v1/ingest',
      method: 'POST',
      status: 500,
    });

    expect(formattedLog).not.toContain('9990000001');
    expect(formattedLog).toContain('route=/api/v1/ingest');
    expect(formattedLog).toContain('status=500');
  });
});
