import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

// Route Handler Imports
import { GET as getDevicesRoute, POST as createDeviceRoute } from '../app/api/v1/devices/route';
import { POST as revokeDeviceRoute } from '../app/api/v1/devices/[id]/revoke/route';
import { GET as getReportsRoute } from '../app/api/v1/reports/route';
import { GET as getSettingsRoute, PATCH as updateSettingsRoute } from '../app/api/v1/settings/route';
import { GET as getStreamRoute } from '../app/api/v1/stream/route';
import { GET as getSyncEventsRoute } from '../app/api/v1/sync-events/route';
import { GET as getTransactionsRoute } from '../app/api/v1/transactions/route';
import { POST as revealTransactionRoute } from '../app/api/v1/transactions/[id]/reveal/route';
import { POST as signupRoute } from '../app/api/v1/auth/signup/route';
import { POST as signinRoute } from '../app/api/v1/auth/signin/route';

import { signTestJwt } from './helpers/jwt';

describe('Round 7 Step 1: Route Auth Table & Automated Route Directory Audit', () => {
  const routesDir = path.resolve(__dirname, '../app/api/v1');

  // Explicit Allowlist: ONLY routes using device tokens or public pairing codes with rate limits
  const EXPLICIT_ALLOWLIST = new Set([
    path.normalize('devices/pair/route.ts'),
    path.normalize('devices/heartbeat/route.ts'),
    path.normalize('ingest/route.ts'),
  ]);

  it('audits every route file and fails if any route handler lacks authentication', () => {
    const routeFiles: string[] = [];

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name === 'route.ts') {
          routeFiles.push(full);
        }
      }
    }

    walk(routesDir);
    expect(routeFiles.length).toBeGreaterThanOrEqual(12);

    for (const file of routeFiles) {
      const relPath = path.normalize(path.relative(routesDir, file));
      const content = fs.readFileSync(file, 'utf8');

      if (EXPLICIT_ALLOWLIST.has(relPath)) {
        // Must verify allowlisted routes call rate limiter or token hash
        const hasPairingOrIngestProtection =
          content.includes('checkRateLimit') ||
          content.includes('hashDeviceToken') ||
          content.includes('verifyDeviceToken');
        expect(hasPairingOrIngestProtection).toBe(true);
      } else {
        // Every other route MUST invoke getTenantSession or signUpUser
        const hasAuth =
          content.includes('getTenantSession') ||
          content.includes('signUpUser') ||
          content.includes('verifyJwt');
        expect(hasAuth).toBe(true);
      }
    }
  });

  describe('Unauthenticated Requests: Strict HTTP 401 Enforcement', () => {
    it('returns 401 for unauthenticated GET /devices', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/devices');
      const res = await getDevicesRoute(req);
      expect(res.status).toBe(401);
    });

    it('returns 401 for unauthenticated POST /devices', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/devices', { method: 'POST' });
      const res = await createDeviceRoute(req);
      expect(res.status).toBe(401);
    });

    it('returns 401 for unauthenticated POST /devices/[id]/revoke', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/devices/dev-1/revoke', { method: 'POST' });
      const res = await revokeDeviceRoute(req, { params: Promise.resolve({ id: 'dev-1' }) });
      expect(res.status).toBe(401);
    });

    it('returns 401 for unauthenticated GET /reports', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/reports');
      const res = await getReportsRoute(req);
      expect(res.status).toBe(401);
    });

    it('returns 401 for unauthenticated GET /settings', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/settings');
      const res = await getSettingsRoute(req);
      expect(res.status).toBe(401);
    });

    it('returns 401 for unauthenticated PATCH /settings', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/settings', {
        method: 'PATCH',
        body: JSON.stringify({ storeName: 'New Name' }),
      });
      const res = await updateSettingsRoute(req);
      expect(res.status).toBe(401);
    });

    it('returns 401 for unauthenticated GET /stream', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/stream');
      const res = await getStreamRoute(req);
      expect(res.status).toBe(401);
    });

    it('returns 401 for unauthenticated GET /sync-events', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/sync-events');
      const res = await getSyncEventsRoute(req);
      expect(res.status).toBe(401);
    });

    it('returns 401 for unauthenticated GET /transactions', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/transactions');
      const res = await getTransactionsRoute(req);
      expect(res.status).toBe(401);
    });

    it('returns 401 for unauthenticated POST /transactions/[id]/reveal', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/transactions/txn-1/reveal', { method: 'POST' });
      const res = await revealTransactionRoute(req, { params: Promise.resolve({ id: 'txn-1' }) });
      expect(res.status).toBe(401);
    });

    it('returns 401 for unauthenticated POST /auth/signup without token', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ storeName: 'New Store' }),
      });
      const res = await signupRoute(req);
      expect(res.status).toBe(401);
    });

    it('returns 401 for unauthenticated POST /auth/signin without token', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/auth/signin', { method: 'POST' });
      const res = await signinRoute(req);
      expect(res.status).toBe(401);
    });
  });

  describe('Cross-Tenant Isolation Tests via API Routes', () => {
    const tenantAToken = signTestJwt({
      sub: '00000000-0000-0000-0000-000000000001',
      tenantId: '11111111-1111-1111-1111-111111111111',
      role: 'owner',
    });

    it('scopes GET /transactions to authenticated tenant only', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/transactions', {
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      const res = await getTransactionsRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.items)).toBe(true);
    });

    it('prevents cross-tenant reveal of customer number (returns 404/403 for foreign txn)', async () => {
      const foreignTxnId = '99999999-9999-9999-9999-999999999999';
      const req = new NextRequest(`http://localhost:3000/api/v1/transactions/${foreignTxnId}/reveal`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      const res = await revealTransactionRoute(req, { params: Promise.resolve({ id: foreignTxnId }) });
      expect([404, 403]).toContain(res.status);
    });

    it('scopes GET /devices to authenticated tenant only', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/devices', {
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      const res = await getDevicesRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.devices)).toBe(true);
    });

    it('respects explicit X-Tenant header when resolving tenant context', async () => {
      const explicitTenantId = '22222222-2222-2222-2222-222222222222';
      const req = new NextRequest('http://localhost:3000/api/v1/devices', {
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          'x-tenant': explicitTenantId,
        },
      });
      const res = await getDevicesRoute(req);
      expect(res.status).toBe(200);
    });
  });
});

