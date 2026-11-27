import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  generateSyntheticPhone,
  generateSyntheticTxnId,
  generateSyntheticOperatorRef,
} from '@walletsync/contract';
import {
  formatWhatsAppAlert,
  sendWhatsAppNotification,
  getWhatsAppSettings,
  saveWhatsAppSettings,
  type WhatsAppSettings,
  type IngestAlertRow,
} from '@/lib/whatsapp';
import { GET as getSettingsRoute, PATCH as updateSettingsRoute } from '@/app/api/v1/settings/route';
import { POST as testWhatsAppRoute } from '@/app/api/v1/settings/whatsapp/test/route';
import { signTestJwt, TEST_JWT_SECRET } from './helpers/jwt';

describe('WhatsApp API Integration Suite', () => {
  const originalFetch = globalThis.fetch;
  const tenantId = '00000000-0000-0000-0000-000000000001';

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('1. Message Formatter & PII Masking', () => {
    it('formats a clean alert and strictly masks customer mobile numbers', () => {
      const syntheticPhone = generateSyntheticPhone(1); // '5000000001'
      const syntheticTxnId = generateSyntheticTxnId(1); // '55000001'
      const syntheticRef = generateSyntheticOperatorRef(1); // 'OPR0000000001'

      const row: IngestAlertRow = {
        source: 'simplewallet',
        txnId: syntheticTxnId,
        service: 'prepaid_recharge',
        serviceName: 'Mobile Prepaid',
        customerNo: syntheticPhone,
        status: 'success',
        amountPaise: 25000, // ₹250.00
        occurredAt: '2026-11-27T10:00:00Z',
        operatorRef: syntheticRef,
      };

      const message = formatWhatsAppAlert(row);

      // Verify formatted elements
      expect(message).toContain('₹250.00');
      expect(message).toContain('SUCCESS');
      expect(message).toContain(syntheticTxnId);
      expect(message).toContain(syntheticRef);
      expect(message).toContain('simplewallet');

      // Verify strict PII masking
      expect(message).toContain('••••••0001');
      expect(message).not.toContain(syntheticPhone);
    });
  });

  describe('2. Webhook Dispatch & Fault Tolerance', () => {
    it('aborts dispatch when WhatsApp integration is disabled', async () => {
      const settings: WhatsAppSettings = {
        enabled: false,
        apiUrl: 'https://api.example.com/whatsapp',
        apiKey: 'test-secret',
        notifyNumber: '+8801700000000',
      };

      const result = await sendWhatsAppNotification(settings, {
        event: 'test.ping',
        recipient: settings.notifyNumber,
        message: 'Hello',
        timestamp: new Date().toISOString(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
    });

    it('successfully posts alert payload to configured WhatsApp webhook with auth', async () => {
      const settings: WhatsAppSettings = {
        enabled: true,
        apiUrl: 'https://whatsapp-gateway.internal/send',
        apiKey: 'wa-token-12345',
        notifyNumber: '+8801700000000',
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"status":"queued"}',
      });
      globalThis.fetch = fetchMock;

      const result = await sendWhatsAppNotification(settings, {
        event: 'test.ping',
        recipient: settings.notifyNumber,
        message: 'Test message',
        timestamp: new Date().toISOString(),
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const call = fetchMock.mock.calls[0];
      expect(call).toBeDefined();
      const calledUrl = call![0] as string;
      const calledInit = call![1] as { headers: Record<string, string>; body: string };
      expect(calledUrl).toBe('https://whatsapp-gateway.internal/send');
      expect(calledInit.headers['X-API-Key']).toBe('wa-token-12345');
      expect(calledInit.headers['Authorization']).toBe('Bearer wa-token-12345');
      expect(calledInit.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(calledInit.body);
      expect(body.phone).toBe('8801700000000');
      expect(body.text).toBe('Test message');
      expect(body.recipient).toBe('+8801700000000');
      expect(body.message).toBe('Test message');
    });

    it('fails gracefully without throwing when webhook request encounters network failure', async () => {
      const settings: WhatsAppSettings = {
        enabled: true,
        apiUrl: 'https://offline-gateway.local/webhook',
        apiKey: '',
        notifyNumber: '+8801700000000',
      };

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await sendWhatsAppNotification(settings, {
        event: 'test.ping',
        recipient: settings.notifyNumber,
        message: 'Test',
        timestamp: new Date().toISOString(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });
  });

  describe('3. Tenant Settings API for WhatsApp', () => {
    it('retrieves WhatsApp configuration via GET /api/v1/settings', async () => {
      const ownerToken = signTestJwt(
        { sub: '00000000-0000-0000-0000-000000000002', role: 'owner' },
        TEST_JWT_SECRET,
      );

      saveWhatsAppSettings(tenantId, {
        enabled: true,
        apiUrl: 'https://test-wa.local/api',
        apiKey: 'secret-token',
        notifyNumber: '+8801711111111',
      });

      const req = new NextRequest('http://localhost:3000/api/v1/settings', {
        headers: { authorization: `Bearer ${ownerToken}` },
      });

      const res = await getSettingsRoute(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.whatsapp).toBeDefined();
      expect(json.whatsapp.enabled).toBe(true);
      expect(json.whatsapp.apiUrl).toBe('https://test-wa.local/api');
      expect(json.whatsapp.notifyNumber).toBe('+8801711111111');
      expect(json.whatsapp.apiKeyConfigured).toBe(true);
    });

    it('allows owner to update WhatsApp settings via PATCH /api/v1/settings', async () => {
      const ownerToken = signTestJwt(
        { sub: '00000000-0000-0000-0000-000000000002', role: 'owner' },
        TEST_JWT_SECRET,
      );

      const req = new NextRequest('http://localhost:3000/api/v1/settings', {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${ownerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          whatsapp: {
            enabled: true,
            apiUrl: 'https://updated-wa.local/api',
            apiKey: 'new-key',
            notifyNumber: '+8801799999999',
          },
        }),
      });

      const res = await updateSettingsRoute(req);
      expect(res.status).toBe(200);

      const saved = getWhatsAppSettings(tenantId);
      expect(saved.enabled).toBe(true);
      expect(saved.apiUrl).toBe('https://updated-wa.local/api');
      expect(saved.notifyNumber).toBe('+8801799999999');
    });

    it('denies viewer role from modifying settings with 403', async () => {
      const viewerToken = signTestJwt(
        { sub: '00000000-0000-0000-0000-000000000003', role: 'viewer' },
        TEST_JWT_SECRET,
      );

      const req = new NextRequest('http://localhost:3000/api/v1/settings', {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${viewerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          whatsapp: { enabled: true },
        }),
      });

      const res = await updateSettingsRoute(req);
      expect(res.status).toBe(403);
    });
  });

  describe('4. Dedicated Test Alert Route Security (/api/v1/settings/whatsapp/test)', () => {
    it('returns 401 when unauthenticated', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/settings/whatsapp/test', {
        method: 'POST',
      });
      const res = await testWhatsAppRoute(req);
      expect(res.status).toBe(401);
    });

    it('returns 403 when called by viewer role', async () => {
      const viewerToken = signTestJwt(
        { sub: '00000000-0000-0000-0000-000000000003', role: 'viewer' },
        TEST_JWT_SECRET,
      );
      const req = new NextRequest('http://localhost:3000/api/v1/settings/whatsapp/test', {
        method: 'POST',
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      const res = await testWhatsAppRoute(req);
      expect(res.status).toBe(403);
    });

    it('dispatches test ping and returns 200 when invoked by owner', async () => {
      const ownerToken = signTestJwt(
        { sub: '00000000-0000-0000-0000-000000000002', role: 'owner' },
        TEST_JWT_SECRET,
      );

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"ok":true}',
      });

      const req = new NextRequest('http://localhost:3000/api/v1/settings/whatsapp/test', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ownerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          whatsapp: {
            apiUrl: 'https://wa-test.local/send',
            apiKey: 'token-abc',
            notifyNumber: '+8801700000000',
          },
        }),
      });

      const res = await testWhatsAppRoute(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.message).toContain('Test alert sent successfully');
    });
  });
});
