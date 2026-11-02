import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';

// Route Handlers
import { GET as getDevicesRoute, POST as createDeviceRoute } from '../app/api/v1/devices/route';
import { POST as revokeDeviceRoute } from '../app/api/v1/devices/[id]/revoke/route';
import { GET as getReportsRoute } from '../app/api/v1/reports/route';
import { GET as getSettingsRoute, PATCH as updateSettingsRoute } from '../app/api/v1/settings/route';
import { GET as getStreamRoute } from '../app/api/v1/stream/route';
import { GET as getSyncEventsRoute } from '../app/api/v1/sync-events/route';
import { GET as getTransactionsRoute } from '../app/api/v1/transactions/route';
import { POST as revealTransactionRoute } from '../app/api/v1/transactions/[id]/reveal/route';

describe('Round 10 Step 6: Dashboard Routes Return 401 Without Credentials, Never 500', () => {
  const routes = [
    {
      name: 'GET /api/v1/devices',
      handler: (req?: NextRequest) =>
        getDevicesRoute(req || new NextRequest('http://localhost:3000/api/v1/devices')),
    },
    {
      name: 'POST /api/v1/devices',
      handler: (req?: NextRequest) =>
        createDeviceRoute(
          req || new NextRequest('http://localhost:3000/api/v1/devices', { method: 'POST' }),
        ),
    },
    {
      name: 'POST /api/v1/devices/[id]/revoke',
      handler: (req?: NextRequest) =>
        revokeDeviceRoute(
          req || new NextRequest('http://localhost:3000/api/v1/devices/d1/revoke', { method: 'POST' }),
          { params: Promise.resolve({ id: 'd1' }) },
        ),
    },
    {
      name: 'GET /api/v1/reports',
      handler: (req?: NextRequest) =>
        getReportsRoute(req || new NextRequest('http://localhost:3000/api/v1/reports')),
    },
    {
      name: 'GET /api/v1/settings',
      handler: (req?: NextRequest) =>
        getSettingsRoute(req || new NextRequest('http://localhost:3000/api/v1/settings')),
    },
    {
      name: 'PATCH /api/v1/settings',
      handler: (req?: NextRequest) =>
        updateSettingsRoute(
          req ||
            new NextRequest('http://localhost:3000/api/v1/settings', {
              method: 'PATCH',
              body: JSON.stringify({ storeName: 'New' }),
            }),
        ),
    },
    {
      name: 'GET /api/v1/stream',
      handler: (req?: NextRequest) =>
        getStreamRoute(req || new NextRequest('http://localhost:3000/api/v1/stream')),
    },
    {
      name: 'GET /api/v1/sync-events',
      handler: (req?: NextRequest) =>
        getSyncEventsRoute(req || new NextRequest('http://localhost:3000/api/v1/sync-events')),
    },
    {
      name: 'GET /api/v1/transactions',
      handler: (req?: NextRequest) =>
        getTransactionsRoute(req || new NextRequest('http://localhost:3000/api/v1/transactions')),
    },
    {
      name: 'POST /api/v1/transactions/[id]/reveal',
      handler: (req?: NextRequest) =>
        revealTransactionRoute(
          req || new NextRequest('http://localhost:3000/api/v1/transactions/t1/reveal', { method: 'POST' }),
          { params: Promise.resolve({ id: 't1' }) },
        ),
    },
  ];

  for (const { name, handler } of routes) {
    it(`${name} strictly returns 401 when no credentials are provided`, async () => {
      const res = await handler();
      expect(res.status).toBe(401);
      expect(res.status).not.toBe(500);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });

    it(`${name} strictly returns 401 when an invalid malformed bearer token is sent`, async () => {
      const malformedReq = new NextRequest('http://localhost:3000/api/v1/test', {
        headers: { authorization: 'Bearer invalid.garbage.token' },
      });
      const res = await handler(malformedReq);
      expect(res.status).toBe(401);
      expect(res.status).not.toBe(500);
    });
  }
});
