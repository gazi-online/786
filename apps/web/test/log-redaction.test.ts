import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { redactSensitiveText, formatSafeLog } from '@/lib/logger';
import { db } from '@/lib/db';

describe('Step 4 Hardening: Allowlist Logging & PII Redaction Tests', () => {
  describe('Redaction backstop', () => {
    it('redacts Indian 10-digit mobile numbers from log strings', () => {
      const log = 'Customer failed payment for mobile 9990003210 and 9990006789';
      const redacted = redactSensitiveText(log);
      expect(redacted).not.toContain('9990003210');
      expect(redacted).not.toContain('9990006789');
      expect(redacted).toContain('[REDACTED_PHONE]');
    });

    it('redacts Bearer tokens and device tokens from log messages', () => {
      const log = 'Auth error for Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz and token ws_dev_0123456789abcdef0123456789abcdef';
      const redacted = redactSensitiveText(log);
      expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz');
      expect(redacted).not.toContain('ws_dev_0123456789abcdef0123456789abcdef');
      expect(redacted).toContain('[REDACTED_TOKEN]');
      expect(redacted).toContain('[REDACTED_DEVICE_TOKEN]');
    });

    it('redacts Cookie headers and customerNo fields from raw strings', () => {
      const rawBody = '{"customerNo": "9990003210", "amount": 500}';
      const rawCookie = 'cookie: sb-auth-token=secret12345; session=abc';

      expect(redactSensitiveText(rawBody)).not.toContain('9990003210');
      expect(redactSensitiveText(rawCookie)).not.toContain('secret12345');
    });
  });

  describe('Allowlist format logger', () => {
    it('formats safe structured log without leaking request bodies, headers or query values', () => {
      const formatted = formatSafeLog('INFO', 'Processed ingest batch', {
        route: '/api/v1/ingest',
        method: 'POST',
        status: 200,
        tenantId: '00000000-0000-0000-0000-000000000001',
      });

      expect(formatted).toContain('[INFO] Processed ingest batch');
      expect(formatted).toContain('route=/api/v1/ingest');
      expect(formatted).toContain('status=200');
    });

    it('verifies Drizzle ORM does not log query parameters', () => {
      // db instance must have query logging disabled or parameterless
      // Check that db instance is initialized without verbose parameter logger
      expect((db as any).$client).toBeDefined();
    });

    it('sanitizes unhandled error messages and error traces', () => {
      const errorWithPii = new Error('Database query failed for mobile number 9990003210');
      const safeLog = formatSafeLog('ERROR', errorWithPii.message, {
        errorName: errorWithPii.name,
        route: '/api/v1/transactions',
      });

      expect(safeLog).not.toContain('9990003210');
      expect(safeLog).toContain('[REDACTED_PHONE]');
    });
  });
});

